// SPEC.md Section 10.2. Every photographed weight in the app goes through
// this. Never upload the original file: at 4 MB per raw phone photo and
// roughly 180 photos/day, the 1 GB free storage tier is gone by day 2 (see
// SPEC.md Section 2, "Where free actually breaks"). Downscaling to 800px at
// quality 0.6 lands a legible seven-segment scale reading at 30-40 KB.

export interface PreparedPhoto {
  blob: Blob
  sha256: string
}

export async function prepareWeighmentPhoto(
  file: File,
  overlay: { line1: string; line2: string }
): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file)
  const maxEdge = Number(import.meta.env.VITE_PHOTO_MAX_EDGE_PX ?? 800)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)

  // Burn in an overlay so the photo is self-describing during an audit,
  // months later, out of context.
  const barH = Math.round(h * 0.12)
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.fillRect(0, h - barH, w, barH)
  ctx.fillStyle = '#fff'
  ctx.font = `${Math.round(barH * 0.32)}px system-ui, sans-serif`
  ctx.fillText(overlay.line1, 10, h - barH + barH * 0.4)
  ctx.fillText(overlay.line2, 10, h - barH + barH * 0.78)

  const quality = Number(import.meta.env.VITE_PHOTO_JPEG_QUALITY ?? 0.6)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Photo encoding failed'))),
      'image/jpeg',
      quality
    )
  )

  // Hash the final compressed bytes, not the original — the hash must match
  // what actually gets stored, since it's what proves a photo hasn't been
  // swapped after the fact.
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return { blob, sha256 }
}

// Best-effort location. Never blocks capture on a GPS fix — a 5 second
// timeout is generous for a factory floor where evidence loses no value if
// the fix never lands.
export function getBestEffortLocation(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    const timer = setTimeout(() => resolve(null), 5000)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        resolve(pos)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { timeout: 5000, maximumAge: 60_000 }
    )
  })
}
