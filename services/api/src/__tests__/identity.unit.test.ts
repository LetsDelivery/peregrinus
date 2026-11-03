import { beforeAll, describe, expect, test } from 'bun:test'

import { ForbiddenException, UnauthenticatedException } from '@peregrinus/core'
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose'

import { assertAdmitted, type Claims, cognitoIdentity, requireToken } from '../identity.js'

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test'
const AUDIENCE = 'client-123'

let privateKey: CryptoKey
let verifier: ReturnType<typeof cognitoIdentity>

const sign = async (claims: Record<string, unknown>, options: { audience?: string; expires?: string } = {}) =>
  await new SignJWT({ token_use: 'id', email: 'ana@uselets.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('sub-1')
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expires ?? '1h')
    .sign(privateKey)

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  verifier = cognitoIdentity({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) })
})

describe('cognitoIdentity', () => {
  test('accepts a valid ID token and returns who it proves', async () => {
    // Arrange
    const token = await sign({ name: 'Ana' })

    // Act
    const admitted = await verifier.verify(token)

    // Assert
    expect(admitted?.caller).toEqual({ subject: 'sub-1', email: 'ana@uselets.com', name: 'Ana' })
  })

  test('refuses a token minted for another client', async () => {
    // Arrange
    const token = await sign({}, { audience: 'someone-else' })

    // Act & Assert
    expect(await verifier.verify(token)).toBeUndefined()
  })

  test('refuses an access token of the same pool', async () => {
    // Arrange
    const token = await sign({ token_use: 'access' })

    // Act & Assert
    expect(await verifier.verify(token)).toBeUndefined()
  })

  test('refuses an expired token and a token that is not a JWT', async () => {
    // Arrange
    const expired = await sign({}, { expires: '-1h' })

    // Act & Assert
    expect(await verifier.verify(expired)).toBeUndefined()
    expect(await verifier.verify('not-a-jwt')).toBeUndefined()
  })
})

describe('assertAdmitted', () => {
  const claims = (overrides: Partial<Claims>): Claims => ({
    sub: 's',
    email: 'ana@uselets.com',
    email_verified: true,
    hd: 'uselets.com',
    ...overrides
  })
  const domains = ['uselets.com', 'lets.delivery']

  test('admits a verified address of an allowed domain', () => {
    // Act & Assert
    expect(() => assertAdmitted(claims({}), domains)).not.toThrow()
    expect(() => assertAdmitted(claims({ email: 'bo@lets.delivery', hd: 'uselets.com' }), domains)).not.toThrow()
  })

  test('admits the string form of the verified flag a gateway authorizer produces', () => {
    // Act & Assert
    expect(() => assertAdmitted(claims({ email_verified: 'true' }), domains)).not.toThrow()
  })

  test('refuses an address with no hd: a company address on a personal Google account is not a managed person', () => {
    // Arrange
    const { hd: _removed, ...personalAccount } = claims({})

    // Act & Assert
    expect(() => assertAdmitted(personalAccount, domains)).toThrow(ForbiddenException)
  })

  test('refuses an address of another domain, an unverified one, and a foreign hd', () => {
    // Act & Assert
    expect(() => assertAdmitted(claims({ email: 'ana@gmail.com' }), domains)).toThrow(ForbiddenException)
    expect(() => assertAdmitted(claims({ email_verified: false }), domains)).toThrow(ForbiddenException)
    expect(() => assertAdmitted(claims({ 'custom:hd': 'other.com' }), domains)).toThrow(ForbiddenException)
  })
})

describe('requireToken', () => {
  test('reads a bearer token and refuses a missing or malformed header', () => {
    // Act & Assert
    expect(requireToken('Bearer abc.def')).toBe('abc.def')
    expect(() => requireToken(null)).toThrow(UnauthenticatedException)
    expect(() => requireToken('Basic abc')).toThrow(UnauthenticatedException)
  })
})
