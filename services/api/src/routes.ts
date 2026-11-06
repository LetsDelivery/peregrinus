import {
  AppException,
  authSchema,
  collectionSchema,
  ensureIds,
  errorBody,
  errorStatus,
  InvalidRequestException,
  memberSchema,
  NotFoundException,
  type Role,
  requestSchema,
  variableSchema,
  viewerView
} from '@postmano/core'
import { importPostmanCollection } from '@postmano/postman'
import { effectiveAuth, prepareRequest, sendRequest } from '@postmano/send'
import { z as zod } from 'zod'

import {
  type ApiDeps,
  authenticate,
  authenticateOptional,
  clock,
  describeDoc,
  type Handler,
  inWorkspace,
  type Params,
  parse,
  type Route,
  readJson,
  route,
  scopeOf,
  stamp
} from './http.js'
import { publicationRoutes } from './publication-routes.js'
import { removePublicationsOf } from './publications.js'
import type { Kind } from './store/types.js'
import { createTeam, deleteWorkspace, listFor, requireRole, updateWorkspace } from './workspaces.js'

const scopeSchema = zod.record(zod.string(), zod.string())

const sendBodySchema = zod.object({
  request: requestSchema,
  /** The auths of the folders and the collection above the request, closest first, for "inherit". */
  parents: zod.array(authSchema).default([]),
  variables: zod
    .object({ local: scopeSchema, environment: scopeSchema, collection: scopeSchema, global: scopeSchema })
    .partial()
    .default({}),
  options: zod
    .object({
      timeoutMs: zod.number().int().min(1).max(25_000),
      maxRedirects: zod.number().int().min(0).max(10),
      insecureTls: zod.boolean()
    })
    .partial()
    .default({})
})

const me: Handler = async ({ caller }) => caller

const importPostman: Handler = async ({ request }) => importPostmanCollection(await readJson(request))

const send: Handler = async ({ request, deps }) => {
  const body = parse(sendBodySchema, await readJson(request))
  const { local = {}, environment = {}, collection = {}, global = {} } = body.variables
  const auth = effectiveAuth(body.request.auth, body.parents)
  const prepared = prepareRequest(body.request, auth, [local, environment, collection, global])
  const result = await sendRequest(prepared, body.options, deps.send)
  return { result, unresolved: prepared.unresolved }
}

const collectionBody = zod.object({ collection: collectionSchema, version: zod.number().int().min(1).optional() })
const environmentBody = zod.object({
  name: zod.string().min(1).max(120),
  variables: zod.array(variableSchema),
  version: zod.number().int().min(1).optional()
})
const workspaceCreateBody = zod.object({ name: zod.string().min(1).max(80) })
const workspaceChangeBody = zod.object({
  name: zod.string().min(1).max(80),
  members: zod.array(memberSchema).min(1).max(200),
  version: zod.number().int().min(1)
})

const listWorkspaces: Handler = async ({ caller, deps }) => ({
  items: await listFor(deps.store, caller.email, clock(deps))
})

const createWorkspace: Handler = async ({ request, caller, deps }) => {
  const body = parse(workspaceCreateBody, await readJson(request))
  const { id, now } = stamp(deps)
  return await createTeam(deps.store, { id, name: body.name, creator: caller.email, now })
}

const getWorkspace: Handler = async ({ caller, deps, params }) => {
  const { doc, workspace, role } = await requireRole(deps.store, params.ws ?? '', caller.email, 'viewer')
  const members =
    role === 'admin' ? workspace.members : workspace.members.filter((member) => member.email === caller.email)
  return { id: doc.id, name: workspace.name, personal: workspace.personal, role, version: doc.version, members }
}

const changeWorkspace: Handler = async ({ request, caller, deps, params }) => {
  const access = await requireRole(deps.store, params.ws ?? '', caller.email, 'admin')
  const body = parse(workspaceChangeBody, await readJson(request))
  return await updateWorkspace(deps.store, access, body, {
    allowedDomains: deps.allowedDomains,
    by: caller.email,
    now: clock(deps)
  })
}

const removeWorkspace: Handler = async ({ caller, deps, params }) => {
  const access = await requireRole(deps.store, params.ws ?? '', caller.email, 'admin')
  if (!access.workspace.personal) {
    await removePublicationsOf(deps, access.doc.id, null)
  }
  await deleteWorkspace(deps.store, access)
  return { deleted: params.ws }
}

const listDocs =
  (kind: Kind): Handler =>
  async (context) => ({ items: await context.deps.store.list(scopeOf(context), kind) })

const environmentSchema = zod.object({ variables: zod.array(variableSchema) })

/** A viewer reads a collection or an environment without its secret values: they are for the people who can edit it. */
const maskFor = (kind: Kind, value: unknown, role: Role | undefined): unknown => {
  if (role !== 'viewer') {
    return value
  }
  if (kind === 'collection') {
    return viewerView(collectionSchema.parse(value))
  }
  const environment = environmentSchema.parse(value)
  return {
    variables: environment.variables.map((variable) => (variable.secret ? { ...variable, value: '' } : variable))
  }
}

const getDoc =
  (kind: Kind, field: string): Handler =>
  async (context) => {
    const doc = await context.deps.store.get(scopeOf(context), kind, context.params.id ?? '')
    if (!doc) {
      throw new NotFoundException(`The ${kind} "${context.params.id}" does not exist`)
    }
    const value = maskFor(kind, doc.value, context.role)
    return { ...describeDoc(doc), name: doc.name, [field]: value }
  }

