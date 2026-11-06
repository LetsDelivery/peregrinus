import { describe, expect, test } from 'bun:test'

import { InvalidRequestException } from '../exceptions.js'
import { DEFAULT_EXPIRY, expirySchema, isExpired, resolveExpiry } from '../expiry.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')

describe('resolveExpiry', () => {
  test('counts days from now, exactly', () => {
    // Act
    const at = resolveExpiry({ kind: 'days', days: 30 }, NOW)

    // Assert
    expect(at).toBe('2026-12-05T12:00:00.000Z')
  })

  test('takes a date as the end of that day in UTC', () => {
    // Act
    const at = resolveExpiry({ kind: 'date', date: '2026-11-30' }, NOW)

    // Assert
    expect(at).toBe('2026-11-30T23:59:59.999Z')
  })

  test('says never as null', () => {
    // Act & Assert
    expect(resolveExpiry({ kind: 'never' }, NOW)).toBeNull()
  })

  test('refuses a date in the past, today after it ended, and a day that does not exist', () => {
    // Act & Assert
    expect(() => resolveExpiry({ kind: 'date', date: '2026-11-04' }, NOW)).toThrow(InvalidRequestException)
    expect(() => resolveExpiry({ kind: 'date', date: '2026-02-31' }, NOW)).toThrow(/not a date/)
    expect(resolveExpiry({ kind: 'date', date: '2026-11-05' }, NOW)).toBe('2026-11-05T23:59:59.999Z')
  })

  test('has 30 days as the default', () => {
    // Act & Assert
    expect(DEFAULT_EXPIRY).toEqual({ kind: 'days', days: 30 })
  })
})

describe('isExpired', () => {
  test('is true from the very instant, false before it, and false for never', () => {
    // Act & Assert
    expect(isExpired('2026-11-05T12:00:00.000Z', NOW)).toBe(true)
    expect(isExpired('2026-11-05T12:00:00.001Z', NOW)).toBe(false)
    expect(isExpired(null, NOW)).toBe(false)
  })
})

describe('expirySchema', () => {
  test('takes the three kinds and refuses anything else', () => {
    // Act & Assert
    expect(expirySchema.safeParse({ kind: 'days', days: 7 }).success).toBe(true)
    expect(expirySchema.safeParse({ kind: 'date', date: '2026-12-01' }).success).toBe(true)
    expect(expirySchema.safeParse({ kind: 'never' }).success).toBe(true)
    expect(expirySchema.safeParse({ kind: 'days', days: 0 }).success).toBe(false)
    expect(expirySchema.safeParse({ kind: 'date', date: '1/12/2026' }).success).toBe(false)
    expect(expirySchema.safeParse({ kind: 'forever' }).success).toBe(false)
  })
})
