import { z } from 'zod'

import { requestIds } from './ids.js'
import {
  type Auth,
  type Collection,
  type KeyValue,
  type Node,
  nodeIdSchema,
  type RequestNode,
  type Variable
} from './model.js'

/**
 * Who may open the page of a published collection, from the narrowest to the widest:
 * - `workspace`: the members of the workspace it belongs to;
 * - `people`: the addresses on the list (and the workspace's editors and admins, who manage it);
 * - `company`: anyone signed in with an account of an allowed domain;
 * - `link`: anyone who has the address, with no sign-in;
 * - `password`: anyone who knows the access password, for a customer outside the company. It needs no company login
 *   either, so the content rules of `link` apply to it too.
 */
export const visibilitySchema = z.enum(['workspace', 'people', 'company', 'link', 'password'])

/** The visibilities that reach people outside the company, who must not read what looks like a credential. */
export const isExternal = (visibility: z.infer<typeof visibilitySchema>): boolean =>
  visibility === 'link' || visibility === 'password'

export const languageSchema = z.enum(['curl', 'javascript', 'python'])

/** A published page: a collection or a selection of it, the people who may open it, and what it shows. */
export const publicationSchema = z.object({
  collectionId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  visibility: visibilitySchema,
  people: z.array(z.string().email().max(254)).max(200).default([]),
  /**
   * The ids of the requests to show, folders kept around them. `null` shows the whole collection and follows it:
   * what is added later appears. A selection is explicit: what is added later stays out until it is ticked.
   */
  selection: z.array(nodeIdSchema).max(2000).nullable().default(null),
  /** The environment whose non-secret variables fill the examples, or none. */
  environmentId: z.string().min(1).max(64).nullable().default(null),
  language: languageSchema.default('curl')
})

/** The access password of a `password` publication, as kept: a scrypt hash with its salt, never the password. */
export const accessSchema = z.object({
  salt: z.string().min(1),
  hash: z.string().min(1),
  /** Goes up on every change of the password. */
  version: z.number().int().min(1),
  setAt: z.string().datetime()
})

/** The most requests a publication with a selection can follow: it remembers each one it has seen. */
export const MAX_SEEN = 4000

/**
 * A publication as the server keeps it: what the author sent, plus what the server worked out. `seen` is every
 * request of the collection when it was saved, to tell what was added since. `expiresAt` is when it stops opening
 * (UTC), or null. `access` exists only for a `password` publication. `acknowledged` is the author's yes to an
 * external page over text that looked like a credential. `folderPath` is what pages saved before selections kept: a
 * page that still has it and no selection is closed until it is saved again, so it never shows more than it did.
 */
export const storedPublicationSchema = publicationSchema.extend({
  seen: z.array(nodeIdSchema).max(MAX_SEEN).default([]),
  expiresAt: z.string().datetime().nullable().default(null),
  access: accessSchema.optional(),
  acknowledged: z.boolean().default(false),
  folderPath: z.array(z.number().int().min(0)).max(20).optional()
})

export type Visibility = z.infer<typeof visibilitySchema>
export type Publication = z.infer<typeof publicationSchema>
export type StoredPublication = z.infer<typeof storedPublicationSchema>
export type Access = z.infer<typeof accessSchema>

export const HIDDEN = '<hidden>'

/**
 * Names that carry a credential. A substring match on purpose: `X-Amz-Security-Token`, `Ocp-Apim-Subscription-Key` and
 * `refresh_token` are not on any list, and a name wrongly hidden costs a placeholder, while a name missed costs a leak.
 */
const SENSITIVE_NAME =
  /token|secret|passw|pwd|api[_-]?key|apikey|auth(?!ors?\b|ored\b)|cookie|session|signature|credential|private|bearer|otp|csrf|xsrf|(^|[_-])(key|sig|sid)($|[_-])|[a-z]key$/i

const nameIsSensitive = (key: string): boolean => SENSITIVE_NAME.test(key)

const hiddenIf = <T extends KeyValue>(rows: readonly T[]): T[] =>
  rows.map((row) => (nameIsSensitive(row.key) ? { ...row, value: HIDDEN } : row))

