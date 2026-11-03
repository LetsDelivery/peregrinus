/** Every method the API has a route for. A browser refuses a call whose method the preflight did not announce. */
export const API_METHODS = 'GET, POST, PUT, DELETE, OPTIONS'

/**
 * The CORS headers for the local server, where the panel runs on its own port. Only the panel's own origins
 * are answered; any other origin gets no `access-control-allow-origin` and the browser blocks the call.
 */
export const corsHeaders = (origin: string | null, panelOrigins: readonly string[]): Record<string, string> => ({
  ...(origin !== null && panelOrigins.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
  vary: 'Origin',
  'access-control-allow-headers': 'content-type, authorization, x-local-user',
  'access-control-allow-methods': API_METHODS
})
