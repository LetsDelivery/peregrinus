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

/**
 * Base of every error the API turns into a response. The panel picks its pt-BR text from `code`,
 * never from `message`, which is English and names the offending value.
 */
export class AppException extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, status: number, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.status = status
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

export type ErrorBody = { error: { code: ErrorCode | 'internal'; message: string } }

/** The JSON body of an error response. Anything that is not an `AppException` is a 500 with no detail. */
export const errorBody = (error: unknown): ErrorBody =>
  error instanceof AppException
    ? { error: { code: error.code, message: error.message } }
    : { error: { code: 'internal', message: 'Unexpected error' } }

export const errorStatus = (error: unknown): number => (error instanceof AppException ? error.status : 500)