/** What an auth says about a request: its kind and where it goes, never the secret. */
const redactAuth = (auth: Auth): Auth => {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: '' }
    case 'basic':
      return { type: 'basic', username: '', password: '' }
    case 'apikey':
      return { ...auth, value: '' }
    case 'unsupported':
      return { type: 'unsupported', original: /^[\w .-]{1,30}$/.test(auth.original) ? auth.original : '' }
    default:
      return auth
  }
}

/** The address without the user and password before the host, and without the value of a credential parameter. */
const redactUrl = (url: string): string => {
  const bare = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1')
  const at = bare.indexOf('?')
  if (at < 0) {
    return bare
  }
  const query = bare
    .slice(at + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq > 0 && nameIsSensitive(pair.slice(0, eq)) ? `${pair.slice(0, eq)}=${HIDDEN}` : pair
    })
  return `${bare.slice(0, at + 1)}${query.join('&')}`
}

const redactJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactJson)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, nameIsSensitive(key) ? HIDDEN : redactJson(inner)])
  )
}

/** A JSON text with the value of every credential-looking key replaced. Any other text comes back as it was. */
const redactText = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text)
    const redacted = JSON.stringify(redactJson(parsed))
    return redacted === JSON.stringify(parsed) ? text : JSON.stringify(JSON.parse(redacted), null, 2)
  } catch {
    return text
  }
}

const redactBody = (body: RequestNode['body']): RequestNode['body'] => {
  switch (body.mode) {
    case 'urlencoded':
      return { ...body, fields: hiddenIf(body.fields) }
    case 'formdata':
      return { ...body, fields: hiddenIf(body.fields) }
    case 'raw':
      return { ...body, content: redactText(body.content) }
    case 'graphql':
      return { ...body, variables: redactText(body.variables) }
    default:
      return body
  }
}

const redactRequest = (request: RequestNode): RequestNode => ({
  ...request,
  url: redactUrl(request.url),
  query: hiddenIf(request.query),
  headers: hiddenIf(request.headers),
  body: redactBody(request.body),
  auth: redactAuth(request.auth),
  examples: request.examples.map((example) => ({
    ...example,
    headers: hiddenIf(example.headers),
    body: redactText(example.body)
  }))
})

const redactNode = (node: Node): Node =>
  node.kind === 'folder'
    ? { ...node, auth: redactAuth(node.auth), children: node.children.map(redactNode) }
    : redactRequest(node)

export const publicVariables = (variables: readonly Variable[]): Variable[] =>
  variables
    .filter((variable) => !variable.secret && !nameIsSensitive(variable.key))
    .map((variable) => ({ ...variable }))

/** The folders and requests that hold a ticked request, in their order. A folder with nothing ticked is left out. */
const keepSelected = (items: readonly Node[], ids: ReadonlySet<string>): Node[] =>
  items.flatMap((node): Node[] => {
    if (node.kind === 'request') {
      return node.id !== undefined && ids.has(node.id) ? [node] : []
    }
    const children = keepSelected(node.children, ids)
    return children.length > 0 ? [{ ...node, children }] : []
  })

/** What the selection no longer matches (deleted) and what the collection gained since it was saved (new). */
export const selectionHealth = (
  collection: Collection,
  selection: readonly string[],
  seen: readonly string[]
): { removed: number; added: number } => {
  const now = new Set(requestIds(collection))
  const known = new Set(seen)
  return {
    removed: selection.filter((id) => !now.has(id)).length,
    added: [...now].filter((id) => !known.has(id)).length
  }
}

/**
 * What a published page may carry. Every secret is taken out before it leaves the server, so a person who can
 * open the page cannot read one from the response: tokens and passwords of every auth, secret variables and the
 * ones named like a credential, the user and password of an address, the value of headers, query parameters and
 * form fields named like a credential, the same keys inside JSON bodies, and cookies in saved responses.
 * Free text (descriptions, non-JSON bodies) is the author's to check: `findSecrets` warns about it.
 * With a selection, only the ticked requests and the folders around them are in it, and of the collection only the
 * variables those requests use: its description and its other variables are about requests the page does not show.
 */
