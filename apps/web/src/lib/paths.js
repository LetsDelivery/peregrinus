/** Sets `value` at a dotted path like `query.0.key`, creating nothing: the path must already exist. */
export const setPath = (target, path, value) => {
  const keys = path.split('.')
  const last = keys.pop()
  const holder = keys.reduce((node, key) => node[key], target)
  holder[last] = value
}

export const getPath = (target, path) => path.split('.').reduce((node, key) => node?.[key], target)
