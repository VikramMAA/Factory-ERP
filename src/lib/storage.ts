import { supabase } from './supabase'

// All photo I/O goes through this module. SPEC.md Section 12.4: when Supabase
// Storage crosses 600 MB, migrating to Cloudflare R2 is meant to be "swap the
// two functions in this module" — that only stays true if nothing else in
// the app calls supabase.storage directly.

export function weighmentPhotoPath(clientUuid: string, at: Date = new Date()): string {
  const yyyy = at.getUTCFullYear()
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}/${mm}/${clientUuid}.jpg`
}

export async function uploadWeighmentPhoto(path: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage.from('weighment-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  // A duplicate-path upload (retry after a lost response) is not a failure —
  // the bytes are already there. Everything else is.
  if (error && !/already exists/i.test(error.message)) {
    throw error
  }
}

// Never make the bucket public. A supervisor's view of a photo is always a
// short-lived signed URL.
export async function getSignedPhotoUrl(path: string, expiresInSeconds = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from('weighment-photos')
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data) throw error ?? new Error('Failed to sign photo URL')
  return data.signedUrl
}
