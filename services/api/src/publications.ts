import {
  type Access,
  type Collection,
  collectionSchema,
  DEFAULT_EXPIRY,
  type Expiry,
  ForbiddenException,
  findSecrets,
  findSecretsInVariables,
  hasAllIds,
  InvalidRequestException,
  isExternal,
  MAX_SEEN,
  NotFoundException,
  type Publication,
  type Role,
  requestIds,
  resolveExpiry,
  type SecretFinding,
  type StoredPublication,
  selectionHealth,
  storedPublicationSchema,
  UnsafeContentException,
  type Visibility
} from '@postmano/core'
import { hashPassword, newPassword } from './access.js'
import type { AccessState } from './access-state.js'
import { environmentSchema } from './published.js'
import { type Doc, type DocumentStore, GLOBAL } from './store/types.js'

/**
 * Published documentation, as it is managed: made, changed, listed and taken down. Opening a page is in
 * `published.ts`.
 *
 * A publication is a collection, whole or a selection of its requests, at an address that opens in the panel, with
 * its own rule for who may open it and until when. The address holds a random slug, so it cannot be guessed. A
 * publication is kept in its workspace, and a pointer in the global scope turns the slug back into the workspace,
 * because the address names no workspace.
 *
 * A page with a password is for a customer outside the company, so only a workspace admin makes, changes or removes
 * one. The password is made here, returned once, and only its hash is kept.
 */
export type Deps = { store: DocumentStore; access: AccessState }

export type PublicationView = Pick<
  StoredPublication,
  'collectionId' | 'title' | 'visibility' | 'people' | 'selection' | 'environmentId' | 'language' | 'expiresAt'
> & {
  slug: string
  version: number
  updatedAt: string
  updatedBy: string
  /** A page with a password is the admins' alone: an editor sees it and may not touch it. */
  adminOnly: boolean
  passwordSetAt: string | null
  lockedUntil: string | null
  lastAccessAt: string | null
  /** For a selection: how many ticked requests were deleted, and how many the collection gained since. */
  health: { removed: number; added: number } | null
}

export type Saved = {
  publication: PublicationView
  warnings: SecretFinding[]
  /** The access password, in the clear, only in the answer that made or changed it. */
  password?: string
}

const stored = (doc: Doc): StoredPublication => storedPublicationSchema.parse(doc.value)

const readCollection = async (
  store: DocumentStore,
  workspaceId: string,
  id: string
): Promise<Collection | undefined> => {
  const doc = await store.get(workspaceId, 'collection', id)
  return doc ? collectionSchema.parse(doc.value) : undefined
}

const healthOf = (publication: StoredPublication, collection: Collection | undefined): PublicationView['health'] =>
  publication.selection !== null && collection
    ? selectionHealth(collection, publication.selection, publication.seen)
    : null

/** What the panel gets of a stored publication: never the hash, plus what has to be read from elsewhere. */
const present = async (
  deps: Deps,
  doc: Doc,
  collection: Collection | undefined,
  now: Date
): Promise<PublicationView> => {
  const publication = stored(doc)
  const [locked, last] = await Promise.all([
    publication.visibility === 'password' ? deps.access.lockedUntil(doc.id, now) : undefined,
    deps.access.lastAccess(doc.id)
  ])
  return {
    collectionId: publication.collectionId,
    title: publication.title,
    visibility: publication.visibility,
    people: publication.people,
    selection: publication.selection,
    environmentId: publication.environmentId,
    language: publication.language,
    expiresAt: publication.expiresAt,
    slug: doc.id,
    version: doc.version,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
    adminOnly: publication.visibility === 'password',
    passwordSetAt: publication.access?.setAt ?? null,
    lockedUntil: locked?.toISOString() ?? null,
    lastAccessAt: last?.toISOString() ?? null,
    health: healthOf(publication, collection)
  }
}

export const listPublications = async (
  deps: Deps,
  workspaceId: string,
  collectionId: string | null,
  now: Date
): Promise<PublicationView[]> => {
  const summaries = await deps.store.list(workspaceId, 'publication')
  const docs = await Promise.all(summaries.map((summary) => deps.store.get(workspaceId, 'publication', summary.id)))
  const wanted = docs
    .flatMap((doc) => (doc ? [doc] : []))
    .filter((doc) => collectionId === null || stored(doc).collectionId === collectionId)
  const collections = new Map<string, Collection | undefined>()
  for (const id of new Set(wanted.map((doc) => stored(doc).collectionId))) {
    collections.set(id, await readCollection(deps.store, workspaceId, id))
  }
  const views = await Promise.all(
    wanted.map((doc) => present(deps, doc, collections.get(stored(doc).collectionId), now))
  )
  return views.sort((a, b) => a.title.localeCompare(b.title))
}

const domainOf = (email: string): string => email.split('@')[1]?.toLowerCase() ?? ''

