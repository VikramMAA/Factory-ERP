import { describe, expect, it } from 'vitest'
import { formatKg, formatRupees, gramsToKg, kgToGrams, paiseToRupees, rupeesToPaise } from './units'

describe('units', () => {
  it('round-trips grams and kilograms with no drift', () => {
    for (const kg of [0, 0.02, 1, 12.345, 1000]) {
      expect(gramsToKg(kgToGrams(kg))).toBeCloseTo(kg, 6)
    }
  })

  it('round-trips paise and rupees with no drift', () => {
    for (const paise of [0, 1, 100, 123456, 999999]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise)
    }
  })

  it('formats grams as kilograms to two decimal places by default', () => {
    expect(formatKg(9600)).toBe('9.60 kg')
    expect(formatKg(20)).toBe('0.02 kg')
  })

  it('formats paise as rupees with a rupee sign', () => {
    expect(formatRupees(120000)).toBe('₹1200.00')
    expect(formatRupees(0)).toBe('₹0.00')
  })

  it('never stores or returns a value that implies floating-point grams', () => {
    // kgToGrams must always round to an integer — CLAUDE.md invariant 1.
    expect(Number.isInteger(kgToGrams(0.1 + 0.2))).toBe(true)
  })
})
