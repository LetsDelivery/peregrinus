import type { Example, FolderNode, Node, RequestNode } from '@postmano/core'

import { parseAuth } from './auth.js'
import { parseBody } from './body.js'
import type { RawItem, RawResponse } from './raw.js'
import { describe, type ImportContext, toKeyValues } from './text.js'
import { parseUrl } from './url.js'

/**
 * A saved response is a sample for the documentation. Some are whole files (one was 1.5 MB) and a collection has to
 * fit in one request, so what goes past this is cut and says so.
 */
export const MAX_EXAMPLE_CHARS = 100_000

const trimmedBody = (body: string, context: ImportContext): string => {
  if (body.length <= MAX_EXAMPLE_CHARS) {
    return body
  }
  context.trimmed += 1
  return `${body.slice(0, MAX_EXAMPLE_CHARS)}\n… [cut when imported: the original had ${Math.round(body.length / 1000)} KB]`
}

const toExample = (response: RawResponse, context: ImportContext): Example => ({
  name: response.name ?? '',
  status: response.status ?? '',
  code: response.code ?? 0,
  headers: Array.isArray(response.header) ? toKeyValues(response.header) : [],
  body: trimmedBody(response.body ?? '', context),
  language: response._postman_previewlanguage ?? undefined
})

type RawRequest = Exclude<RawItem['request'], string | undefined>

/** A v2.0 request is just its URL as a string; every other field is then absent. */
const requestOf = (item: RawItem): RawRequest =>
  typeof item.request === 'string' ? { url: item.request } : (item.request ?? {})

const toRequest = (item: RawItem, context: ImportContext, path: string): RequestNode => {
  const request = requestOf(item)
  const { url, query } = parseUrl(request.url)
  return {
    kind: 'request',
    name: item.name ?? '',
    description: describe(request.description) ?? describe(item.description),
    method: request.method ?? 'GET',
    url,
    query,
    headers: Array.isArray(request.header) ? toKeyValues(request.header) : [],
    body: parseBody(request.body, context, path),
    auth: parseAuth(request.auth ?? item.auth, context, path),
    examples: (item.response ?? []).map((response) => toExample(response, context))
  }
}

const toFolder = (item: RawItem, context: ImportContext, path: string): FolderNode => ({
  kind: 'folder',
  name: item.name ?? '',
  description: describe(item.description),
  auth: parseAuth(item.auth, context, path),
  children: (item.item ?? []).map((child) => toNode(child, context, path))
})

/** A folder is an item that has `item`; anything else is a request. */
export const toNode = (item: RawItem, context: ImportContext, parent: string): Node => {
  const path = parent === '' ? (item.name ?? '') : `${parent}/${item.name ?? ''}`
  if ((item.event ?? []).length > 0) {
    context.scripted += 1
  }
  return item.item ? toFolder(item, context, path) : toRequest(item, context, path)
}