const checkPeople = (input: Publication, allowedDomains: readonly string[]): void => {
  const allowed = allowedDomains.map((domain) => domain.toLowerCase())
  if (input.visibility === 'people' && input.people.length === 0) {
    throw new InvalidRequestException('people: add at least one address, or choose another visibility')
  }
  const outsider = input.people.find((email) => !allowed.includes(domainOf(email)))
  if (outsider) {
    throw new InvalidRequestException(`people: ${outsider} is not of an allowed domain (${allowed.join(', ')})`)
  }
}

/** The values of the environment the page uses go into its examples, so they are scanned like the collection. */
const environmentFindings = async (
  store: DocumentStore,
  workspaceId: string,
  input: Publication
): Promise<SecretFinding[]> => {
  const doc = input.environmentId ? await store.get(workspaceId, 'environment', input.environmentId) : undefined
  return doc ? findSecretsInVariables(environmentSchema.parse(doc.value).variables, `environment ${doc.name}`) : []
}

const checkEnvironment = async (store: DocumentStore, workspaceId: string, input: Publication): Promise<void> => {
  if (input.environmentId && !(await store.get(workspaceId, 'environment', input.environmentId))) {
    throw new InvalidRequestException(`environmentId: "${input.environmentId}" does not exist in this workspace`)
  }
}

/** A selection must name requests that exist, and the collection must have ids to be named by. */
const checkSelection = (collection: Collection, selection: readonly string[] | null): void => {
  if (selection === null) {
    return
  }
  if (selection.length === 0) {
    throw new InvalidRequestException('selection: tick at least one request, or publish the whole collection')
  }
  if (!hasAllIds(collection)) {
    throw new InvalidRequestException('selection: the collection has items without an id; save it first')
  }
  if (requestIds(collection).length > MAX_SEEN) {
    throw new InvalidRequestException(`selection: the collection has more than ${MAX_SEEN} requests; publish it whole`)
  }
  const known = new Set(requestIds(collection))
  const unknown = selection.find((id) => !known.has(id))
  if (unknown !== undefined) {
    throw new InvalidRequestException(`selection: "${unknown}" is not a request of this collection`)
  }
}

type Checked = { warnings: SecretFinding[]; seen: string[]; collection: Collection }

/** Checks everything a publication points at, and what the page would show. Returns what looks like a credential. */
const validate = async (
  store: DocumentStore,
  workspaceId: string,
  input: Publication,
  allowedDomains: readonly string[]
): Promise<Checked> => {
  const collection = await readCollection(store, workspaceId, input.collectionId)
  if (!collection) {
    throw new NotFoundException(`The collection "${input.collectionId}" does not exist in this workspace`)
  }
  checkSelection(collection, input.selection)
  checkPeople(input, allowedDomains)
  await checkEnvironment(store, workspaceId, input)
  // Only a selection compares the collection with what it has seen; a page of the whole collection follows it.
  const seen = input.selection === null ? [] : requestIds(collection)
  const warnings = [
    ...findSecrets(collection, input.selection),
    ...(await environmentFindings(store, workspaceId, input))
  ]
  return { warnings, seen, collection }
}

const describeFindings = (findings: readonly SecretFinding[]): string =>
  findings
    .slice(0, 5)
    .map((finding) => `"${finding.path}" has ${finding.kind}`)
    .join('; ')

/** A page for people outside the company over text that looks like credentials is refused, unless the author goes on. */
const guard = (input: Publication, findings: readonly SecretFinding[], acknowledged: boolean): void => {
  if (isExternal(input.visibility) && findings.length > 0 && !acknowledged) {
    throw new UnsafeContentException(
      `This collection has text that looks like credentials (${describeFindings(findings)}). Take it out, or confirm to publish it for people outside the company`
    )
  }
}

/** Only a workspace admin touches a page with a password: not to make one, change it, nor move a page to or from it. */
const assertMayManage = (role: Role, current: Visibility | undefined, next: Visibility | undefined): void => {
  if ((current === 'password' || next === 'password') && role !== 'admin') {
    throw new ForbiddenException('Only a workspace admin may create, change or remove a page with a password')
  }
}

export type Write = {
  workspaceId: string
  role: Role
  input: Publication
  /** Not sent: keep what it has (30 days for a new one). Sent: the new rule. */
  expiry?: Expiry | undefined
  /** Make a new password for a `password` page, which ends any lock and every open session. */
  rotatePassword?: boolean | undefined
  by: string
  now: Date
  allowedDomains: readonly string[]
  acknowledgeSecrets: boolean
}

type Issued = { access: Access; password?: string }

const issue = async (version: number, now: Date): Promise<Issued> => {
  const password = newPassword()
  return { access: await hashPassword(password, version, now), password }
}

/** The access a page has after a save: none off a password page, a new one when it becomes one or is renewed. */
const accessAfter = async (
  before: StoredPublication,
  next: Visibility,
  renew: boolean,
  now: Date
): Promise<Issued | undefined> => {
  if (next !== 'password') {
    return undefined
  }
  if (before.visibility !== 'password' || !before.access) {
    return await issue(1, now)
  }
  return renew ? await issue(before.access.version + 1, now) : { access: before.access }
}

