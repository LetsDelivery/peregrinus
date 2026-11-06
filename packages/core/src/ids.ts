import type { Collection, Node } from './model.js'

/** 12 URL-safe characters from 72 random bits. Works in the browser, in Node and in bun. */
export const newNodeId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

const walk = (items: readonly Node[], visit: (node: Node) => void): void => {
  for (const node of items) {
    visit(node)
    if (node.kind === 'folder') {
      walk(node.children, visit)
    }
  }
}

/**
 * Gives an id to every folder and request that has none, and a new one to the second of two that share an id (a copy
 * pasted in). Changes the collection in place. Returns whether anything changed.
 */
export const ensureIds = (collection: Collection, make: () => string = newNodeId): boolean => {
  const seen = new Set<string>()
  let changed = false
  walk(collection.items, (node) => {
    if (node.id === undefined || seen.has(node.id)) {
      node.id = make()
      changed = true
    }
    seen.add(node.id)
  })
  return changed
}

/** True when every folder and request has an id. */
export const hasAllIds = (collection: Collection): boolean => {
  let all = true
  walk(collection.items, (node) => {
    all &&= node.id !== undefined
  })
  return all
}

/** The ids of every request of the collection, folders left out. */
export const requestIds = (collection: Collection): string[] => {
  const ids: string[] = []
  walk(collection.items, (node) => {
    if (node.kind === 'request' && node.id !== undefined) {
      ids.push(node.id)
    }
  })
  return ids
}
