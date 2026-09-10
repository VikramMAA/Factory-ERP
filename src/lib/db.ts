import Dexie, { type Table } from 'dexie'

// SPEC.md Section 10.3: the offline outbox. Highest-risk component in the
// build — a dropped connection must never lose a weighment or make an
// operator re-enter one.
//
// Scoping note on what gets queued, since SPEC.md doesn't spell this out
// explicitly: CLAUDE.md invariant 9 and Section 10.3 both only ever talk
// about queuing a "weighment" (event), never a job. production_jobs also has
// no client_uuid column — nothing makes retrying a lost "create job" response
// safe from creating a duplicate job. So: starting a job (a small, fast,
// low-risk row insert, normally done at shift start standing near wifi)
// requires connectivity. Once a job is open, weighing input/output/waste
// throughout the shift — the continuous, evidence-bearing, failure-prone
// part Section 6.5 describes — is fully offline-safe via this queue. Closing
// a job also requires connectivity: close_job's rollups are computed from
// whatever rows exist in the DB at that instant, so the UI must not let
// "Close job" fire while this device still has unsynced items for that job.
export type OutboxStatus = 'pending' | 'uploading' | 'uploaded' | 'done' | 'failed'

export type OutboxKind = 'job_input' | 'job_output' | 'job_waste' | 'calibration' | 'pack'

export interface OutboxItem {
  id?: number
  clientUuid: string // idempotency key -> weighments.client_uuid. Generated once, reused on every retry.
  kind: OutboxKind
  jobId?: string // real server production_jobs.id (job_input/output/waste only)
  grossG: number
  scaleId?: string
  deviceTs: string // ISO, from the phone
  lat?: number
  lng?: number
  accuracyM?: number
  sha256: string
  photoPath: string // yyyy/mm/{clientUuid}.jpg
  note?: string
  // Kind-specific fields for the child row inserted once the weighment
  // itself has synced:
  //   job_input:   { rawLotId: string }
  //   job_output:  { unitCount: number; tubeTareG: number; otherTareG: number }
  //   job_waste:   { reason?: string }
  //   calibration: { referenceWeightId: string }
  //   pack:        { orderId: string; packagingId: string; unitCount: number }
  payload: Record<string, unknown>
  weighmentServerId?: string // set once the weighments row is confirmed
  status: OutboxStatus
  attempts: number
  nextAttemptAt: number // epoch ms; the worker skips items not due yet
  lastError?: string
  createdAt: number
}

class RewindDB extends Dexie {
  outbox!: Table<OutboxItem, number>
  blobs!: Table<{ clientUuid: string; blob: Blob }, string>

  constructor() {
    super('rewind')
    this.version(1).stores({
      outbox: '++id, clientUuid, status, createdAt',
      blobs: 'clientUuid',
    })
    this.version(2).stores({
      outbox: '++id, clientUuid, status, createdAt, jobId',
      blobs: 'clientUuid',
    })
  }
}

export const db = new RewindDB()
