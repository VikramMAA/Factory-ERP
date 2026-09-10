import { useRef, useState } from 'react'
import { NumberPad } from './NumberPad'
import { prepareWeighmentPhoto, getBestEffortLocation } from '../lib/image'
import { weighmentPhotoPath } from '../lib/storage'
import { enqueueWeighment } from '../lib/outbox'
import type { OutboxKind } from '../lib/db'

// SPEC.md Section 10.2. Every photographed weight in the app goes through
// this one component — do not duplicate this logic anywhere else.
export function WeighmentCapture({
  kind,
  contextLabel,
  operatorName,
  scaleId,
  jobId,
  payload,
  onCaptured,
}: {
  kind: OutboxKind
  contextLabel: string
  operatorName: string
  scaleId?: string
  jobId?: string
  payload: Record<string, unknown>
  onCaptured: (clientUuid: string, grossG: number) => void
}) {
  const [grams, setGrams] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openCamera() {
    setError(null)
    if (Number(grams) <= 0) {
      setError('Enter a weight first.')
      return
    }
    fileInputRef.current?.click()
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same capture next time
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      const grossG = Number(grams)
      const clientUuid = crypto.randomUUID()
      const deviceTs = new Date()

      const { blob, sha256 } = await prepareWeighmentPhoto(file, {
        line1: contextLabel,
        line2: `${operatorName} · ${deviceTs.toLocaleString()}`,
      })
      const position = await getBestEffortLocation()

      await enqueueWeighment({
        clientUuid,
        kind,
        jobId,
        grossG,
        scaleId,
        deviceTs: deviceTs.toISOString(),
        lat: position?.coords.latitude,
        lng: position?.coords.longitude,
        accuracyM: position?.coords.accuracy,
        sha256,
        photoPath: weighmentPhotoPath(clientUuid, deviceTs),
        payload,
        blob,
      })

      setGrams('0')
      // Returns immediately — the operator never waits for a network round
      // trip. Sync happens in the background outbox worker.
      onCaptured(clientUuid, grossG)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <NumberPad value={grams} onChange={setGrams} unit="g" />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileSelected}
      />
      <button
        type="button"
        className="w-full h-touch rounded-lg bg-blue-600 text-lg font-semibold disabled:opacity-50"
        onClick={openCamera}
        disabled={busy}
      >
        {busy ? 'Saving…' : 'Photo'}
      </button>
    </div>
  )
}
