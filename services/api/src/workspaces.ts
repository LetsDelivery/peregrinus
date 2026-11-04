import { createHash } from 'node:crypto'

import {
  ConflictException,
  ForbiddenException,
  InvalidRequestException,
  type Member,
  NotFoundException,
  type Role,
  type Workspace,
  workspaceSchema
} from '@postmano/core'

import { type Doc, type DocumentStore, GLOBAL } from './store/types.js'

/**
 * Workspaces: the unit that owns collections and environments and the people who may use them. A person
 * gets one of their own (personal, private) and can create or be invited to team workspaces. The role a
 * person has in a workspace decides what they may do there: a viewer reads, an editor changes, an admin
 * also manages the members and deletes the workspace.
 */
export type WorkspaceView = {
  id: string
  name: string
  personal: boolean
  role: Role
  version: number
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 }

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const personalId = (email: string): string =>
  `personal-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)}`

export const roleOf = (workspace: Workspace, email: string): Role | undefined =>
  workspace.members.find((member) => same(member.email, email))?.role

const viewOf = (doc: Doc, role: Role): WorkspaceView => {
  const workspace = workspaceSchema.parse(doc.value)
  return { id: doc.id, name: workspace.name, personal: workspace.personal, role, version: doc.version }
}

const create = async (store: DocumentStore, id: string, workspace: Workspace, by: string, now: Date): Promise<Doc> =>
  await store.put(GLOBAL, 'workspace', { id, name: workspace.name, value: workspace, expectedVersion: null, by, now })

/** Makes the person's own workspace the first time they show up. Two requests racing both end well. */
export const ensurePersonal = async (store: DocumentStore, email: string, now: Date): Promise<void> => {
  const id = personalId(email)
  if (await store.get(GLOBAL, 'workspace', id)) {
    return
  }
  const workspace: Workspace = { name: 'Meu workspace', personal: true, members: [{ email, role: 'admin' }] }
  await create(store, id, workspace, email, now).catch((error: unknown) => {
    if (!(error instanceof ConflictException)) {
      throw error
    }
  })
}

/** One unreadable workspace must not take the list down for everyone: it is logged and left out. */
const viewFor = async (store: DocumentStore, id: string, email: string): Promise<WorkspaceView | undefined> => {
  try {
    const doc = await store.get(GLOBAL, 'workspace', id)
    const role = doc ? roleOf(workspaceSchema.parse(doc.value), email) : undefined
    return doc && role ? viewOf(doc, role) : undefined
  } catch (error) {
    console.error(JSON.stringify({ message: 'Workspace could not be read', id, error: String(error) }))
    return undefined
  }
}

/** The workspaces the person belongs to, their own first. */
export const listFor = async (store: DocumentStore, email: string, now: Date): Promise<WorkspaceView[]> => {
  await ensurePersonal(store, email, now)
  const summaries = await store.list(GLOBAL, 'workspace')
  const views = await Promise.all(summaries.map((summary) => viewFor(store, summary.id, email)))
  return views
    .filter((view): view is WorkspaceView => view !== undefined)
    .sort((a, b) => Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name))
}

export type Access = { doc: Doc; workspace: Workspace; role: Role }

/** The workspace, if the person is a member with at least `needed`. A workspace that is not theirs is a 403. */
export const requireRole = async (store: DocumentStore, id: string, email: string, needed: Role): Promise<Access> => {
  const doc = await store.get(GLOBAL, 'workspace', id)
  if (!doc) {
    throw new NotFoundException(`The workspace "${id}" does not exist`)
  }
  const workspace = workspaceSchema.parse(doc.value)
  const role = roleOf(workspace, email)
  if (!role) {
    // Same answer as a workspace that does not exist: a stranger learns nothing about it, not even its name.
    throw new NotFoundException(`The workspace "${id}" does not exist`)
  }
  if (RANK[role] < RANK[needed]) {
    throw new ForbiddenException(
      `The workspace "${workspace.name}" needs the ${needed} role for this, and ${email} is ${role}`
    )
  }
  return { doc, workspace, role }
}

const domainOf = (email: string): string => email.split('@')[1]?.toLowerCase() ?? ''

/** Members of a team workspace: company addresses only, no repeats, and always someone who can manage it. */
export const validateMembers = (members: readonly Member[], allowedDomains: readonly string[]): void => {
  const allowed = allowedDomains.map((domain) => domain.toLowerCase())
  const seen = new Set<string>()
  for (const member of members) {
    const email = member.email.toLowerCase()
    if (!allowed.includes(domainOf(email))) {
      throw new InvalidRequestException(`members: ${member.email} is not of an allowed domain (${allowed.join(', ')})`)
    }
    if (seen.has(email)) {
      throw new InvalidRequestException(`members: ${member.email} is listed twice`)
    }
    seen.add(email)
  }
  if (!members.some((member) => member.role === 'admin')) {
    throw new InvalidRequestException('members: a workspace needs at least one admin')
  }
}

export const createTeam = async (
  store: DocumentStore,
  input: { id: string; name: string; creator: string; now: Date }
): Promise<WorkspaceView> => {
  const workspace: Workspace = { name: input.name, personal: false, members: [{ email: input.creator, role: 'admin' }] }
  const doc = await create(store, input.id, workspace, input.creator, input.now)
  return viewOf(doc, 'admin')
}

export type WorkspaceChange = { name: string; members: Member[]; version: number }

/** Renames a workspace and replaces its members. The personal one keeps its single admin. */
export const updateWorkspace = async (
  store: DocumentStore,
  access: Access,
  change: WorkspaceChange,
  context: { allowedDomains: readonly string[]; by: string; now: Date }
): Promise<WorkspaceView> => {
  const { workspace, doc } = access
  if (workspace.personal) {
    const [only] = change.members
    if (
      change.members.length !== 1 ||
      !same(only?.email ?? '', workspace.members[0]?.email ?? '') ||
      only?.role !== 'admin'
    ) {
      throw new InvalidRequestException(
        'members: a personal workspace belongs to one person, as admin, and cannot be shared'
      )
    }
  } else {
    validateMembers(change.members, context.allowedDomains)
  }
  const next: Workspace = { ...workspace, name: change.name, members: change.members }
  const saved = await store.put(GLOBAL, 'workspace', {
    id: doc.id,
    name: next.name,
    value: next,
    expectedVersion: change.version,
    by: context.by,
    now: context.now
  })
  return viewOf(saved, roleOf(next, context.by) ?? access.role)
}

/** Deletes a team workspace and the collections and environments in it. Its publications go first, by the caller. */
export const deleteWorkspace = async (store: DocumentStore, access: Access): Promise<void> => {
  if (access.workspace.personal) {
    throw new ForbiddenException('A personal workspace cannot be deleted')
  }
  for (const kind of ['collection', 'environment'] as const) {
    for (const summary of await store.list(access.doc.id, kind)) {
      await store.remove(access.doc.id, kind, summary.id)
    }
  }
  await store.remove(GLOBAL, 'workspace', access.doc.id)
}