const deleteDoc =
  (kind: Kind): Handler =>
  async (context) => {
    const id = context.params.id ?? ''
    if (kind === 'collection') {
      await removePublicationsOf(context.deps, scopeOf(context), id)
    }
    if (!(await context.deps.store.remove(scopeOf(context), kind, id))) {
      throw new NotFoundException(`The ${kind} "${id}" does not exist`)
    }
    return { deleted: id }
  }

/** A create has no version to match; a save must name the version the person read. */
const expectedVersion = (create: boolean, version: number | undefined, what: string): number | null => {
  if (create) {
    return null
  }
  if (version === undefined) {
    throw new InvalidRequestException(`version: required to save ${what}; send the version you read`)
  }
  return version
}

const saveCollection =
  (create: boolean): Handler =>
  async (context) => {
    const body = parse(collectionBody, await readJson(context.request))
    const { now, id } = stamp(context.deps)
    // Every folder and request leaves here with a fixed id, which a publication refers to.
    ensureIds(body.collection)
    const doc = await context.deps.store.put(scopeOf(context), 'collection', {
      id: create ? id : (context.params.id ?? ''),
      name: body.collection.name,
      value: body.collection,
      expectedVersion: expectedVersion(create, body.version, 'a collection'),
      by: context.caller.email,
      now
    })
    return { ...describeDoc(doc), collection: body.collection }
  }

/** Gives ids to a collection saved before they existed, so a selection can name its requests. Saves only if needed. */
const ensureCollectionIds: Handler = async (context) => {
  const id = context.params.id ?? ''
  const doc = await context.deps.store.get(scopeOf(context), 'collection', id)
  if (!doc) {
    throw new NotFoundException(`The collection "${id}" does not exist`)
  }
  const collection = collectionSchema.parse(doc.value)
  if (!ensureIds(collection)) {
    return { ...describeDoc(doc), collection }
  }
  const { now } = stamp(context.deps)
  const saved = await context.deps.store.put(scopeOf(context), 'collection', {
    id,
    name: collection.name,
    value: collection,
    expectedVersion: doc.version,
    by: context.caller.email,
    now
  })
  return { ...describeDoc(saved), collection }
}

const saveEnvironment =
  (create: boolean): Handler =>
  async (context) => {
    const body = parse(environmentBody, await readJson(context.request))
    const { now, id } = stamp(context.deps)
    const doc = await context.deps.store.put(scopeOf(context), 'environment', {
      id: create ? id : (context.params.id ?? ''),
      name: body.name,
      value: { variables: body.variables },
      expectedVersion: expectedVersion(create, body.version, 'an environment'),
      by: context.caller.email,
      now
    })
    return describeDoc(doc)
  }

const W = '/v1/workspaces/:ws'

const routes: Route[] = [
  route('GET', '/v1/me', me),
  route('POST', '/v1/imports/postman', importPostman),
  route('POST', '/v1/send', send),
  route('GET', '/v1/workspaces', listWorkspaces),
  route('POST', '/v1/workspaces', createWorkspace),
  route('GET', W, getWorkspace),
  route('PUT', W, changeWorkspace),
  route('DELETE', W, removeWorkspace),
  route('GET', `${W}/collections`, inWorkspace('viewer', listDocs('collection'))),
  route('POST', `${W}/collections`, inWorkspace('editor', saveCollection(true))),
  route('GET', `${W}/collections/:id`, inWorkspace('viewer', getDoc('collection', 'collection'))),
  route('PUT', `${W}/collections/:id`, inWorkspace('editor', saveCollection(false))),
  route('POST', `${W}/collections/:id/ids`, inWorkspace('editor', ensureCollectionIds)),
  route('DELETE', `${W}/collections/:id`, inWorkspace('editor', deleteDoc('collection'))),
  route('GET', `${W}/environments`, inWorkspace('viewer', listDocs('environment'))),
  route('POST', `${W}/environments`, inWorkspace('editor', saveEnvironment(true))),
  route('GET', `${W}/environments/:id`, inWorkspace('viewer', getDoc('environment', 'environment'))),
  route('PUT', `${W}/environments/:id`, inWorkspace('editor', saveEnvironment(false))),
  route('DELETE', `${W}/environments/:id`, inWorkspace('editor', deleteDoc('environment'))),
  ...publicationRoutes
]

const match = (request: Request): { route: Route; params: Params } | undefined => {
  const { pathname } = new URL(request.url)
  for (const candidate of routes) {
    const found = candidate.method === request.method ? candidate.pattern.exec(pathname) : null
    if (found) {
      return { route: candidate, params: { ...found.groups } }
    }
  }
  return undefined
}

const dispatch = async (request: Request, deps: ApiDeps): Promise<Response> => {
  if (request.method === 'GET' && new URL(request.url).pathname === '/v1/health') {
    return Response.json({ status: 'ok' })
  }
  const found = match(request)
  if (!found) {
    throw new NotFoundException(`No route for ${request.method} ${new URL(request.url).pathname}`)
  }
  const { route: matched, params } = found
  if (matched.open) {
    const caller = await authenticateOptional(request, deps)
    return Response.json(await matched.handler({ request, caller, deps, params }))
  }
  const caller = await authenticate(request, deps)
  return Response.json(await matched.handler({ request, caller, deps, params }))
}

const fail = (error: unknown): Response => {
  if (!(error instanceof AppException)) {
    console.error(JSON.stringify({ message: 'Unhandled error', error: String(error) }))
  }
  return Response.json(errorBody(error), { status: errorStatus(error) })
}

/** The API as a function from a web `Request` to a `Response`, so the local server and the Lambda share it. */
export const createHandler =
  (deps: ApiDeps) =>
  async (request: Request): Promise<Response> =>
    await dispatch(request, deps).catch(fail)

export type { ApiDeps } from './http.js'
