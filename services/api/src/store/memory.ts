import { ConflictException, NotFoundException } from '@peregrinus/core'

import type { Doc, DocSummary, DocumentStore, Kind, PutInput, Scope } from './types.js'

const summaryOf = ({ id, name, version, updatedAt, updatedBy }: Doc): DocSummary => ({
  id,
  name,
  version,
  updatedAt,
  updatedBy
})

/** The version check every store shares: create needs `null` and a free id, a save needs the version it read. */
export const nextVersion = (kind: Kind, input: PutInput, current: number | undefined): number => {
  if (input.expectedVersion === null && current !== undefined) {
    throw new ConflictException(`The ${kind} "${input.id}" already exists`)
  }
  if (input.expectedVersion !== null && current === undefined) {
    throw new NotFoundException(`The ${kind} "${input.id}" does not exist`)
  }
  if (input.expectedVersion !== null && input.expectedVersion !== current) {
    throw new ConflictException(
      `The ${kind} "${input.id}" is at version ${current}, not ${input.expectedVersion}: someone saved it first`
    )
  }
  return (current ?? 0) + 1
}

export type MemoryStore = DocumentStore & { dump(): [string, Doc][]; load(entries: [string, Doc][]): void }

const keyOf = (scope: Scope, kind: Kind, id: string): string => `${scope}#${kind}#${id}`

/** Everything in a Map. Used by the tests and, wrapped by the file store, by the local server. */
export const createMemoryStore = (): MemoryStore => {
  const docs = new Map<string, Doc>()
  return {
    list: async (scope, kind) =>
      [...docs.entries()]
        .filter(([key]) => key.startsWith(`${scope}#${kind}#`))
        .map(([, doc]) => summaryOf(doc))
        .sort((a, b) => a.name.localeCompare(b.name)),
    get: async (scope, kind, id) => {
      const doc = docs.get(keyOf(scope, kind, id))
      return doc ? structuredClone(doc) : undefined
    },
    put: async (scope, kind, input) => {
      const version = nextVersion(kind, input, docs.get(keyOf(scope, kind, input.id))?.version)
      const doc: Doc = {
        id: input.id,
        name: input.name,
        version,
        updatedAt: input.now.toISOString(),
        updatedBy: input.by,
        value: structuredClone(input.value)
      }
      docs.set(keyOf(scope, kind, input.id), doc)
      return structuredClone(doc)
    },
    remove: async (scope, kind, id) => docs.delete(keyOf(scope, kind, id)),
    dump: () => [...docs.entries()].map(([key, doc]) => [key, structuredClone(doc)]),
    load: (entries) => {
      docs.clear()
      for (const [key, doc] of entries) {
        docs.set(key, doc)
      }
    }
  }
}
