import { ForbiddenException, UnauthenticatedException } from '@peregrinus/core'
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose'
import { z } from 'zod'

/** Who is calling, as far as the sign-in token can say. Access is decided by the company's Google domain. */
export type Caller = { subject: string; email: string; name?: string }

export type IdentityVerifier = { verify(token: string): Promise<Caller | undefined> }

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  hd: z.string().optional(),
  'custom:hd': z.string().optional(),
  name: z.string().optional()
})

export type Claims = z.infer<typeof claimsSchema>

export type CognitoIdentityOptions = {
  /** `https://cognito-idp.<region>.amazonaws.com/<user pool id>`: the pool's own `iss`. */
  issuer: string
  /** The panel's app client id: a token minted for any other client is refused. */
  audience: string
  /** The pool's keys; tests hand over their own. */
  keys?: JWTVerifyGetKey
}

export type Admitted = { caller: Caller; claims: Claims }
export type ClaimsVerifier = { verify(token: string): Promise<Admitted | undefined> }

const callerOf = (claims: Claims): Caller => ({
  subject: claims.sub,
  email: claims.email,
  ...(claims.name === undefined ? {} : { name: claims.name })
})

/**
 * Verifies the ID token the Cognito user pool (federated with Google) gave the panel: signature against
 * the pool's keys, issuer, audience, expiry, and that it is an ID token, not an access token.
 */
export const cognitoIdentity = (options: CognitoIdentityOptions): ClaimsVerifier => {
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${options.issuer}/.well-known/jwks.json`))
  return {
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256']
        })
        const claims = claimsSchema.safeParse(payload)
        return payload.token_use === 'id' && claims.success
          ? { caller: callerOf(claims.data), claims: claims.data }
          : undefined
      } catch (error) {
        if (error instanceof errors.JOSEError) {
          return undefined
        }
        throw error
      }
    }
  }
}

const domainOf = (email: string): string => email.split('@')[1]?.toLowerCase() ?? ''

/**
 * The company's rule: a verified address of one of the allowed Workspace domains, and a Google `hd` claim
 * that is present and one of them too. Someone who leaves the company loses the Workspace account and so the access.
 */
export const assertAdmitted = (claims: Claims, allowedDomains: readonly string[]): void => {
  const allowed = allowedDomains.map((domain) => domain.toLowerCase())
  const verified = claims.email_verified === true || claims.email_verified === 'true'
  const hd = (claims['custom:hd'] ?? claims.hd)?.toLowerCase()
  // `hd` must be there: an address of the company on a personal Google account has none, and that is not a person
  // the company still manages.
  if (!verified || !allowed.includes(domainOf(claims.email)) || hd === undefined || !allowed.includes(hd)) {
    throw new ForbiddenException(`The account ${claims.email} is not of an allowed domain (${allowed.join(', ')})`)
  }
}

export const requireToken = (header: string | null): string => {
  const token = header?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) {
    throw new UnauthenticatedException('Missing "Authorization: Bearer <token>" header')
  }
  return token
}
