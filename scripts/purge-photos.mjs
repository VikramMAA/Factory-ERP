// SPEC.md Section 12.3. Runs daily via .github/workflows/purge-photos.yml
// with the service key (never in the browser — CLAUDE.md invariant 7). Keeps
// Supabase Storage inside the free tier indefinitely: weighment rows, their
// hashes, weights and timestamps stay forever; only the image goes.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)
const BUCKET = 'weighment-photos'
const RETENTION_DAYS = 90
// The project's own start — no point scanning empty year/month folders that
// can never exist. Update if this ever gets reused past this project.
const PROJECT_START = new Date(2026, 8, 1)

function monthsBefore(cutoff) {
  const months = []
  const d = new Date(PROJECT_START)
  while (d <= cutoff) {
    months.push({ yyyy: d.getFullYear(), mm: String(d.getMonth() + 1).padStart(2, '0') })
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

async function listJpgs(prefix) {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error) throw new Error(`Listing ${prefix} failed: ${error.message}`)
  return (data ?? []).filter((f) => f.name.endsWith('.jpg')).map((f) => `${prefix}/${f.name}`)
}

// Evidence under review is never deleted. A weighment tied to a flag that's
// still open or confirmed is protected regardless of age.
async function isProtectedWeighmentPhoto(path) {
  const { data: weighment } = await supabase
    .from('weighments')
    .select('id')
    .eq('photo_path', path)
    .maybeSingle()
  if (!weighment) return false
  const { data: flags } = await supabase
    .from('flags')
    .select('id')
    .eq('entity_type', 'weighment')
    .eq('entity_id', weighment.id)
    .in('status', ['open', 'confirmed'])
    .limit(1)
  return (flags?.length ?? 0) > 0
}

async function deleteAndLog(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) {
    console.error(`Failed to delete ${path}: ${error.message}`)
    return false
  }
  await supabase.from('audit_log').insert({
    table_name: 'storage.objects',
    row_id: path,
    action: 'PHOTO_PURGE',
    actor_id: null,
    before: { path },
    after: null,
  })
  return true
}

async function main() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const months = monthsBefore(cutoff)

  let deleted = 0
  let skipped = 0

  for (const { yyyy, mm } of months) {
    for (const path of await listJpgs(`${yyyy}/${mm}`)) {
      if (await isProtectedWeighmentPhoto(path)) {
        skipped++
        continue
      }
      if (await deleteAndLog(path)) deleted++
    }

    // Delivery proof photos (not a weighment — no weight involved, so no
    // flag ever references them) live under their own prefix. Same
    // retention window, no protection check needed.
    for (const path of await listJpgs(`proofs/${yyyy}/${mm}`)) {
      if (await deleteAndLog(path)) deleted++
    }
  }

  console.log(`Purge complete: ${deleted} deleted, ${skipped} skipped (evidence under review).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
