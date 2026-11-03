export type Kind = 'collection' | 'environment' | 'workspace' | 'publication'

/** The place a document lives in: a workspace id, or `GLOBAL` for the workspaces themselves. */
export type Scope = string

export const GLOBAL: Scope = 'GLOBAL'

export type DocSummary = { id: string; name: string; version: number; updatedAt: string; updatedBy: string }

export type Doc = DocSummary & { value: unknown }

export type PutInput = {
  id: string
  name: string
  value: unknown
  /** The version the caller last read; `null` to create. A different one is a conflict. */
  expectedVersion: number | null
  by: string
  now: Date
}

/**
 * Where collections and environments live. One document per id, saved whole, with a version that goes up on
 * every save so two people editing the same collection cannot overwrite each other without knowing.
 */
export interface DocumentStore {
  list(scope: Scope, kind: Kind): Promise<DocSummary[]>
  get(scope: Scope, kind: Kind, id: string): Promise<Doc | undefined>
  put(scope: Scope, kind: Kind, input: PutInput): Promise<Doc>
  /** `false` when there was no such document. */
  remove(scope: Scope, kind: Kind, id: string): Promise<boolean>
}