const recordOf = (
  write: Write,
  checked: Checked,
  expiresAt: string | null,
  access: Access | undefined
): StoredPublication => ({
  ...write.input,
  seen: checked.seen,
  expiresAt,
  // Said yes to what was found at this save, not to whatever an editor adds later.
  acknowledged: write.acknowledgeSecrets && checked.warnings.length > 0,
  ...(access ? { access } : {})
})

const putPointer = async (store: DocumentStore, write: Write & { slug: string }): Promise<void> => {
  await store.put(GLOBAL, 'publication', {
    id: write.slug,
    name: write.workspaceId,
    value: { workspaceId: write.workspaceId },
    expectedVersion: null,
    by: write.by,
    now: write.now
  })
}

/** The pointer is written first: an address that answers is always backed by a page, and a failure leaves nothing. */
export const createPublication = async (deps: Deps, write: Write & { slug: string }): Promise<Saved> => {
  assertMayManage(write.role, undefined, write.input.visibility)
  const checked = await validate(deps.store, write.workspaceId, write.input, write.allowedDomains)
  guard(write.input, checked.warnings, write.acknowledgeSecrets)
  const expiresAt = resolveExpiry(write.expiry ?? DEFAULT_EXPIRY, write.now)
  const issued = write.input.visibility === 'password' ? await issue(1, write.now) : undefined
  await putPointer(deps.store, write)
  try {
    const doc = await deps.store.put(write.workspaceId, 'publication', {
      id: write.slug,
      name: write.input.title,
      value: recordOf(write, checked, expiresAt, issued?.access),
      expectedVersion: null,
      by: write.by,
      now: write.now
    })
    const publication = await present(deps, doc, checked.collection, write.now)
    return { publication, warnings: checked.warnings, ...(issued?.password ? { password: issued.password } : {}) }
  } catch (error) {
    // The page and its address go together. A failed clean-up must not hide why the publish failed.
    await deps.store.remove(GLOBAL, 'publication', write.slug).catch(() => undefined)
    await deps.store.remove(write.workspaceId, 'publication', write.slug).catch(() => undefined)
    throw error
  }
}

/**
 * A save also puts the pointer back if it is missing, so a page that lost it by a half-failed publish heals. A
 * password page that gets a new date gets a new password too: renewing never reopens the old one.
 */
export const updatePublication = async (
  deps: Deps,
  write: Write & { slug: string; version: number }
): Promise<Saved> => {
  const current = await deps.store.get(write.workspaceId, 'publication', write.slug)
  if (!current) {
    throw new NotFoundException(`The publication "${write.slug}" does not exist in this workspace`)
  }
  const before = stored(current)
  assertMayManage(write.role, before.visibility, write.input.visibility)
  const checked = await validate(deps.store, write.workspaceId, write.input, write.allowedDomains)
  guard(write.input, checked.warnings, write.acknowledgeSecrets)
  const expiresAt = write.expiry ? resolveExpiry(write.expiry, write.now) : before.expiresAt
  const renew = write.rotatePassword === true || expiresAt !== before.expiresAt
  const issued = await accessAfter(before, write.input.visibility, renew, write.now)
  // Before the save: a failure here changes nothing, and one after it would lose a password nobody has seen yet.
  if (issued?.password || (before.visibility === 'password' && write.input.visibility !== 'password')) {
    await deps.access.clear(write.slug)
  }
  const doc = await deps.store.put(write.workspaceId, 'publication', {
    id: write.slug,
    name: write.input.title,
    value: recordOf(write, checked, expiresAt, issued?.access),
    expectedVersion: write.version,
    by: write.by,
    now: write.now
  })
  if (!(await deps.store.get(GLOBAL, 'publication', write.slug))) {
    await putPointer(deps.store, write)
  }
  const publication = await present(deps, doc, checked.collection, write.now)
  return { publication, warnings: checked.warnings, ...(issued?.password ? { password: issued.password } : {}) }
}

/** The pointer goes first: from then on the address answers 404, and what is left behind is only unreachable. */
const unpublish = async (deps: Deps, workspaceId: string, slug: string): Promise<void> => {
  await deps.store.remove(GLOBAL, 'publication', slug)
  await deps.store.remove(workspaceId, 'publication', slug)
  await deps.access.forget(slug)
}

/** Takes a page down. It must be in this workspace, or the address is not this workspace's to remove. */
export const removePublication = async (deps: Deps, role: Role, workspaceId: string, slug: string): Promise<void> => {
  const doc = await deps.store.get(workspaceId, 'publication', slug)
  if (!doc) {
    throw new NotFoundException(`The publication "${slug}" does not exist in this workspace`)
  }
  assertMayManage(role, stored(doc).visibility, undefined)
  await unpublish(deps, workspaceId, slug)
}

/** Takes down every page of a workspace, or only those over one collection, for when what they show is deleted. */
export const removePublicationsOf = async (
  deps: Deps,
  workspaceId: string,
  collectionId: string | null
): Promise<void> => {
  for (const view of await listPublications(deps, workspaceId, collectionId, new Date())) {
    await unpublish(deps, workspaceId, view.slug)
  }
}
