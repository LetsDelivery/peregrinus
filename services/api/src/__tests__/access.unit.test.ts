import { describe, expect, test } from 'bun:test'

import {
  checkPassword,
  hashPassword,
  newPassword,
  PASSWORD_LENGTH,
  signToken,
  TOKEN_TTL_MS,
  verifyToken
} from '../access.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')

describe('newPassword', () => {
  test('makes 16 characters a person can read and type, never the look-alikes, and a different one each time', () => {
    // Act
    const passwords = Array.from({ length: 300 }, () => newPassword())

    // Assert
    expect(passwords.every((password) => password.length === PASSWORD_LENGTH)).toBe(true)
    expect(passwords.some((password) => /[0OIl1]/.test(password))).toBe(false)
    expect(new Set(passwords).size).toBe(300)
  })
})

describe('hashPassword and checkPassword', () => {
  test('keep a hash that holds no trace of the password and accept only that password', async () => {
    // Arrange
    const access = await hashPassword('correct horse battery', 1, NOW)

    // Act
    const right = await checkPassword('correct horse battery', access)
    const wrong = await checkPassword('correct horse batterz', access)

    // Assert
    expect(right).toBe(true)
    expect(wrong).toBe(false)
    expect(JSON.stringify(access)).not.toContain('correct')
    expect(access).toMatchObject({ version: 1, setAt: NOW.toISOString() })
  })

  test('salt each hash, so the same password hashes to something different every time', async () => {
    // Act
    const first = await hashPassword('same password', 1, NOW)
    const second = await hashPassword('same password', 1, NOW)

    // Assert
    expect(first.hash).not.toBe(second.hash)
    expect(first.salt).not.toBe(second.salt)
  })
})

describe('tokens', () => {
  const later = (ms: number) => new Date(NOW.getTime() + ms)

  test('are good for the page and the password that signed them, until they expire', async () => {
    // Arrange
    const access = await hashPassword('secret one', 1, NOW)
    const token = signToken('slug-1', access, NOW.getTime() + TOKEN_TTL_MS)

    // Act & Assert
    expect(verifyToken(token, 'slug-1', access, NOW)).toBe(true)
    expect(verifyToken(token, 'slug-1', access, later(TOKEN_TTL_MS - 1))).toBe(true)
    expect(verifyToken(token, 'slug-1', access, later(TOKEN_TTL_MS))).toBe(false)
  })

  test('do not open another page, and stop working when the password changes', async () => {
    // Arrange
    const access = await hashPassword('secret one', 1, NOW)
    const changed = await hashPassword('secret two', 2, NOW)
    const token = signToken('slug-1', access, NOW.getTime() + TOKEN_TTL_MS)

    // Act & Assert
    expect(verifyToken(token, 'slug-2', access, NOW)).toBe(false)
    expect(verifyToken(token, 'slug-1', changed, NOW)).toBe(false)
  })

  test('are refused when altered, made up, empty or of another kind', async () => {
    // Arrange
    const access = await hashPassword('secret one', 1, NOW)
    const expiry = NOW.getTime() + TOKEN_TTL_MS
    const token = signToken('slug-1', access, expiry)
    const [version, , signature] = token.split('.')

    // Act & Assert
    expect(verifyToken(`${version}.${expiry + 1000}.${signature}`, 'slug-1', access, NOW)).toBe(false)
    expect(verifyToken(`v2.${expiry}.${signature}`, 'slug-1', access, NOW)).toBe(false)
    expect(verifyToken(`${token}x`, 'slug-1', access, NOW)).toBe(false)
    expect(verifyToken('', 'slug-1', access, NOW)).toBe(false)
    expect(verifyToken('v1.abc.def', 'slug-1', access, NOW)).toBe(false)
    expect(verifyToken(`v1.${expiry}`, 'slug-1', access, NOW)).toBe(false)
  })
})
