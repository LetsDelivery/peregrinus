/**
 * What the panel needs to send a request from the browser itself (for `localhost` and the person's own
 * network): variables and request preparation, with no Node modules, so the same code builds the request
 * that the server sends.
 */
export {
  effectiveAuth,
  type PreparedBody,
  type PreparedRequest,
  type PrepareOptions,
  prepareRequest
} from './prepare.js'
export { createResolver, type DynamicSource, type Scopes } from './variables.js'
