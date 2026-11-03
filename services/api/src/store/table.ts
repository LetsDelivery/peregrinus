export type Item = Record<string, unknown>
export type Key = { pk: string; sk: string }

export type TransactPut = {
  item: Item & Key
  /** `absent`: the item must not exist. `versionEquals`: its `version` must be this one. */
  condition?: { absent: true } | { versionEquals: number }
}

/**
 * The few DynamoDB operations the document store needs, so its logic is tested against a memory table and the
 * AWS adapter (`aws-table.ts`) stays thin.
 */
export interface TableClient {
  get(pk: string, sk: string): Promise<Item | undefined>
  /** Every item of the partition whose sort key starts with `skPrefix`, in sort-key order, across pages. */
  query(pk: string, skPrefix: string): Promise<Item[]>
  putMany(items: (Item & Key)[]): Promise<void>
  deleteMany(keys: Key[]): Promise<void>
  /** All puts or none. `false` when a condition failed. */
  transact(puts: TransactPut[]): Promise<boolean>
}

const idOf = ({ pk, sk }: Key): string => `${pk}\u0000${sk}`

const holds = (existing: Item | undefined, condition: TransactPut['condition']): boolean => {
  if (!condition) {
    return true
  }
  return 'absent' in condition ? existing === undefined : existing?.version === condition.versionEquals
}

export const createMemoryTable = (): TableClient & { size(): number } => {
  const items = new Map<string, Item & Key>()
  return {
    get: async (pk, sk) => items.get(idOf({ pk, sk })),
    query: async (pk, skPrefix) =>
      [...items.values()]
        .filter((item) => item.pk === pk && item.sk.startsWith(skPrefix))
        .sort((a, b) => a.sk.localeCompare(b.sk)),
    putMany: async (puts) => {
      for (const item of puts) {
        items.set(idOf(item), item)
      }
    },
    deleteMany: async (keys) => {
      for (const key of keys) {
        items.delete(idOf(key))
      }
    },
    transact: async (puts) => {
      if (!puts.every(({ item, condition }) => holds(items.get(idOf(item)), condition))) {
        return false
      }
      for (const { item } of puts) {
        items.set(idOf(item), item)
      }
      return true
    },
    size: () => items.size
  }
}
