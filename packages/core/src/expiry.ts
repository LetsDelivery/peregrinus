import { z } from 'zod'

import { InvalidRequestException } from './exceptions.js'

/**
 * Until when a publication opens, as the person picks it: a number of days from now, a date, or never. The server
 * turns it into one instant in UTC with `resolveExpiry`, so the panel and the page never disagree about the time.
 */
export const expirySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('days'), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal('date'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal('never') })
])

export type Expiry = z.infer<typeof expirySchema>

/** What a publication gets when the author does not choose: 30 days. */
export const DEFAULT_EXPIRY: Expiry = { kind: 'days', days: 30 }

const DAY_MS = 86_400_000

/** The instant (ISO, UTC) the expiry stands for, or null for never. A date counts until the end of that day in UTC. */
export const resolveExpiry = (expiry: Expiry, now: Date): string | null => {
  if (expiry.kind === 'never') {
    return null
  }
  if (expiry.kind === 'days') {
    return new Date(now.getTime() + expiry.days * DAY_MS).toISOString()
  }
  const end = new Date(`${expiry.date}T23:59:59.999Z`)
  if (Number.isNaN(end.getTime()) || !end.toISOString().startsWith(expiry.date)) {
    throw new InvalidRequestException(`expiry: "${expiry.date}" is not a date`)
  }
  if (end.getTime() <= now.getTime()) {
    throw new InvalidRequestException(`expiry: ${expiry.date} is in the past`)
  }
  return end.toISOString()
}

export const isExpired = (expiresAt: string | null, now: Date): boolean =>
  expiresAt !== null && now.getTime() >= Date.parse(expiresAt)
