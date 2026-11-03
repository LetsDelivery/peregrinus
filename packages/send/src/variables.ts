/** Variable scopes from the highest precedence to the lowest: local, environment, collection, global. */
export type Scopes = readonly Readonly<Record<string, string>>[]

export type DynamicSource = {
  now: () => Date
  uuid: () => string
  random: () => number
}

export const systemDynamics: DynamicSource = {
  now: () => new Date(),
  uuid: () => globalThis.crypto.randomUUID(),
  random: Math.random
}

const PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g

const dynamicValue = (name: string, source: DynamicSource): string | undefined => {
  switch (name) {
    case '$guid':
    case '$randomUUID':
      return source.uuid()
    case '$timestamp':
      return String(Math.floor(source.now().getTime() / 1000))
    case '$isoTimestamp':
      return source.now().toISOString()
    case '$randomInt':
      return String(Math.floor(source.random() * 1001))
    default:
      return undefined
  }
}

const lookup = (name: string, scopes: Scopes, source: DynamicSource): string | undefined => {
  if (name.startsWith('$')) {
    return dynamicValue(name, source)
  }
  return scopes.find((scope) => Object.hasOwn(scope, name))?.[name]
}

export type Resolver = {
  resolve: (template: string) => string
  /** Every `{{name}}` that no scope defined, in the order first seen. They stay in the text as written. */
  unresolved: () => string[]
}

/** Replaces `{{name}}` by the narrowest scope's value. One pass: a value that holds `{{other}}` is not expanded again. */
export const createResolver = (scopes: Scopes, source: DynamicSource = systemDynamics): Resolver => {
  const missing = new Set<string>()
  const resolve = (template: string): string =>
    template.replace(PATTERN, (match, name: string) => {
      const value = lookup(name, scopes, source)
      if (value === undefined) {
        missing.add(name)
        return match
      }
      return value
    })
  return { resolve, unresolved: () => [...missing] }
}
