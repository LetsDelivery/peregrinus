import type { Auth } from '@peregrinus/core'

import { type RawAuth, rawKeyValueSchema } from './raw.js'
import { asText, type ImportContext, warn } from './text.js'

/** The `[{ key, value }]` rows Postman keeps under the auth type's own name, as a plain record. */
const paramsOf = (auth: RawAuth, context: ImportContext, path: string): Record<string, string> => {
  const parsed = rawKeyValueSchema.array().safeParse(auth[auth.type])
  if (!parsed.success) {
    warn(context, path, `The "${auth.type}" authorization could not be read, so it was imported without its values`)
    return {}
  }
  return Object.fromEntries(parsed.data.map((param) => [param.key ?? '', asText(param.value)]))
}

const fromParams = (type: string, params: Record<string, string>): Auth | undefined => {
  switch (type) {
    case 'bearer':
      return { type: 'bearer', token: params.token ?? '' }
    case 'basic':
      return { type: 'basic', username: params.username ?? '', password: params.password ?? '' }
    case 'apikey':
      return {
        type: 'apikey',
        key: params.key ?? '',
        value: params.value ?? '',
        in: params.in === 'query' ? 'query' : 'header'
      }
    default:
      return undefined
  }
}

/**
 * The authorization of a collection, folder or request. Missing means "inherit from the parent". A type
 * this tool does not run (OAuth, Digest, AWS Signature, ...) is kept by name and reported, so the
 * request still imports and the person sees which ones need attention.
 */
export const parseAuth = (auth: RawAuth | null | undefined, context: ImportContext, path: string): Auth => {
  if (!auth) {
    return { type: 'inherit' }
  }
  if (auth.type === 'noauth') {
    return { type: 'none' }
  }
  const known = fromParams(auth.type, paramsOf(auth, context, path))
  if (known) {
    return known
  }
  warn(context, path, `Authorization type "${auth.type}" is not supported and was kept as a label`)
  return { type: 'unsupported', original: auth.type }
}
