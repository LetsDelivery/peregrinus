import { z } from 'zod'

import { InvalidRequestException } from './exceptions.js'
import type { Auth, Collection, FolderNode, KeyValue, Node, RequestNode, Variable } from './model.js'

/**
 * Who may open the page of a published collection, from the narrowest to the widest:
 * - `workspace`: the members of the workspace it belongs to;
 * - `people`: the addresses on the list (and the workspace's editors and admins, who manage it);
 * - `company`: anyone signed in with an account of an allowed domain;
 * - `link`: anyone who has the address, with no sign-in. The only one that needs no login.
 */
export const visibilitySchema = z.enum(['workspace', 'people', 'company', 'link'])

export const languageSchema = z.enum(['curl', 'javascript', 'python'])

/** A published page: a collection (or one folder of it), the people who may open it, and what it shows. */
export const publicationSchema = z.object({
  collectionId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  visibility: visibilitySchema,
  people: z.array(z.string().email().max(254)).max(200).default([]),
  /** Indexes down the tree to the folder to publish. Empty publishes the whole collection. */
  folderPath: z.array(z.number().int().min(0)).max(20).default([]),
  /** The environment whose non-secret variables fill the examples, or none. */
  environmentId: z.string().min(1).max(64).nullable().default(null),
  language: languageSchema.default('curl')
})

/**
 * A publication as the server keeps it: what the author sent, plus what the server worked out. `folderNames` are the
 * names along `folderPath` when it was saved, so a page notices when the folders under it were moved. `acknowledged`
 * is the author's yes to a public link over text that looked like a credential.
 */
export const storedPublicationSchema = publicationSchema.extend({
  folderNames: z.array(z.string()).max(20).default([]),
  acknowledged: z.boolean().default(false)
})

export type Visibility = z.infer<typeof visibilitySchema>
export type Publication = z.infer<typeof publicationSchema>
export type StoredPublication = z.infer<typeof storedPublicationSchema>

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

export type Subtree = { folder: FolderNode; above: Auth[] }

/** The folder at `path` and the auths above it, closest first. A path that leads nowhere is a 400. */
export const findFolder = (collection: Collection, path: readonly number[]): Subtree => {
  let items: Node[] = collection.items
  let folder: FolderNode | undefined
  const above: Auth[] = [collection.auth]
  for (const index of path) {
    const next = items[index]
    if (next?.kind !== 'folder') {
      throw new InvalidRequestException(`folderPath: ${path.join('.')} does not lead to a folder`)
    }
    if (folder) {
      above.unshift(folder.auth)
    }
    folder = next
    items = next.children
  }
  if (!folder) {
    throw new InvalidRequestException('folderPath: is empty')
  }
  return { folder, above }
}

/** The auth that applies to a folder: its own, else the nearest above it. Only its kind is ever shown. */
const effectiveFolderAuth = ({ folder, above }: Subtree): Auth =>
  [folder.auth, ...above].find((auth) => auth.type !== 'inherit') ?? { type: 'none' }

/** The names of the folders along `path`. A page keeps them to notice when the folders under it were moved. */
export const folderNamesAt = (collection: Collection, path: readonly number[]): string[] => {
  const names: string[] = []
  let items: Node[] = collection.items
  for (const index of path) {
    const next = items[index]
    if (next?.kind !== 'folder') {
      throw new InvalidRequestException(`folderPath: ${path.join('.')} does not lead to a folder`)
    }
    names.push(next.name)
    items = next.children
  }
  return names
}

export const publicVariables = (variables: readonly Variable[]): Variable[] =>
  variables
    .filter((variable) => !variable.secret && !nameIsSensitive(variable.key))
    .map((variable) => ({ ...variable }))

/** The collection, or the folder to publish dressed as one: its own name, and the auth that applies to it. */
const rootOf = (collection: Collection, folderPath: readonly number[]): Collection => {
  if (folderPath.length === 0) {
    return collection
  }
  const subtree = findFolder(collection, folderPath)
  return {
    name: subtree.folder.name,
    ...(subtree.folder.description === undefined ? {} : { description: subtree.folder.description }),
    auth: effectiveFolderAuth(subtree),
    variables: collection.variables,
    items: subtree.folder.children
  }
}

/**
 * What a published page may carry. Every secret is taken out before it leaves the server, so a person who can
 * open the page cannot read one from the response: tokens and passwords of every auth, secret variables and the
 * ones named like a credential, the user and password of an address, the value of headers, query parameters and
 * form fields named like a credential, the same keys inside JSON bodies, and cookies in saved responses.
 * Free text (descriptions, non-JSON bodies) is the author's to check: `findSecrets` warns about it.
 */
export const publicView = (collection: Collection, folderPath: readonly number[]): Collection => {
  const root = rootOf(collection, folderPath)
  return {
    ...root,
    auth: redactAuth(root.auth),
    variables: publicVariables(root.variables),
    items: root.items.map(redactNode)
  }
}

/** What a viewer of a workspace reads of a collection: all of it, with every secret value emptied. */
export const viewerView = (collection: Collection): Collection => ({
  ...publicView(collection, []),
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
 * thing that stops a publish is a link with no sign-in over a collection that has any.
 */
export const findSecrets = (collection: Collection, folderPath: readonly number[] = []): SecretFinding[] => {
  const view = publicView(collection, folderPath)
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
