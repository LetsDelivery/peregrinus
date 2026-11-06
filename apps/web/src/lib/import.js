import { t } from './i18n.js'

/**
 * What the person is told after choosing files to import. `done` has one `{ kind, warnings }` per file that came in,
 * `failed` one `{ name, message }` per file that did not. One sentence for what came in, then the first warning and the
 * first failure, because a list of fifty would not be read. `skipped` counts the files of a zip that were neither a
 * collection nor an environment.
 */
export const importMessage = (done, failed, skipped = 0) => {
  const count = (kind) => done.filter((result) => result.kind === kind).length
  const things = [
    count('collection') > 0 ? t('{count} coleção(ões)', { count: count('collection') }) : '',
    count('environment') > 0 ? t('{count} ambiente(s)', { count: count('environment') }) : ''
  ].filter(Boolean)
  const warnings = done.flatMap((result) => result.warnings)
  return [
    things.length > 0 ? t('Importado: {what}.', { what: things.join(', ') }) : t('Nada foi importado.'),
    warnings.length > 0
      ? t('{count} aviso(s): {message}', { count: warnings.length, message: warnings[0].message })
      : '',
    skipped > 0 ? t('{count} arquivo(s) do .zip ignorado(s): não são coleção nem ambiente.', { count: skipped }) : '',
    failed.length > 0
      ? t('{count} arquivo(s) não importado(s): {name} ({message})', {
          count: failed.length,
          name: failed[0].name,
          message: failed[0].message
        })
      : ''
  ]
    .filter(Boolean)
    .join(' ')
}
