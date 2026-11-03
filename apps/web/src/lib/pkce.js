/** The pure parts of the PKCE code flow (RFC 7636), apart from the browser pages that use them. */
export const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

export const randomString = (length = 48) => base64url(crypto.getRandomValues(new Uint8Array(length)))

export const challengeOf = async (verifier) =>
  base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
