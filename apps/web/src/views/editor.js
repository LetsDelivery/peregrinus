import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { canEdit } from '../lib/store.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const authTypes = () => [
  ['inherit', t('Herdar do pai')],
  ['none', t('Sem autenticação')],
  ['bearer', 'Bearer token'],
  ['basic', 'Basic'],
  ['apikey', 'API Key']
]

const bodyTypes = () => [
  ['none', t('Nenhum')],
  ['raw', 'Raw'],
  ['urlencoded', 'x-www-form-urlencoded'],
  ['formdata', t('form-data (texto)')],
  ['graphql', 'GraphQL']
]

export const tabs = () => [
  ['query', 'Params'],
  ['headers', 'Headers'],
  ['body', 'Body'],
  ['auth', t('Autenticação')],
  ['settings', t('Envio')]
]

const options = (list, current) =>
  list.map(([value, label]) => html`<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`)

const rows = (path, list) => html`<div class="kv">
  ${list.map(
    (row, index) => html`<div class="kv-row">
      <input type="checkbox" aria-label="${t('Ativa')}" data-bind="${path}.${index}.disabled" data-invert ${row.disabled ? '' : 'checked'} />
      <input placeholder="${t('chave')}" value="${row.key}" data-bind="${path}.${index}.key" />
      <input placeholder="${t('valor')}" value="${row.value}" data-bind="${path}.${index}.value" />
      <button class="icon" aria-label="${t('Remover linha')}" data-action="remove-row" data-target="${path}" data-index="${index}">×</button>
    </div>`
  )}
  <button class="ghost" data-action="add-row" data-target="${path}">${t('+ Adicionar')}</button>
</div>`

const bodyFields = (body) => {
  switch (body.mode) {
    case 'raw':
      return html`<select data-bind="body.language" aria-label="${t('Formato')}">
          ${['json', 'text', 'xml', 'html', 'javascript'].map((lang) => html`<option ${lang === body.language ? 'selected' : ''}>${lang}</option>`)}
        </select>
        <textarea rows="10" spellcheck="false" data-bind="body.content">${body.content}</textarea>`
    case 'urlencoded':
    case 'formdata':
      return rows('body.fields', body.fields)
    case 'graphql':
      return html`<textarea rows="6" data-bind="body.query" placeholder="query">${body.query}</textarea>
        <textarea rows="4" data-bind="body.variables" placeholder="variables (JSON)">${body.variables}</textarea>`
    default:
      return html`<p class="empty">${t('Esta requisição não tem body.')}</p>`
  }
}

const authFields = (auth) => {
  switch (auth.type) {
    case 'bearer':
      return html`<input placeholder="token" value="${auth.token}" data-bind="auth.token" />`
    case 'basic':
      return html`<input placeholder="${t('usuário')}" value="${auth.username}" data-bind="auth.username" />
        <input type="password" placeholder="${t('senha')}" value="${auth.password}" data-bind="auth.password" />`
    case 'apikey':
      return html`<input placeholder="${t('chave')}" value="${auth.key}" data-bind="auth.key" />
        <input placeholder="${t('valor')}" value="${auth.value}" data-bind="auth.value" />
        <select data-bind="auth.in"><option ${auth.in === 'header' ? 'selected' : ''}>header</option><option ${auth.in === 'query' ? 'selected' : ''}>query</option></select>`
    default:
      return html`<p class="empty">${auth.type === 'inherit' ? t('Usa a autenticação da pasta ou da coleção.') : t('Sem autenticação.')}</p>`
  }
}

/** The per-request view of the same settings the dialog edits: how to send, and the certificate. */
const sendPanel = (state) => html`<fieldset class="settings">
    <legend>${t('Enviar por')}</legend>
    <label><input type="radio" name="via" value="server" data-setting="via" ${state.settings.via === 'server' ? 'checked' : ''} /> ${t('Servidor')} <small>${t('(sem CORS; não alcança localhost nem rede interna)')}</small></label>
    <label><input type="radio" name="via" value="browser" data-setting="via" ${state.settings.via === 'browser' ? 'checked' : ''} /> ${t('Meu browser')} <small>${t('(para localhost e rede interna; a API precisa liberar CORS)')}</small></label>
  </fieldset>
  <label class="check"><input type="checkbox" data-setting="verifyTls" ${state.settings.verifyTls ? 'checked' : ''} ${state.settings.via === 'server' ? '' : 'disabled'} /> ${t('Verificar certificado SSL (só pelo servidor)')}</label>
  ${state.settings.verifyTls || state.settings.via !== 'server' ? '' : html`<p class="warn-box">${t('Atenção: sem verificar o certificado, quem estiver no meio do caminho pode ler e alterar esta chamada. Use só em homologação.')}</p>`}`

const panel = (state) => {
  const request = state.current
  switch (state.tab) {
    case 'headers':
      return rows('headers', request.headers)
    case 'body':
      return html`<select data-bind-mode="body" aria-label="${t('Tipo de body')}">${options(bodyTypes(), request.body.mode)}</select>${bodyFields(request.body)}`
    case 'auth':
      return html`<select data-bind-mode="auth" aria-label="${t('Tipo de autenticação')}">${options(authTypes(), request.auth.type)}</select>${authFields(request.auth)}`
    case 'settings':
      return sendPanel(state)
    default:
      return rows('query', request.query)
  }
}

export const editor = (state) => {
  if (!state.current) {
    return html`<p class="empty">${t('Escolha uma requisição na lista, ou comece uma nova.')}</p>`
  }
  const request = state.current
  return html`<div class="urlbar">
      <select data-bind="method" aria-label="${t('Método')}">${options(
        METHODS.map((m) => [m, m]),
        request.method.toUpperCase()
      )}</select>
      <input class="url" placeholder="${t('https://… ou {{baseUrl}}/caminho')}" value="${request.url}" data-bind="url" aria-label="URL" />
      <button class="primary" data-action="send" ${state.sending ? 'disabled' : ''}>${state.sending ? t('Enviando…') : t('Enviar')}</button>
      <button class="ghost" data-action="save" ${canEdit() ? '' : 'disabled'} title="${canEdit() ? t('Guardar as mudanças na coleção') : t('Você só pode ler neste workspace')}">${t('Salvar')}</button>
    </div>
    <nav class="tabs" role="tablist">
      ${tabs().map(([id, label]) => html`<button role="tab" class="${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`)}
    </nav>
    <div class="panel">${panel(state)}</div>`
}
