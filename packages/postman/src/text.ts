import type { KeyValue } from '@peregrinus/core'

import type { RawDescription, RawKeyValue } from './raw.js'

export type ImportWarning = { path: string; message: string }
export type ImportContext = { warnings: ImportWarning[]; scripted: number }

export const warn = (context: ImportContext, path: string, message: string): void => {
  context.warnings.push({ path, message })
}

/** Postman allows numbers, booleans and objects where this tool keeps only text. */
export const asText = (value: unknown): string => {
  if (value === undefined || value === null) {
    return ''
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export const describe = (description: RawDescription): string | undefined => {
  const text = typeof description === 'string' ? description : description?.content
  return text ? text : undefined
}

export const toKeyValue = (item: RawKeyValue): KeyValue => ({
  key: item.key ?? '',
  value: asText(item.value),
  description: describe(item.description),
  disabled: item.disabled === true
})

export const toKeyValues = (list: readonly RawKeyValue[] | undefined): KeyValue[] => (list ?? []).map(toKeyValue)
