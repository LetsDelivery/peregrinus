import {
  type Collection,
  collectionSchema,
  ExpiredException,
  ForbiddenException,
  findSecrets,
  findSecretsInVariables,
  InvalidPasswordException,
  isExpired,
  isExternal,
  LockedException,
  NotFoundException,
  PasswordRequiredException,
  type Publication,
  publicVariables,
  publicView,
  type StoredPublication,
  storedPublicationSchema,
  UnauthenticatedException,
  type Variable,
  variableSchema,
  type Workspace,
  workspaceSchema
} from '@postmano/core'
import { z } from 'zod'
import { checkPassword, signToken, TOKEN_TTL_MS, verifyToken } from './access.js'
import { MAX_FAILURES } from './access-state.js'
import type { Caller } from './identity.js'
import type { Deps } from './publications.js'
import { type DocumentStore, GLOBAL } from './store/types.js'
import { roleOf } from './workspaces.js'

/**
 * Opening a published page. The rule is checked on every open, with the live members of the workspace, so a leaked
 * link of a restricted page opens nothing. Only `link` and a `password` page need no company login, and they say so.
 */
export type Published = {
  title: string
  collection: Collection
  /** The non-secret variables the examples may fill in: the collection's, then the environment's on top. */
  variables: Record<string, string>
  language: Publication['language']
  visibility: Publication['visibility']
  updatedAt: string
  /** When it stops opening (UTC), or null. */
  expiresAt: string | null
}

const MISSING = 'This documentation link does not exist, or was removed'

type Found = { workspaceId: string; publication: StoredPublication }

/** The publication behind a slug. A page saved before selections, with no selection, is closed until saved again. */
const find = async (store: DocumentStore, slug: string): Promise<Found> => {
  const pointer = await store.get(GLOBAL, 'publication', slug)
  const workspaceId = (pointer?.value as { workspaceId: string } | undefined)?.workspaceId
  const doc = workspaceId ? await store.get(workspaceId, 'publication', slug) : undefined
  if (!workspaceId || !doc) {
    throw new NotFoundException(MISSING)
  }
  const publication = storedPublicationSchema.parse(doc.value)
  if (publication.selection === null && (publication.folderPath?.length ?? 0) > 0) {
    throw new NotFoundException(MISSING)
  }
  return { workspaceId, publication }
}

const mayOpen = (publication: StoredPublication, workspace: Workspace, caller: Caller): boolean => {
  const role = roleOf(workspace, caller.email)
  if (role === 'admin' || role === 'editor') {
    return true
  }
  switch (publication.visibility) {
    case 'company':
      return true
    case 'workspace':
      return role !== undefined
    case 'people':
      return publication.people.some((email) => email.toLowerCase() === caller.email.toLowerCase())
    default:
      return false
  }
}

type Who = { caller: Caller | undefined; token: string | undefined }

const assertNotExpired = (publication: StoredPublication, now: Date): void => {
  if (isExpired(publication.expiresAt, now)) {
    throw new ExpiredException('This access expired')
  }
}

const assertPasswordSession = (publication: StoredPublication, slug: string, token: string | undefined, now: Date) => {
  if (!token || !publication.access || !verifyToken(token, slug, publication.access, now)) {
    throw new PasswordRequiredException()
  }
}

const assertMember = async (store: DocumentStore, found: Found, who: Who): Promise<void> => {
  if (!who.caller) {
    throw new UnauthenticatedException('Sign in to open this documentation')
  }
  const workspace = await store.get(GLOBAL, 'workspace', found.workspaceId)
  if (!workspace || !mayOpen(found.publication, workspaceSchema.parse(workspace.value), who.caller)) {
    throw new ForbiddenException(`${who.caller.email} may not open this documentation`)
  }
}

const assertMayOpen = async (store: DocumentStore, found: Found, slug: string, who: Who, now: Date): Promise<void> => {
  const { publication } = found
  if (publication.visibility === 'link') {
    return assertNotExpired(publication, now)
  }
  if (publication.visibility === 'password') {
    assertNotExpired(publication, now)
    return assertPasswordSession(publication, slug, who.token, now)
  }
  // A page for the team says nothing, not even that it expired, to someone who may not open it.
  await assertMember(store, found, who)
  assertNotExpired(publication, now)
}

