import { db, type OutboxItem, type OutboxKind } from './db'
import { supabase } from './supabase'
import { uploadWeighmentPhoto } from './storage'

const MAX_ATTEMPTS = 8
const BACKOFF_CAP_S = 300

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, BACKOFF_CAP_S) * 1000
}

export interface EnqueueInput {
  clientUuid: string
  kind: OutboxKind
  jobId?: string
  grossG: number
  scaleId?: string
  deviceTs: string
  lat?: number
  lng?: number
  accuracyM?: number
  sha256: string
  photoPath: string
  note?: string
  payload: Record<string, unknown>
  blob: Blob
}

// Enqueue and return immediately. The operator must never wait for a network
// round trip — see SPEC.md Section 10.2, requirement 6.
export async function enqueueWeighment(input: EnqueueInput): Promise<void> {
  const { blob, ...item } = input
  await db.blobs.put({ clientUuid: item.clientUuid, blob })
  await db.outbox.add({
    ...item,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  })
  scheduleFlush()
}

const WEIGHMENT_KIND_BY_OUTBOX_KIND: Record<OutboxKind, string> = {
  job_input: 'job_input',
  job_output: 'job_output',
  job_waste: 'job_waste',
  calibration: 'calibration',
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

async function insertWeighmentRow(item: OutboxItem): Promise<string> {
  const actorId = await currentUserId()
  const { data, error } = await supabase
    .from('weighments')
    .insert({
      client_uuid: item.clientUuid,
      kind: WEIGHMENT_KIND_BY_OUTBOX_KIND[item.kind],
      gross_g: item.grossG,
      scale_id: item.scaleId ?? null,
      photo_path: item.photoPath,
      photo_sha256: item.sha256,
      device_ts: item.deviceTs,
      lat: item.lat ?? null,
      lng: item.lng ?? null,
      accuracy_m: item.accuracyM ?? null,
      // Also overwritten server-side by a BEFORE INSERT trigger regardless
      // (CLAUDE.md invariant 6) — sent correctly anyway rather than relying
      // on trigger-vs-RLS-check ordering for a table with no such trigger
      // (see calibration_checks.checked_by below, which has no override).
      actor_id: actorId,
      note: item.note ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // 23505 on client_uuid means a previous attempt actually succeeded
    // before the response reached us. Treat it as success — this is the
    // single most common real-world failure mode on flaky wifi.
    if (error.code === '23505') {
      const { data: existing, error: selErr } = await supabase
        .from('weighments')
        .select('id')
        .eq('client_uuid', item.clientUuid)
        .single()
      if (selErr || !existing) throw selErr ?? new Error('Duplicate weighment not found on lookup')
      return existing.id
    }
    throw error
  }
  return data.id
}

// Each child table maps one weighment to at most one row in this app's usage,
// so weighment_id doubles as an idempotency key here even though these
// tables have no client_uuid of their own — without this check, retrying a
// lost response after the child insert actually succeeded would double-count
// the weight.
async function childRowAlreadyExists(table: string, weighmentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('weighment_id', weighmentId)
    .maybeSingle()
  if (error) throw error
  return !!data
}

async function insertChildRow(item: OutboxItem): Promise<void> {
  const weighmentId = item.weighmentServerId!
  switch (item.kind) {
    case 'job_input': {
      if (await childRowAlreadyExists('job_inputs', weighmentId)) return
      const { error } = await supabase.from('job_inputs').insert({
        job_id: item.jobId,
        raw_lot_id: item.payload.rawLotId,
        weight_g: item.grossG,
        weighment_id: weighmentId,
      })
      if (error) throw error
      return
    }
    case 'job_output': {
      if (await childRowAlreadyExists('job_outputs', weighmentId)) return
      const { error } = await supabase.from('job_outputs').insert({
        job_id: item.jobId,
        unit_count: item.payload.unitCount,
        gross_g: item.grossG,
        tube_tare_g: item.payload.tubeTareG,
        other_tare_g: item.payload.otherTareG ?? 0,
        weighment_id: weighmentId,
      })
      if (error) throw error
      return
    }
    case 'job_waste': {
      if (await childRowAlreadyExists('job_waste', weighmentId)) return
      const { error } = await supabase.from('job_waste').insert({
        job_id: item.jobId,
        weight_g: item.grossG,
        reason: item.payload.reason ?? null,
        weighment_id: weighmentId,
      })
      if (error) throw error
      return
    }
    case 'calibration': {
      if (await childRowAlreadyExists('calibration_checks', weighmentId)) return
      const { error } = await supabase.from('calibration_checks').insert({
        scale_id: item.scaleId,
        reference_weight_id: item.payload.referenceWeightId,
        observed_g: item.grossG,
        nominal_g: item.payload.nominalG,
        weighment_id: weighmentId,
        // No override trigger for this table (unlike weighments.actor_id):
        // RLS requires checked_by = auth.uid() exactly, so it must be real.
        checked_by: await currentUserId(),
      })
      if (error) throw error
      return
    }
  }
}

async function processItem(item: OutboxItem): Promise<void> {
  try {
    if (!item.weighmentServerId) {
      // 'uploading' here means a previous attempt was interrupted (browser
      // closed, tab killed) before it could confirm success — treat it the
      // same as 'pending' and re-upload. Trusting a stuck 'uploading' status
      // as "already done" would let this insert the weighments row below
      // referencing a photo that may never have actually reached storage.
      if (item.status === 'pending' || item.status === 'failed' || item.status === 'uploading') {
        await db.outbox.update(item.id!, { status: 'uploading' })
        const blobRow = await db.blobs.get(item.clientUuid)
        if (!blobRow) throw new Error('Photo blob missing from local storage')
        await uploadWeighmentPhoto(item.photoPath, blobRow.blob)
        await db.outbox.update(item.id!, { status: 'uploaded', attempts: 0 })
        item = { ...item, status: 'uploaded' }
      }
      const weighmentId = await insertWeighmentRow(item)
      await db.outbox.update(item.id!, { weighmentServerId: weighmentId })
      item = { ...item, weighmentServerId: weighmentId }
    }

    await insertChildRow(item)

    await db.outbox.update(item.id!, { status: 'done' })
    await db.blobs.delete(item.clientUuid) // CLAUDE.md invariant 10: only after the row insert is confirmed
  } catch (err) {
    const attempts = item.attempts + 1
    const failed = attempts > MAX_ATTEMPTS
    await db.outbox.update(item.id!, {
      status: failed ? 'failed' : item.weighmentServerId ? 'uploaded' : 'pending',
      attempts,
      nextAttemptAt: Date.now() + backoffMs(attempts),
      lastError: err instanceof Error ? err.message : String(err),
    })
  }
}

let flushing = false
let flushQueued = false

export async function flushOutbox(): Promise<void> {
  if (flushing) {
    flushQueued = true
    return
  }
  flushing = true
  try {
    if (!navigator.onLine) return
    const now = Date.now()
    const items = await db.outbox
      .where('status')
      .anyOf('pending', 'uploading', 'uploaded')
      .sortBy('createdAt')
    for (const item of items) {
      if (item.nextAttemptAt > now) continue
      await processItem(item)
    }
  } finally {
    flushing = false
    if (flushQueued) {
      flushQueued = false
      void flushOutbox()
    }
  }
}

export function scheduleFlush(): void {
  void flushOutbox()
}

let started = false

// Trigger a flush on: app start, the browser regaining connectivity, and a
// 30 second interval while online. See SPEC.md Section 10.3.
export function startOutboxWorker(): void {
  if (started) return
  started = true
  scheduleFlush()
  window.addEventListener('online', scheduleFlush)
  setInterval(() => {
    if (navigator.onLine) scheduleFlush()
  }, 30_000)
}
