import { downloadCsv } from '../lib/csv'

export function ExportCsvButton<T extends object>({
  filename,
  rows,
}: {
  filename: string
  rows: T[] | undefined
}) {
  return (
    <button
      className="h-touch px-3 rounded-lg bg-slate-800 text-sm font-medium disabled:opacity-40"
      disabled={!rows || rows.length === 0}
      onClick={() => rows && downloadCsv(filename, rows as unknown as Record<string, unknown>[])}
    >
      Export CSV
    </button>
  )
}
