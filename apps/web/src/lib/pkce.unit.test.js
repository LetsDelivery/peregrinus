import { describe, expect, test } from 'bun:test'

import { base64url, challengeOf, randomString } from './pkce.js'

describe('pkce', () => {
  test('derives the S256 challenge of the RFC 7636 appendix B verifier', async () => {
    // Arrange
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

    // Act
    const challenge = await challengeOf(verifier)

    // Assert
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('encodes base64url without padding, plus or slash', () => {
    // Arrange
    const bytes = new Uint8Array([251, 255, 254])

    // Act
    const encoded = base64url(bytes)

    // Assert
    expect(encoded).toBe('-__-')
  })

  test('makes a random string that is url safe, long enough and different each time', () => {
    // Act
    const first = randomString()
    const second = randomString()

    // Assert
    expect(first).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(first).not.toBe(second)
  })
})
