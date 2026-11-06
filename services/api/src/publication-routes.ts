import { expirySchema, InvalidRequestException, publicationSchema } from '@postmano/core'
import { z } from 'zod'

import {
  authenticateOptional,
  clock,
  type Handler,
  inWorkspace,
  newSlug,
  type OpenHandler,
  openRoute,
  parse,
  readJson,
  route,
  scopeOf,
  stamp
} from './http.js'
import { createPublication, listPublications, removePublication, updatePublication } from './publications.js'
import { openPublished, submitPassword } from './published.js'

/**
 * What a person sends to publish: the publication itself, how long it lasts, and a yes to going on when a page for
 * people outside the company has credentials. `expiry` left out keeps what the page has (30 days for a new one).
 */
const createBody = publicationSchema.extend({
  expiry: expirySchema.optional(),
  acknowledgeSecrets: z.boolean().default(false)
})
const updateBody = createBody.extend({
  version: z.number().int().min(1),
  /** A new password for a page with one: ends any lock and every open session. */
  rotatePassword: z.boolean().default(false)
})
const passwordBody = z.object({ password: z.string().min(1).max(200) })

/** Header with the token a correct password gave. Only the page of a `password` publication reads it. */
const TOKEN_HEADER = 'x-docs-token'

const list: Handler = async (context) => {
  const collectionId = new URL(context.request.url).searchParams.get('collectionId')
  return { items: await listPublications(context.deps, scopeOf(context), collectionId, clock(context.deps)) }
}

const create: Handler = async (context) => {
  const { acknowledgeSecrets, expiry, ...input } = parse(createBody, await readJson(context.request))
  const { now } = stamp(context.deps)
  return await createPublication(context.deps, {
    workspaceId: scopeOf(context),
    role: context.role ?? 'viewer',
    slug: newSlug(context.deps),
    input,
    expiry,
    by: context.caller.email,
    now,
    allowedDomains: context.deps.allowedDomains,
    acknowledgeSecrets
  })
}

const update: Handler = async (context) => {
  const { acknowledgeSecrets, expiry, version, rotatePassword, ...input } = parse(
    updateBody,
    await readJson(context.request)
  )
  const { now } = stamp(context.deps)
  return await updatePublication(context.deps, {
    workspaceId: scopeOf(context),
    role: context.role ?? 'viewer',
    slug: context.params.slug ?? '',
    version,
    input,
    expiry,
    rotatePassword,
    by: context.caller.email,
    now,
    allowedDomains: context.deps.allowedDomains,
    acknowledgeSecrets
  })
}

const remove: Handler = async (context) => {
  await removePublication(context.deps, context.role ?? 'viewer', scopeOf(context), context.params.slug ?? '')
  return { deleted: context.params.slug }
}

/** The page itself. It works with no sign-in only for a public link, or for a password page with its token. */
const open: OpenHandler = async ({ request, deps, params }) => {
  const caller = await authenticateOptional(request, deps)
  if (!params.slug) {
    throw new InvalidRequestException('slug: required')
  }
  const token = request.headers.get(TOKEN_HEADER) ?? undefined
  return await openPublished(deps, params.slug, { caller, token }, clock(deps))
}

/** The access password of a page: a session token when it is right. No sign-in. */
const access: OpenHandler = async ({ request, deps, params }) => {
  if (!params.slug) {
    throw new InvalidRequestException('slug: required')
  }
  const { password } = parse(passwordBody, await readJson(request))
  return await submitPassword(deps, params.slug, password, clock(deps))
}

const W = '/v1/workspaces/:ws'

export const publicationRoutes = [
  route('GET', `${W}/docs`, inWorkspace('editor', list)),
  route('POST', `${W}/docs`, inWorkspace('editor', create)),
  route('PUT', `${W}/docs/:slug`, inWorkspace('editor', update)),
  route('DELETE', `${W}/docs/:slug`, inWorkspace('editor', remove)),
  openRoute('GET', '/v1/docs/:slug', open),
  openRoute('POST', '/v1/docs/:slug/access', access)
]
