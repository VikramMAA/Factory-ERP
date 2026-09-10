import Dexie, { type Table } from 'dexie'

export type OutboxStatus = 'pending' | 'uploading' | 'uploaded' | 'done' | 'failed'

export interface OutboxItem {
  id?: number
  clientUuid: string // generated once, reused on every retry
  kind: string
  grossG: number
  scaleId?: string
  deviceTs: string // ISO, from the phone
  lat?: number
  lng?: number
  accuracyM?: number
  sha256: string
  photoPath: string // yyyy/mm/{clientUuid}.jpg
  note?: string
  status: OutboxStatus
  attempts: number
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
  }
}

export const db = new RewindDB()
