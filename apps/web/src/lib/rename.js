/**
 * Renames the request at `key`: the indexes down the tree joined by dots, as the sidebar writes them.
 * Returns true only when the name changed: false when the key does not lead to a request, and when the name is the
 * one it already had. Nothing else is touched.
 */
export const renameRequest = (collection, key, name) => {
  const path = key.split('.').map(Number)
  const parent = path.slice(0, -1).reduce((node, index) => node?.children?.[index], { children: collection.items })
  const target = parent?.children?.[path.at(-1)]
  if (target?.kind !== 'request' || target.name === name) {
    return false
  }
  target.name = name
  return true
}
