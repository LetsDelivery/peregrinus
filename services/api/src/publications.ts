import {
  type Collection,
  collectionSchema,
  ForbiddenException,
  findSecrets,
  folderNamesAt,
  InvalidRequestException,
  NotFoundException,
  type Publication,
  publicVariables,
  publicView,
  type SecretFinding,
  type StoredPublication,
  storedPublicationSchema,
  UnauthenticatedException,
  UnsafeContentException,
  type Variable,
  variableSchema,
  type Workspace,
  workspaceSchema
} from '@peregrinus/core'

import { z } from 'zod'

import type { Caller } from './identity.js'
import { type Doc, type DocumentStore, GLOBAL } from './store/types.js'
import { roleOf } from './workspaces.js'

/**
 * Published documentation: a collection (or one folder of it) at an address that opens in the panel, as the
 * Swagger page of an API does, with its own rule for who may open it.
 *
 * The address holds a random slug, so it cannot be guessed, and the rule is still checked on every open: a leaked
 * link does not widen who can read it, except for `link`, which says so. A publication is kept in its workspace,
 * and a pointer in the global scope turns the slug back into the workspace, because the address names no workspace.
 */
export type PublicationView = Publication & {
  slug: string
  version: number
  updatedAt: string
  updatedBy: string
}

export type Published = {
  title: string
  collection: Collection
  /** The non-secret variables the examples may fill in: the collection's, then the environment's on top. */
  variables: Record<string, string>
  language: Publication['language']
  visibility: Publication['visibility']
  updatedAt: string
}

const stored = (doc: Doc): StoredPublication => storedPublicationSchema.parse(doc.value)

const viewOf = (doc: Doc): PublicationView => ({
  ...stored(doc),
  slug: doc.id,
  version: doc.version,
  updatedAt: doc.updatedAt,
  updatedBy: doc.updatedBy
})