const toRecord = (variables: readonly Variable[]): Record<string, string> =>
  Object.fromEntries(publicVariables(variables).map((variable) => [variable.key, variable.value]))

export const environmentSchema = z.object({ variables: z.array(variableSchema) })

const environmentVariables = async (store: DocumentStore, workspaceId: string, id: string | null) => {
  const doc = id ? await store.get(workspaceId, 'environment', id) : undefined
  return doc ? environmentSchema.parse(doc.value).variables : []
}

/**
 * What was approved when the page was published may have changed since. A selection that lost every request has
 * nothing to show, and a page for people outside the company must still be free of credentials, unless the author
 * said to go on. Either way the page answers as a missing one, and its author sees why on the next save.
 */
const assertStillThere = (
  publication: StoredPublication,
  collection: Collection,
  view: Collection,
  environment: readonly Variable[]
): void => {
  if (publication.selection !== null && view.items.length === 0) {
    throw new NotFoundException(MISSING)
  }
  const leaks = isExternal(publication.visibility) && !publication.acknowledged
  if (
    leaks &&
    (findSecrets(collection, publication.selection).length > 0 ||
      findSecretsInVariables(environment, 'environment').length > 0)
  ) {
    throw new NotFoundException(MISSING)
  }
}

/** What the page at `slug` shows to whoever this is. Everything secret is taken out before it returns. */
export const openPublished = async (deps: Deps, slug: string, who: Who, now: Date): Promise<Published> => {
  const found = await find(deps.store, slug)
  const { workspaceId, publication } = found
  await assertMayOpen(deps.store, found, slug, who, now)
  const source = await deps.store.get(workspaceId, 'collection', publication.collectionId)
  if (!source) {
    throw new NotFoundException(MISSING)
  }
  const full = collectionSchema.parse(source.value)
  const collection = publicView(full, publication.selection)
  const environment = await environmentVariables(deps.store, workspaceId, publication.environmentId)
  assertStillThere(publication, full, collection, environment)
  await deps.access.touch(slug, now)
  return {
    title: publication.title,
    collection,
    variables: {
      ...toRecord(collection.variables),
      ...toRecord(environment)
    },
    language: publication.language,
    visibility: publication.visibility,
    updatedAt: source.updatedAt,
    expiresAt: publication.expiresAt
  }
}

export type Session = { token: string; expiresAt: string }

/**
 * The access password of a `password` page. While the page is locked nothing is checked, the right password
 * included, so a lock cannot be guessed through. A session that was open before the lock keeps working: a stranger's
 * wrong guesses must not close the page on the customer who is reading it. A wrong one counts; the fifth locks. A right one ends the count and
 * opens a session of 8 hours, or until the page expires, whichever comes first.
 */
export const submitPassword = async (deps: Deps, slug: string, password: string, now: Date): Promise<Session> => {
  const { publication } = await find(deps.store, slug)
  if (publication.visibility !== 'password' || !publication.access) {
    throw new NotFoundException(MISSING)
  }
  assertNotExpired(publication, now)
  const locked = await deps.access.lockedUntil(slug, now)
  if (locked) {
    throw new LockedException(locked.toISOString())
  }
  if (!(await checkPassword(password, publication.access))) {
    const failure = await deps.access.registerFailure(slug, now)
    if (failure.lockedUntil) {
      throw new LockedException(failure.lockedUntil.toISOString())
    }
    throw new InvalidPasswordException(MAX_FAILURES - failure.failures)
  }
  // Parallel guesses all passed the check above, so the lock is read again: a guess that lands in a lock is refused.
  const lockedNow = await deps.access.lockedUntil(slug, now)
  if (lockedNow) {
    throw new LockedException(lockedNow.toISOString())
  }
  await deps.access.clear(slug)
  await deps.access.touch(slug, now)
  const end = Math.min(
    now.getTime() + TOKEN_TTL_MS,
    publication.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(publication.expiresAt)
  )
  return { token: signToken(slug, publication.access, end), expiresAt: new Date(end).toISOString() }
}
