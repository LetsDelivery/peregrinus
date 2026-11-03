import { z } from 'zod'

/**
 * The Postman Collection v2.1 JSON, read leniently: the format allows a string or an object in many
 * places (description, url, request), so each of those is a union and the converter picks the shape.
 * Fields this tool does not use are ignored, not rejected.
 */
const descriptionSchema = z.union([z.string(), z.object({ content: z.string().optional() })]).nullish()

export const rawKeyValueSchema = z.object({
  key: z.string().nullish(),
  value: z.unknown().optional(),
  description: descriptionSchema,
  disabled: z.boolean().optional(),
  type: z.string().optional()
})

const rawUrlObjectSchema = z.object({
  raw: z.string().optional(),
  protocol: z.string().optional(),
  host: z.union([z.string(), z.array(z.string())]).optional(),
  port: z.string().optional(),
  path: z.union([z.string(), z.array(z.union([z.string(), z.object({ value: z.string().optional() })]))]).optional(),
  query: z.array(rawKeyValueSchema).optional()
})

const rawBodySchema = z.object({
  mode: z.string().optional(),
  raw: z.string().optional(),
  urlencoded: z.array(rawKeyValueSchema).optional(),
  formdata: z.array(rawKeyValueSchema).optional(),
  graphql: z.object({ query: z.string().optional(), variables: z.string().optional() }).optional(),
  options: z.object({ raw: z.object({ language: z.string().optional() }).optional() }).optional()
})

export const rawAuthSchema = z.looseObject({ type: z.string() })

const rawRequestSchema = z.object({
  method: z.string().optional(),
  url: z.union([z.string(), rawUrlObjectSchema]).optional(),
  header: z.union([z.array(rawKeyValueSchema), z.string()]).nullish(),
  body: rawBodySchema.nullish(),
  auth: rawAuthSchema.nullish(),
  description: descriptionSchema
})

const rawResponseSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  code: z.number().optional(),
  header: z.union([z.array(rawKeyValueSchema), z.string()]).nullish(),
  body: z.string().nullish(),
  _postman_previewlanguage: z.string().nullish()
})

export const rawItemSchema = z.object({
  name: z.string().optional(),
  description: descriptionSchema,
  auth: rawAuthSchema.nullish(),
  event: z.array(z.unknown()).optional(),
  request: z.union([z.string(), rawRequestSchema]).optional(),
  response: z.array(rawResponseSchema).optional(),
  get item() {
    return z.array(rawItemSchema).optional()
  }
})

export const rawCollectionSchema = z.object({
  info: z.object({
    name: z.string().optional(),
    description: descriptionSchema,
    schema: z.string().optional()
  }),
  item: z.array(rawItemSchema).default([]),
  auth: rawAuthSchema.nullish(),
  variable: z.array(rawKeyValueSchema).optional()
})

export type RawKeyValue = z.infer<typeof rawKeyValueSchema>
export type RawAuth = z.infer<typeof rawAuthSchema>
export type RawItem = z.infer<typeof rawItemSchema>
export type RawCollection = z.infer<typeof rawCollectionSchema>
export type RawDescription = z.infer<typeof descriptionSchema>
export type RawUrl = string | z.infer<typeof rawUrlObjectSchema> | undefined
export type RawBody = z.infer<typeof rawBodySchema> | null | undefined
export type RawResponse = z.infer<typeof rawResponseSchema>
