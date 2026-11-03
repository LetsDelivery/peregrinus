import { z } from 'zod'

const configSchema = z.object({
  ALLOWED_EMAIL_DOMAINS: z.string().default('uselets.com,lets.delivery'),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  TABLE_NAME: z.string().optional()
})

export type Config = {
  allowedDomains: string[]
  cognito: { issuer: string; clientId: string } | undefined
  tableName: string | undefined
}

/** Reads the environment once, at cold start, so a missing or malformed value kills the start with its name. */
export const readConfig = (env: Record<string, string | undefined>): Config => {
  const parsed = configSchema.parse(env)
  const { COGNITO_ISSUER: issuer, COGNITO_CLIENT_ID: clientId } = parsed
  return {
    allowedDomains: parsed.ALLOWED_EMAIL_DOMAINS.split(',')
      .map((domain) => domain.trim())
      .filter(Boolean),
    cognito: issuer && clientId ? { issuer, clientId } : undefined,
    tableName: parsed.TABLE_NAME
  }
}
