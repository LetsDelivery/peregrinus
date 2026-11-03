import { z } from 'zod'

/**
 * The domain model: a collection of folders and requests, each request with the saved responses
 * (examples) that feed the generated documentation. It is the shape the importer produces and the
 * request builder consumes; the Postman Collection v2.1 shape lives in `@peregrinus/postman`.
 */
export const keyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().default(false)
})

export const formFieldSchema = keyValueSchema.extend({ type: z.enum(['text', 'file']).default('text') })

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('apikey'), key: z.string(), value: z.string(), in: z.enum(['header', 'query']) }),
  z.object({ type: z.literal('unsupported'), original: z.string() })
])

export const rawLanguageSchema = z.enum(['json', 'text', 'xml', 'html', 'javascript'])

export const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('raw'), language: rawLanguageSchema, content: z.string() }),
  z.object({ mode: z.literal('urlencoded'), fields: z.array(keyValueSchema) }),
  z.object({ mode: z.literal('formdata'), fields: z.array(formFieldSchema) }),
  z.object({ mode: z.literal('graphql'), query: z.string(), variables: z.string() })
])

export const exampleSchema = z.object({
  name: z.string(),
  status: z.string(),
  code: z.number().int(),
  headers: z.array(keyValueSchema),
  body: z.string(),
  language: z.string().optional()
})

export const requestSchema = z.object({
  kind: z.literal('request'),
  name: z.string(),
  description: z.string().optional(),
  /** Letters only: the method lands unquoted in places a pasted command or a CSS class would read it. */
  method: z.string().regex(/^[A-Za-z]{1,20}$/),
  /** The URL without its query string; the query lives in `query` so the table can edit it. */
  url: z.string(),
  query: z.array(keyValueSchema),
  headers: z.array(keyValueSchema),
  body: bodySchema,
  auth: authSchema,
  examples: z.array(exampleSchema)
})

export const folderSchema = z.object({
  kind: z.literal('folder'),
  name: z.string(),
  description: z.string().optional(),
  auth: authSchema,
  get children() {
    return z.array(z.union([folderSchema, requestSchema]))
  }
})

export const variableSchema = z.object({ key: z.string(), value: z.string(), secret: z.boolean().default(false) })

export const collectionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  auth: authSchema,
  variables: z.array(variableSchema),
  items: z.array(z.union([folderSchema, requestSchema]))
})

export type KeyValue = z.infer<typeof keyValueSchema>
export type FormField = z.infer<typeof formFieldSchema>
export type Auth = z.infer<typeof authSchema>
export type Body = z.infer<typeof bodySchema>
export type Example = z.infer<typeof exampleSchema>
export type RequestNode = z.infer<typeof requestSchema>
export type FolderNode = z.infer<typeof folderSchema>
export type Node = FolderNode | RequestNode
export type Variable = z.infer<typeof variableSchema>
export type Collection = z.infer<typeof collectionSchema>

export const roleSchema = z.enum(['admin', 'editor', 'viewer'])
export const memberSchema = z.object({ email: z.string().email().max(254), role: roleSchema })

/** A workspace: the unit that owns collections and environments, and the people who may use them. */
export const workspaceSchema = z.object({
  name: z.string().min(1).max(80),
  /** The one every person gets, private to them. It has a single member and cannot be shared or deleted. */
  personal: z.boolean().default(false),
  members: z.array(memberSchema).min(1).max(200)
})

export type Role = z.infer<typeof roleSchema>
export type Member = z.infer<typeof memberSchema>
export type Workspace = z.infer<typeof workspaceSchema>
