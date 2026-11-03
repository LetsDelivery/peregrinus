import { challengeOf, randomString } from './pkce.js'

/**
 * Sign-in with Google through the stack's Cognito user pool: the code flow with PKCE. The panel is a public
 * client, so there is no secret. Locally there is no pool (`config.js` is empty) and `x-local-user` stands in.
 */
const config = window.__PEREGRINUS__ ?? {}
const KEYS = { verifier: 'pg:verifier', state: 'pg:state', session: 'pg:session', back: 'pg:back' }

export const isLocal = !config.cognitoDomain
export const apiBase = config.apiUrl ?? import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8280'
export const localUser = import.meta.env.VITE_LOCAL_USER ?? 'dev@uselets.com'

const redirectUri = () => `${location.origin}/entrar`

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(KEYS.session) ?? 'null')
  } catch {
    return null
  }
}

const writeSession = (tokens) =>
  localStorage.setItem(
    KEYS.session,
    JSON.stringify({ ...tokens, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 })
  )

const tokenRequest = async (params) => {
  const response = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...params })
  })
  if (!response.ok) {
    throw Object.assign(new Error('Sign-in failed'), { refused: response.status === 400 || response.status === 401 })
  }
  return await response.json()
}

export const login = async () => {
  // Where to land after Google sends the person back: a link to a documentation page must open that page.
  if (location.pathname !== '/entrar') {
    sessionStorage.setItem(KEYS.back, `${location.pathname}${location.search}`)
  }
  const verifier = randomString()
  const state = randomString(16)
  sessionStorage.setItem(KEYS.verifier, verifier)
  sessionStorage.setItem(KEYS.state, state)
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    identity_provider: 'Google',
    code_challenge_method: 'S256',
    code_challenge: await challengeOf(verifier),
    state
  })
  location.assign(`https://${config.cognitoDomain}/oauth2/authorize?${query}`)
}

/** On `/entrar?code=…` trades the code for tokens. Returns true when it handled the return from Google. */
export const completeLogin = async () => {
  const params = new URLSearchParams(location.search)
  if (location.pathname !== '/entrar' || !params.get('code')) {
    return false
  }
  const expected = sessionStorage.getItem(KEYS.state)
  if (!expected || params.get('state') !== expected) {
    throw new Error('Sign-in state does not match')
  }
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: sessionStorage.getItem(KEYS.verifier) ?? ''
  })
  writeSession(tokens)
  const back = sessionStorage.getItem(KEYS.back)
  sessionStorage.removeItem(KEYS.back)
  history.replaceState(null, '', back?.startsWith('/') && !back.startsWith('//') ? back : '/')
  return true
}

/** The ID token to send as the bearer, renewed with the refresh token when it is about to lapse. */
export const idToken = async () => {
  const session = readSession()
  if (!session) {
    return null
  }
  if (Date.now() < session.expiresAt) {
    return session.id_token
  }
  try {
    const renewed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refresh_token })
    writeSession({ ...renewed, refresh_token: session.refresh_token })
    return renewed.id_token
  } catch (error) {
    // Only a refusal ends the session. A network blip must not sign the person out and lose what they were doing.
    if (!error.refused) {
      throw error
    }
    localStorage.removeItem(KEYS.session)
    return null
  }
}

export const logout = () => {
  localStorage.removeItem(KEYS.session)
  location.assign(
    `https://${config.cognitoDomain}/logout?client_id=${config.clientId}&logout_uri=${encodeURIComponent(location.origin)}`
  )
}

export const authHeaders = async () => {
  if (isLocal) {
    return { 'x-local-user': localUser }
  }
  const token = await idToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export const signedIn = async () => isLocal || (await idToken()) !== null

const decodePayload = (token) => {
  try {
    return JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')))
  } catch {
    return {}
  }
}

/** Who is signed in, for the profile menu only. The API decides access; this just shows the name and address. */
export const profile = async () => {
  if (isLocal) {
    return { email: localUser, name: localUser.split('@')[0], local: true }
  }
  const claims = decodePayload((await idToken()) ?? '')
  return { email: claims.email ?? '', name: claims.name ?? claims.email ?? '', local: false }
}