export const listPublications = async (
  store: DocumentStore,
  workspaceId: string,
  collectionId: string | null
): Promise<PublicationView[]> => {
  const summaries = await store.list(workspaceId, 'publication')
  const docs = await Promise.all(summaries.map((summary) => store.get(workspaceId, 'publication', summary.id)))
  return docs
    .flatMap((doc) => (doc ? [viewOf(doc)] : []))
    .filter((view) => collectionId === null || view.collectionId === collectionId)
    .sort((a, b) => a.title.localeCompare(b.title))
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

const checkEnvironment = async (store: DocumentStore, workspaceId: string, input: Publication): Promise<void> => {
  if (input.environmentId && !(await store.get(workspaceId, 'environment', input.environmentId))) {
    throw new InvalidRequestException(`environmentId: "${input.environmentId}" does not exist in this workspace`)
  }
}

type Checked = { warnings: SecretFinding[]; folderNames: string[] }

/** Checks everything a publication points at, and what the page would show. Returns what looks like a credential. */
const validate = async (
  store: DocumentStore,
  workspaceId: string,
  input: Publication,
  allowedDomains: readonly string[]
): Promise<Checked> => {
  const doc = await store.get(workspaceId, 'collection', input.collectionId)
  if (!doc) {
    throw new NotFoundException(`The collection "${input.collectionId}" does not exist in this workspace`)
  }
  const collection = collectionSchema.parse(doc.value)
  const folderNames = folderNamesAt(collection, input.folderPath)
  checkPeople(input, allowedDomains)
  await checkEnvironment(store, workspaceId, input)
  return { warnings: findSecrets(collection, input.folderPath), folderNames }
}

const describeFindings = (findings: readonly SecretFinding[]): string =>
  findings
    .slice(0, 5)
    .map((finding) => `"${finding.path}" has ${finding.kind}`)
    .join('; ')

/** A link with no sign-in over text that looks like a credential is refused, unless the author says to go on. */
const guard = (input: Publication, findings: readonly SecretFinding[], acknowledged: boolean): void => {
  if (input.visibility === 'link' && findings.length > 0 && !acknowledged) {
    throw new UnsafeContentException(
      `This collection has text that looks like credentials (${describeFindings(findings)}). Take it out, or confirm to publish it with a public link`
    )
  }
}

export type Write = {
  workspaceId: string
  input: Publication
  by: string
  now: Date
  allowedDomains: readonly string[]
  acknowledgeSecrets: boolean
}

const recordOf = (write: Write, checked: Checked): StoredPublication => ({
  ...write.input,
  folderNames: checked.folderNames,
  acknowledged: write.acknowledgeSecrets
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
export const createPublication = async (
  store: DocumentStore,
  write: Write & { slug: string }
): Promise<{ publication: PublicationView; warnings: SecretFinding[] }> => {
  const checked = await validate(store, write.workspaceId, write.input, write.allowedDomains)
  guard(write.input, checked.warnings, write.acknowledgeSecrets)
  await putPointer(store, write)
  try {
    const doc = await store.put(write.workspaceId, 'publication', {
      id: write.slug,
      name: write.input.title,
      value: recordOf(write, checked),
      expectedVersion: null,
      by: write.by,
      now: write.now
    })
    return { publication: viewOf(doc), warnings: checked.warnings }
  } catch (error) {
    await store.remove(GLOBAL, 'publication', write.slug)
    throw error
  }
}

/** A save also puts the pointer back if it is missing, so a page that lost it by a half-failed publish heals. */
export const updatePublication = async (
  store: DocumentStore,
  write: Write & { slug: string; version: number }
): Promise<{ publication: PublicationView; warnings: SecretFinding[] }> => {
  const checked = await validate(store, write.workspaceId, write.input, write.allowedDomains)
  guard(write.input, checked.warnings, write.acknowledgeSecrets)
  const doc = await store.put(write.workspaceId, 'publication', {
    id: write.slug,
    name: write.input.title,
    value: recordOf(write, checked),
    expectedVersion: write.version,
    by: write.by,
    now: write.now
  })
  if (!(await store.get(GLOBAL, 'publication', write.slug))) {
    await putPointer(store, write)
  }
  return { publication: viewOf(doc), warnings: checked.warnings }
}

/**
 * Takes a page down. The page must be in this workspace, or the address is not this workspace's to remove. The
 * pointer goes first: from then on the address answers 404, and what is left behind is only unreachable.
 */
export const removePublication = async (store: DocumentStore, workspaceId: string, slug: string): Promise<void> => {
  if (!(await store.get(workspaceId, 'publication', slug))) {
    throw new NotFoundException(`The publication "${slug}" does not exist in this workspace`)
  }
  await store.remove(GLOBAL, 'publication', slug)
  await store.remove(workspaceId, 'publication', slug)
}

/** Takes down every page of a workspace, or only those over one collection, for when what they show is deleted. */
export const removePublicationsOf = async (
  store: DocumentStore,
  workspaceId: string,
  collectionId: string | null
): Promise<void> => {
  for (const view of await listPublications(store, workspaceId, collectionId)) {
    await removePublication(store, workspaceId, view.slug)
  }
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

const assertMayOpen = async (
  store: DocumentStore,
  workspaceId: string,
  publication: StoredPublication,
  caller: Caller | undefined
): Promise<void> => {
  if (publication.visibility === 'link') {
    return
  }
  if (!caller) {
    throw new UnauthenticatedException('Sign in to open this documentation')
  }
  const workspace = await store.get(GLOBAL, 'workspace', workspaceId)
  if (!workspace || !mayOpen(publication, workspaceSchema.parse(workspace.value), caller)) {
    throw new ForbiddenException(`${caller.email} may not open this documentation`)
  }
}

const toRecord = (variables: readonly Variable[]): Record<string, string> =>
  Object.fromEntries(publicVariables(variables).map((variable) => [variable.key, variable.value]))

const environmentSchema = z.object({ variables: z.array(variableSchema) })

const environmentVariables = async (store: DocumentStore, workspaceId: string, id: string | null) => {
  const doc = id ? await store.get(workspaceId, 'environment', id) : undefined
  return doc ? toRecord(environmentSchema.parse(doc.value).variables) : {}
}

/**
 * What was approved when the page was published may have changed since. The folders must still be where they were
 * (a moved folder would show something else), and a public link must still be free of credentials, unless the author
 * said to go on. Either way the page answers as a missing one, and its author sees why on the next save.
 */
const foldersMoved = (publication: StoredPublication, collection: Collection): boolean => {
  try {
    const names = folderNamesAt(collection, publication.folderPath)
    return names.join('\u0000') !== publication.folderNames.join('\u0000')
  } catch {
    return true
  }
}

const assertStillThere = (publication: StoredPublication, collection: Collection, missing: Error): void => {
  if (foldersMoved(publication, collection)) {
    throw missing
  }
  const leaks = publication.visibility === 'link' && !publication.acknowledged
  if (leaks && findSecrets(collection, publication.folderPath).length > 0) {
    throw missing
  }
}

/** What the page at `slug` shows to `caller` (or to nobody). Everything secret is taken out before it returns. */
export const openPublished = async (
  store: DocumentStore,
  slug: string,
  caller: Caller | undefined
): Promise<Published> => {
  const missing = new NotFoundException('This documentation link does not exist, or was removed')
  const pointer = await store.get(GLOBAL, 'publication', slug)
  const workspaceId = (pointer?.value as { workspaceId: string } | undefined)?.workspaceId
  const doc = workspaceId ? await store.get(workspaceId, 'publication', slug) : undefined
  if (!workspaceId || !doc) {
    throw missing
  }
  const publication = stored(doc)
  await assertMayOpen(store, workspaceId, publication, caller)
  const source = await store.get(workspaceId, 'collection', publication.collectionId)
  if (!source) {
    throw missing
  }
  const full = collectionSchema.parse(source.value)
  assertStillThere(publication, full, missing)
  const collection = publicView(full, publication.folderPath)
  return {
    title: publication.title,
    collection,
    variables: {
      ...toRecord(collection.variables),
      ...(await environmentVariables(store, workspaceId, publication.environmentId))
    },
    language: publication.language,
    visibility: publication.visibility,
    updatedAt: source.updatedAt
  }
}
