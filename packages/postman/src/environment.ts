import { InvalidRequestException, type Variable } from '@postmano/core'
import { z } from 'zod'

import { asText, type ImportWarning } from './text.js'

/**
 * A Postman environment or globals export: `{ name, values: [{ key, value, type, enabled }] }`. Read leniently, like the
 * collection: fields this tool does not keep are ignored.
 */
const rawEnvironmentSchema = z.looseObject({
  name: z.string().nullish(),
  values: z.array(
    z.looseObject({
      key: z.string().nullish(),
      value: z.unknown().optional(),
      type: z.string().nullish(),
      enabled: z.boolean().optional()
    })
  ),
  _postman_variable_scope: z.string().nullish()
})

export type EnvironmentImport = {
  kind: 'environment'
  /** Postman keeps globals apart; here they come in as an environment of their own. */
  scope: 'environment' | 'globals'
  environment: { name: string; variables: Variable[] }
  warnings: ImportWarning[]
}

/** A collection has `info` and `item`; an environment has `values` and neither. */
export const looksLikeEnvironment = (input: unknown): boolean =>
  typeof input === 'object' && input !== null && 'values' in input && !('info' in input) && !('item' in input)

const MAX_NAME = 120

export const importPostmanEnvironment = (input: unknown): EnvironmentImport => {
  const parsed = rawEnvironmentSchema.safeParse(input)
  if (!parsed.success) {
    throw new InvalidRequestException(`Not a Postman environment: ${parsed.error.issues[0]?.message ?? 'unreadable'}`)
  }
  const scope = parsed.data._postman_variable_scope === 'globals' ? 'globals' : 'environment'
  const name = (parsed.data.name?.trim() || (scope === 'globals' ? 'Globals' : 'Environment')).slice(0, MAX_NAME)
  const warnings: ImportWarning[] = []
  const active = parsed.data.values.filter((entry) => entry.enabled !== false)
  const skipped = parsed.data.values.length - active.length
  if (skipped > 0) {
    warnings.push({ path: name, message: `${skipped} disabled variables were not imported` })
  }
  const variables = active
    .filter((entry) => (entry.key ?? '') !== '')
    .map((entry) => ({ key: entry.key ?? '', value: asText(entry.value), secret: entry.type === 'secret' }))
  if (scope === 'globals') {
    warnings.push({ path: name, message: 'Globals are imported as an environment; pick it to use them' })
  }
  return { kind: 'environment', scope, environment: { name, variables }, warnings }
}
