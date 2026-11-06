export type ErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unsafe_content'
  | 'blocked_destination'
  | 'upstream_failed'
  | 'upstream_timeout'
  | 'response_too_large'
  | 'expired'
  | 'password_required'
  | 'invalid_password'
  | 'locked'

/**
 * Base of every error the API turns into a response. The panel picks its pt-BR text from `code`,
 * never from `message`, which is English and names the offending value.
 */
export class AppException extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** Facts the panel needs besides the code, such as how many attempts are left. Never a secret. */
  readonly data: Record<string, string | number> | undefined

  constructor(code: ErrorCode, status: number, message: string, data?: Record<string, string | number>) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.status = status
    this.data = data
  }
}

export class InvalidRequestException extends AppException {
  constructor(message: string) {
    super('invalid_request', 400, message)
  }
}

export class UnauthenticatedException extends AppException {
  constructor(message: string) {
    super('unauthenticated', 401, message)
  }
}

export class ForbiddenException extends AppException {
  constructor(message: string) {
    super('forbidden', 403, message)
  }
}

export class NotFoundException extends AppException {
  constructor(message: string) {
    super('not_found', 404, message)
  }
}

/** Someone else saved a newer version, or the name is taken. */
export class ConflictException extends AppException {
  constructor(message: string) {
    super('conflict', 409, message)
  }
}

/** The content looks like it carries credentials and the request was to share it with no sign-in. */
export class UnsafeContentException extends AppException {
  constructor(message: string) {
    super('unsafe_content', 422, message)
  }
}

/** The proxy refused to connect: the address is not one a request may reach. */
export class BlockedDestinationException extends AppException {
  constructor(message: string) {
    super('blocked_destination', 422, message)
  }
}

export class UpstreamException extends AppException {
  constructor(message: string) {
    super('upstream_failed', 502, message)
  }
}

export class UpstreamTimeoutException extends AppException {
  constructor(message: string) {
    super('upstream_timeout', 504, message)
  }
}

export class ResponseTooLargeException extends AppException {
  constructor(message: string) {
    super('response_too_large', 502, message)
  }
}

/** The publication was valid until a date, and that date has passed. */
export class ExpiredException extends AppException {
  constructor(message: string) {
    super('expired', 410, message)
  }
}

/** The page needs its access password: none was given, or the token for it is no longer good. */
export class PasswordRequiredException extends AppException {
  constructor() {
    super('password_required', 401, 'This documentation needs its access password')
  }
}

/** A wrong password. `attemptsLeft` is what remains before the publication locks. */
export class InvalidPasswordException extends AppException {
  constructor(attemptsLeft: number) {
    super('invalid_password', 401, 'The password is not right', { attemptsLeft })
  }
}

/** Too many wrong passwords: nothing opens it, the right password included, until `lockedUntil` (ISO, UTC). */
export class LockedException extends AppException {
  constructor(lockedUntil: string) {
    super('locked', 429, 'Too many wrong passwords; try again later', { lockedUntil })
  }
}

export type ErrorBody = {
  error: { code: ErrorCode | 'internal'; message: string; data?: Record<string, string | number> }
}

/** The JSON body of an error response. Anything that is not an `AppException` is a 500 with no detail. */
export const errorBody = (error: unknown): ErrorBody =>
  error instanceof AppException
    ? { error: { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) } }
    : { error: { code: 'internal', message: 'Unexpected error' } }

export const errorStatus = (error: unknown): number => (error instanceof AppException ? error.status : 500)
