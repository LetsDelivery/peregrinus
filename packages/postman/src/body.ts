import type { Body, FormField } from '@postmano/core'

import type { RawBody, RawKeyValue } from './raw.js'
import { type ImportContext, toKeyValue, toKeyValues, warn } from './text.js'

const LANGUAGES = ['json', 'text', 'xml', 'html', 'javascript'] as const
type Language = (typeof LANGUAGES)[number]

const languageOf = (value: string | undefined): Language => LANGUAGES.find((language) => language === value) ?? 'text'

const toFormField = (field: RawKeyValue): FormField => ({
  ...toKeyValue(field),
  type: field.type === 'file' ? 'file' : 'text'
})

const formFields = (fields: readonly RawKeyValue[] | undefined, context: ImportContext, path: string): FormField[] => {
  const converted = (fields ?? []).map(toFormField)
  if (converted.some((field) => field.type === 'file')) {
    warn(context, path, 'File fields are kept as rows but their files are not imported')
  }
  return converted
}

/** The body of a request. Binary and file bodies carry a path on someone's disk, so they import as no body. */
export const parseBody = (body: RawBody, context: ImportContext, path: string): Body => {
  switch (body?.mode) {
    case 'raw':
      return { mode: 'raw', language: languageOf(body.options?.raw?.language), content: body.raw ?? '' }
    case 'urlencoded':
      return { mode: 'urlencoded', fields: toKeyValues(body.urlencoded) }
    case 'formdata':
      return { mode: 'formdata', fields: formFields(body.formdata, context, path) }
    case 'graphql':
      return { mode: 'graphql', query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '' }
    case 'file':
      warn(context, path, 'A file body is not imported')
      return { mode: 'none' }
    default:
      if (body?.mode !== undefined && body.mode !== null) {
        warn(context, path, `A "${body.mode}" body is not imported`)
      }
      return { mode: 'none' }
  }
}
