import { InvalidRequestException, publicationSchema } from '@postmano/core'
import { z } from 'zod'

import {
  authenticateOptional,
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
import {
  createPublication,
  listPublications,
  openPublished,
  removePublication,
  updatePublication
} from './publications.js'

/** What a person sends to publish: the publication itself, and a yes to going on when a public link has credentials. */
const createBody = publicationSchema.extend({ acknowledgeSecrets: z.boolean().default(false) })
const updateBody = createBody.extend({ version: z.number().int().min(1) })

const list: Handler = async (context) => {
  const collectionId = new URL(context.request.url).searchParams.get('collectionId')
  return { items: await listPublications(context.deps.store, scopeOf(context), collectionId) }
}

const create: Handler = async (context) => {
  const { acknowledgeSecrets, ...input } = parse(createBody, await readJson(context.request))
  const { now } = stamp(context.deps)
  return await createPublication(context.deps.store, {
    workspaceId: scopeOf(context),
    slug: newSlug(context.deps),
    input,
    by: context.caller.email,
    now,
    allowedDomains: context.deps.allowedDomains,
    acknowledgeSecrets
  })
}

const update: Handler = async (context) => {
  const { acknowledgeSecrets, version, ...input } = parse(updateBody, await readJson(context.request))
  const { now } = stamp(context.deps)
  return await updatePublication(context.deps.store, {
    workspaceId: scopeOf(context),
    slug: context.params.slug ?? '',
    version,
    input,
    by: context.caller.email,
    now,
    allowedDomains: context.deps.allowedDomains,
    acknowledgeSecrets
  })
}

const remove: Handler = async (context) => {
  await removePublication(context.deps.store, scopeOf(context), context.params.slug ?? '')
  return { deleted: context.params.slug }
}

/** The page itself. It works with no sign-in only when the publication is a public link. */
const open: OpenHandler = async ({ request, deps, params }) => {
  const caller = await authenticateOptional(request, deps)
  if (!params.slug) {
    throw new InvalidRequestException('slug: required')
  }
  return await openPublished(deps.store, params.slug, caller)
}

const W = '/v1/workspaces/:ws'

export const publicationRoutes = [
  route('GET', `${W}/docs`, inWorkspace('editor', list)),
  route('POST', `${W}/docs`, inWorkspace('editor', create)),
  route('PUT', `${W}/docs/:slug`, inWorkspace('editor', update)),
  route('DELETE', `${W}/docs/:slug`, inWorkspace('editor', remove)),
  openRoute('GET', '/v1/docs/:slug', open)
]
