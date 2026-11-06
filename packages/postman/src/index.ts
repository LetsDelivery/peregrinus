import { type EnvironmentImport, importPostmanEnvironment, looksLikeEnvironment } from './environment.js'
import { type ImportResult, importPostmanCollection } from './import.js'

export type { EnvironmentImport } from './environment.js'
export { importPostmanEnvironment } from './environment.js'
export { type ImportResult, importPostmanCollection } from './import.js'
export type { ImportWarning } from './text.js'

export type PostmanImport = ({ kind: 'collection' } & ImportResult) | EnvironmentImport

/** Reads whatever Postman exported: a collection (v2.0 or v2.1), an environment or globals. */
export const importPostman = (input: unknown): PostmanImport =>
  looksLikeEnvironment(input)
    ? importPostmanEnvironment(input)
    : { kind: 'collection', ...importPostmanCollection(input) }
