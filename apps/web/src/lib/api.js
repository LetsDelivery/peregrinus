import { apiBase, authHeaders, login } from './auth.js'
import { t } from './i18n.js'

/** What the panel says for each error `code` the API sends; the API's own message is English and for logs. */
const MESSAGES = () => ({
  invalid_request: t('A requisição não está válida.'),
  unauthenticated: t('Entre com a conta Google da empresa.'),
  forbidden: t('Esta conta não tem acesso.'),
  not_found: t('Não encontrado.'),
  unsafe_content: t('O conteúdo parece ter credenciais e o link seria público.'),
  conflict: t('Outra pessoa salvou uma versão mais nova. Recarregue para ver as mudanças.'),
  blocked_destination: t(
    'O servidor não pode chamar este endereço. Para localhost e rede interna, envie pelo browser.'
  ),
  upstream_failed: t('O servidor não conseguiu falar com o destino.'),
  upstream_timeout: t('O destino não respondeu a tempo.'),
  response_too_large: t('A resposta passou do tamanho máximo.'),
  browser_blocked: t(
    'O browser não conseguiu chamar este endereço. Confira se a API aceita CORS para esta página e se o endereço está no ar.'
  )
})

export class ApiError extends Error {
  constructor(code, detail) {
    super(MESSAGES()[code] ?? t('Algo deu errado.'))
    this.code = code
    this.detail = detail
  }
}

const call = async (method, path, body) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const json = await response.json().catch(() => ({ error: response.ok ? undefined : { code: 'upstream_failed' } }))
  if (response.status === 401) {
    await login()
  }
  if (!response.ok) {
    throw new ApiError(json.error?.code, json.error?.message)
  }
  return json
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
  put: (path, body) => call('PUT', path, body),
  del: (path) => call('DELETE', path)
}
