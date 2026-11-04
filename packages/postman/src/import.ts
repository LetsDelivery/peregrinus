import { type Collection, InvalidRequestException } from '@postmano/core'

import { parseAuth } from './auth.js'
import { toNode } from './items.js'
import { type RawCollection, rawCollectionSchema } from './raw.js'
import { asText, describe, type ImportContext, type ImportWarning } from './text.js'

export type ImportResult = { collection: Collection; warnings: ImportWarning[] }

const assertSchema = (schema: string | undefined): void => {
  if (schema !== undefined && !/v2\.[01]/.test(schema)) {
    throw new InvalidRequestException(`Unsupported collection schema "${schema}"; export it as Collection v2.1`)
  }
}

const toVariables = (raw: RawCollection) =>
  (raw.variable ?? []).map((variable) => ({
    key: variable.key ?? '',
    value: asText(variable.value),
    secret: variable.type === 'secret'
  }))

/**
 * Reads a Postman Collection v2.1 (or v2.0) export into the domain model. Scripts, tests and events are
 * not imported; a count of the items that had them comes back as a warning.
 */
export const importPostmanCollection = (input: unknown): ImportResult => {
  const parsed = rawCollectionSchema.safeParse(input)
  if (!parsed.success) {
    throw new InvalidRequestException(`Not a Postman collection: ${parsed.error.issues[0]?.message ?? 'unreadable'}`)
  }
  const raw = parsed.data
  assertSchema(raw.info.schema)
  const context: ImportContext = { warnings: [], scripted: 0 }
  const name = raw.info.name ?? 'Untitled collection'
  const collection: Collection = {
    name,
    description: describe(raw.info.description),
    auth: parseAuth(raw.auth, context, name),
    variables: toVariables(raw),
    items: raw.item.map((item) => toNode(item, context, ''))
  }
  if (context.scripted > 0) {
    context.warnings.push({
      path: name,
      message: `${context.scripted} items have scripts or tests, which are not imported`
    })
  }
  return { collection, warnings: context.warnings }
}
