/**
 * What a publication remembers about who tried to open it: the wrong passwords (and the lock they cause) and the
 * last time it was opened. It lives apart from the publication, in items of its own, because it changes on every
 * visit and must never make an admin's save fail with a version conflict.
 */
export const MAX_FAILURES = 5
/** The panel warns from this many wrong passwords on. */
export const WARN_FROM = 3
export const LOCK_MS = 15 * 60_000
/** Wrong passwords older than this no longer count. */
export const WINDOW_MS = 15 * 60_000
/** The last access is written at most this often per publication. */
export const TOUCH_EVERY_MS = 3_600_000

export type Failure = { failures: number; lockedUntil: Date | undefined }

export interface AccessState {
  /** Until when no password is accepted for the publication, or undefined when it is not locked. */
  lockedUntil(slug: string, now: Date): Promise<Date | undefined>
  /** Counts one wrong password. Locks the publication at `MAX_FAILURES`. Atomic: parallel guesses all count. */
  registerFailure(slug: string, now: Date): Promise<Failure>
  /** Forgets the wrong passwords and the lock: after the right password, or when an admin changes it. */
  clear(slug: string): Promise<void>
  /** Notes an access, at most once an hour. Never throws: a visit must not fail because of a note. */
  touch(slug: string, now: Date): Promise<void>
  lastAccess(slug: string): Promise<Date | undefined>
  /** Forgets everything about a publication that was removed. */
  forget(slug: string): Promise<void>
}

type Attempts = { failures: number; windowEnd: number; lockedUntil?: number }

/** The same rules in a Map: for the tests and for the server on this machine. */
export const createMemoryAccessState = (): AccessState => {
  const attempts = new Map<string, Attempts>()
  const last = new Map<string, number>()
  return {
    lockedUntil: async (slug, now) => {
      const until = attempts.get(slug)?.lockedUntil
      return until !== undefined && until > now.getTime() ? new Date(until) : undefined
    },
    registerFailure: async (slug, now) => {
      const current = attempts.get(slug)
      const fresh = current === undefined || current.windowEnd < now.getTime()
      const next: Attempts = fresh
        ? { failures: 1, windowEnd: now.getTime() + WINDOW_MS }
        : { ...current, failures: current.failures + 1 }
      if (next.failures >= MAX_FAILURES && next.lockedUntil === undefined) {
        next.lockedUntil = now.getTime() + LOCK_MS
      }
      attempts.set(slug, next)
      return {
        failures: next.failures,
        lockedUntil: next.lockedUntil === undefined ? undefined : new Date(next.lockedUntil)
      }
    },
    clear: async (slug) => {
      attempts.delete(slug)
    },
    touch: async (slug, now) => {
      const before = last.get(slug)
      if (before === undefined || before <= now.getTime() - TOUCH_EVERY_MS) {
        last.set(slug, now.getTime())
      }
    },
    lastAccess: async (slug) => {
      const at = last.get(slug)
      return at === undefined ? undefined : new Date(at)
    },
    forget: async (slug) => {
      attempts.delete(slug)
      last.delete(slug)
    }
  }
}
