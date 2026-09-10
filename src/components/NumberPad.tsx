// SPEC.md Section 10.1: numeric entry uses a custom on-screen pad, not the
// system keyboard. Faster, and it cannot autocorrect a weight. Minimum touch
// target 56px throughout, per the same section.
export function NumberPad({
  value,
  onChange,
  unit,
}: {
  value: string
  onChange: (next: string) => void
  unit?: string
}) {
  function press(d: string) {
    if (value === '0') onChange(d)
    else onChange(value + d)
  }
  function backspace() {
    onChange(value.length <= 1 ? '0' : value.slice(0, -1))
  }
  function clear() {
    onChange('0')
  }

  return (
    <div className="space-y-3">
      <div className="text-center text-5xl font-bold tabular-nums py-4">
        {value}
        {unit && <span className="text-2xl text-slate-400 ml-2">{unit}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            className="h-touch rounded-lg bg-slate-800 text-2xl font-medium active:bg-slate-700"
            onClick={() => press(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className="h-touch rounded-lg bg-slate-800 text-lg font-medium active:bg-slate-700"
          onClick={clear}
        >
          Clear
        </button>
        <button
          type="button"
          className="h-touch rounded-lg bg-slate-800 text-2xl font-medium active:bg-slate-700"
          onClick={() => press('0')}
        >
          0
        </button>
        <button
          type="button"
          className="h-touch rounded-lg bg-slate-800 text-lg font-medium active:bg-slate-700"
          onClick={backspace}
        >
          ⌫
        </button>
      </div>
    </div>
  )
}