export const publicView = (collection: Collection, selection: readonly string[] | null): Collection => {
  const items = selection === null ? collection.items : keepSelected(collection.items, new Set(selection))
  const own = publicVariables(collection.variables)
  const used = JSON.stringify(items)
  const shown = selection === null ? own : own.filter((variable) => used.includes(`{{${variable.key}}}`))
  return {
    ...(selection === null ? collection : { ...collection, description: undefined }),
    auth: redactAuth(collection.auth),
    variables: shown,
    items: items.map(redactNode)
  }
}

/** What a viewer of a workspace reads of a collection: all of it, with every secret value emptied. */
export const viewerView = (collection: Collection): Collection => ({
  ...publicView(collection, null),
  variables: collection.variables.map((variable) =>
    variable.secret || nameIsSensitive(variable.key) ? { ...variable, value: '' } : variable
  )
})

const SECRET_PATTERNS: [string, RegExp][] = [
  ['a JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a bearer token', /\bBearer\s+(?!<|\{\{)[A-Za-z0-9._~+/=-]{20,}/],
  ['an AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JiraIA token', /\bjia_[A-Za-z0-9_-]{30,}/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['a password in an address', /[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:[^\s/?#@]+@/i],
  [
    'a value given to a credential name',
    /\b(password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|(access|refresh|auth|id)[_-]?token)\b["']?\s*[:=]\s*["']?(?![<{$])[^\s"'&,}{<]{6,}/i
  ]
]

export type SecretFinding = { path: string; kind: string }

const kindOf = (text: string): string | undefined => SECRET_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0]

/** What looks like a credential in the values of variables that would be published (the others never leave). */
export const findSecretsInVariables = (variables: readonly Variable[], where: string): SecretFinding[] =>
  publicVariables(variables).flatMap((variable) => {
    const kind = kindOf(variable.value)
    return kind ? [{ path: `${where}/${variable.key}`, kind }] : []
  })

const rowTexts = (rows: readonly KeyValue[]): string[] => rows.flatMap((row) => [row.value, row.description ?? ''])

const bodyTexts = (body: RequestNode['body']): string[] => {
  switch (body.mode) {
    case 'raw':
      return [body.content]
    case 'graphql':
      return [body.query, body.variables]
    case 'urlencoded':
    case 'formdata':
      return rowTexts(body.fields)
    default:
      return []
  }
}

const requestTexts = (request: RequestNode): string[] => [
  request.url,
  request.description ?? '',
  ...rowTexts(request.query),
  ...rowTexts(request.headers),
  ...bodyTexts(request.body),
  ...request.examples.flatMap((example) => [example.body, ...rowTexts(example.headers)])
]

const firstKind = (texts: readonly string[]): string | undefined =>
  texts.map(kindOf).find((value) => value !== undefined)

const scanNode = (node: Node, trail: string, found: SecretFinding[]): void => {
  const path = trail === '' ? node.name : `${trail} / ${node.name}`
  const kind = firstKind(node.kind === 'folder' ? [node.description ?? ''] : requestTexts(node))
  if (kind) {
    found.push({ path, kind })
  }
  if (node.kind === 'folder') {
    for (const child of node.children) {
      scanNode(child, path, found)
    }
  }
}

/**
 * Looks for text that looks like a credential in what a page would show: it scans the view that `publicView` builds,
 * so it finds what the redaction did not catch. It cannot be sure, so it is a warning for the author, and the one
 * thing that stops a publish is a page for people outside the company over a collection that has any.
 */
export const findSecrets = (collection: Collection, selection: readonly string[] | null = null): SecretFinding[] => {
  const view = publicView(collection, selection)
  const found: SecretFinding[] = []
  const rootKind = firstKind([view.description ?? '', ...view.variables.map((variable) => variable.value)])
  if (rootKind) {
    found.push({ path: view.name, kind: rootKind })
  }
  for (const node of view.items) {
    scanNode(node, '', found)
  }
  return found
}
