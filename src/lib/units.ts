// All conversion between storage units (integer grams, integer paise) and
// display units (kilograms, rupees) lives here. Never do this math inline
// elsewhere. See CLAUDE.md invariants 1 and 2.

export function gramsToKg(grams: number): number {
  return grams / 1000
}

export function formatKg(grams: number, fractionDigits = 2): string {
  return `${gramsToKg(grams).toFixed(fractionDigits)} kg`
}

export function paiseToRupees(paise: number): number {
  return paise / 100
}

export function formatRupees(paise: number): string {
  return `₹${paiseToRupees(paise).toFixed(2)}`
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000)
}
