import { randomBytes } from 'node:crypto'

import { InvalidRequestException, type Role, UnauthenticatedException } from '@postmano/core'
import type { SendDeps } from '@postmano/send'
import type { z } from 'zod'

import type { AccessState } from './access-state.js'
import { assertAdmitted, type Caller, type ClaimsVerifier, requireToken } from './identity.js'
import type { DocumentStore } from './store/types.js'
import { requireRole } from './workspaces.js'

export type ApiDeps = {
  identity: ClaimsVerifier | undefined
  allowedDomains: readonly string[]
  /** Local only: `x-local-user: ana@uselets.com` stands in for the sign-in. Never on in the deployed stack. */
  localUsers: boolean
  /** Hands the proxy its own fetch and resolver in tests; the system's otherwise. */
  send?: SendDeps
  store: DocumentStore
  /** The wrong passwords, the locks and the last access of the published pages. Required: a lock must never be a no-op. */
  access: AccessState
  now?: () => Date
  newId?: () => string
  /** The random part of a published page's address. Tests hand over a fixed one. */
  newSlug?: () => string
}

export type Params = Record<string, string>
/** `role` is the caller's role in the workspace of the route, set by `inWorkspace`. */
export type Context = { request: Request; caller: Caller; deps: ApiDeps; params: Params; role?: Role }
export type Handler = (context: Context) => Promise<unknown>

/** What fits in a Lambda payload; a bigger body is refused before it is read. */
export const MAX_BODY_BYTES = 5_500_000

/** A route that works with or without a sign-in: the handler decides what a stranger may see. */
export type OpenContext = Omit<Context, 'caller'> & { caller: Caller | undefined }
export type OpenHandler = (context: OpenContext) => Promise<unknown>

export const readJson = async (request: Request): Promise<unknown> => {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new InvalidRequestException(`The request body is larger than ${MAX_BODY_BYTES} bytes`)
  }
  try {
    return await request.json()
  } catch {
    throw new InvalidRequestException('The request body is not valid JSON')
  }
}

export const parse = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new InvalidRequestException(`${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`)
  }
  return result.data
}

export const authenticate = async (request: Request, deps: ApiDeps): Promise<Caller> => {
  const local = deps.localUsers ? request.headers.get('x-local-user') : null
  if (local) {
    return { subject: `local:${local}`, email: local }
  }
  if (!deps.identity) {
    throw new UnauthenticatedException('Sign-in is not configured')
  }
  const admitted = await deps.identity.verify(requireToken(request.headers.get('authorization')))
  if (!admitted) {
    throw new UnauthenticatedException('The token is invalid or expired')
  }
  assertAdmitted(admitted.claims, deps.allowedDomains)
  return admitted.caller
}

/** With no credentials at all the caller is nobody; with bad ones it is still a 401, never a quiet downgrade. */
export const authenticateOptional = async (request: Request, deps: ApiDeps): Promise<Caller | undefined> => {
  const hasLocal = deps.localUsers && request.headers.get('x-local-user')
  return hasLocal || request.headers.get('authorization') ? await authenticate(request, deps) : undefined
}

export const clock = (deps: ApiDeps): Date => (deps.now ?? (() => new Date()))()
export const stamp = (deps: ApiDeps) => ({ now: clock(deps), id: (deps.newId ?? (() => crypto.randomUUID()))() })

export const newSlug = (deps: ApiDeps): string => (deps.newSlug ?? (() => randomBytes(16).toString('base64url')))()

export const describeDoc = (doc: { id: string; version: number; updatedAt: string; updatedBy: string }) => ({
  id: doc.id,
  version: doc.version,
  updatedAt: doc.updatedAt,
  updatedBy: doc.updatedBy
})

/** The workspace id of the route. Every handler below `inWorkspace` can rely on the caller being a member. */
export const scopeOf = ({ params }: Context): string => params.ws ?? ''

export const inWorkspace =
  (needed: Role, handler: Handler): Handler =>
  async (context) => {
    const { role } = await requireRole(context.deps.store, scopeOf(context), context.caller.email, needed)
    return await handler({ ...context, role })
  }

/** A route is either signed-in only (`handler` gets a caller) or open (`handler` gets a caller that may be nobody). */
export type Route =
  | { method: string; pattern: RegExp; handler: Handler; open?: false }
  | { method: string; pattern: RegExp; handler: OpenHandler; open: true }

const pathPattern = (path: string): RegExp => new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[A-Za-z0-9_-]{1,64})')}$`)

export const route = (method: string, path: string, handler: Handler): Route => ({
  method,
  pattern: pathPattern(path),
  handler
})

export const openRoute = (method: string, path: string, handler: OpenHandler): Route => ({
  method,
  pattern: pathPattern(path),
  handler,
  open: true
})
