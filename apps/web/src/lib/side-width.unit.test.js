import { describe, expect, test } from 'bun:test'

import { clampSide, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN } from './side-width.js'

describe('the sidebar width', () => {
  test('keeps a width inside the limits as it is, in whole pixels', () => {
    // Act & Assert
    expect(clampSide(340)).toBe(340)
    expect(clampSide(340.6)).toBe(341)
  })

  test('holds a width that is too small or too large at the limit', () => {
    // Act & Assert
    expect(clampSide(10)).toBe(SIDE_MIN)
    expect(clampSide(5000)).toBe(SIDE_MAX)
  })

  test('leaves room for the work area on a small window', () => {
    // Act & Assert
    expect(clampSide(560, 800)).toBe(440)
    expect(clampSide(560, 300)).toBe(SIDE_MIN)
  })

  test('falls back to the default for what is not a number', () => {
    // Act & Assert
    expect(clampSide(undefined)).toBe(SIDE_DEFAULT)
    expect(clampSide(Number.NaN)).toBe(SIDE_DEFAULT)
    expect(clampSide('wide')).toBe(SIDE_DEFAULT)
  })
})
