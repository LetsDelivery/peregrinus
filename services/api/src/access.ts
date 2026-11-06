import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import type { Access } from '@postmano/core'

/**
 * The access password of a `password` publication and the token that proves it was given.
 *
 * The password is made here, shown once, and only its scrypt hash is kept. The token needs no secret of its own: it
 * is signed with the stored hash, so it stops being good the moment the password changes, and nothing has to be
 * kept or rotated besides what the publication already holds.
 */
const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>

/** No 0/O, 1/l/I: the password is read from a screen and typed by a person. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PASSWORD_LENGTH = 16
const KEY_BYTES = 32

export const newPassword = (): string =>
  Array.from({ length: PASSWORD_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

/** The hash to keep for a password. `version` goes up with every change, so an old token never matches a new one. */
export const hashPassword = async (password: string, version: number, now: Date): Promise<Access> => {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, KEY_BYTES)
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), version, setAt: now.toISOString() }
}

/** Compares in constant time. */
export const checkPassword = async (password: string, access: Access): Promise<boolean> => {
  const expected = Buffer.from(access.hash, 'base64')
  const given = await derive(password, Buffer.from(access.salt, 'base64'), expected.length)
  return timingSafeEqual(given, expected)
}

export const TOKEN_TTL_MS = 8 * 3_600_000

const signature = (slug: string, access: Access, expiresAt: number): string =>
  createHmac('sha256', Buffer.from(access.hash, 'base64'))
    .update(`${slug}|${expiresAt}|${access.version}`)
    .digest('base64url')

/** A token for this page, good until `expiresAt` (epoch ms): `v1.<expiry>.<signature>`. */
export const signToken = (slug: string, access: Access, expiresAt: number): string =>
  `v1.${expiresAt}.${signature(slug, access, expiresAt)}`

/** True only for a token that this page's current password signed and that has not expired. */
export const verifyToken = (token: string, slug: string, access: Access, now: Date): boolean => {
  const [version, expiry, given] = token.split('.')
  const expiresAt = Number(expiry)
  if (version !== 'v1' || given === undefined || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return false
  }
  const expected = Buffer.from(signature(slug, access, expiresAt))
  const actual = Buffer.from(given)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
