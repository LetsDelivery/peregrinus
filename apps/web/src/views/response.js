import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'

const kind = (status) => {
  if (status >= 500) {
    return 'err'
  }
  if (status >= 400) {
    return 'warn'
  }
  return status >= 300 ? 'info' : 'ok'
}

const size = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`)

const pretty = (result) => {
  if (result.bodyEncoding === 'base64') {
    return t('(conteúdo binário, {size})', { size: size(result.sizeBytes) })
  }
  try {
    return JSON.stringify(JSON.parse(result.body), null, 2)
  } catch {
    return result.body
  }
}

const summary = (result) => html`<div class="summary">
  <span class="status ${kind(result.status)}">${result.status} ${result.statusText}</span>
  <span>${result.timeMs} ms</span><span>${size(result.sizeBytes)}</span>
  ${result.redirects.length ? html`<span>${t('{count} redirecionamento(s)', { count: result.redirects.length })}</span>` : ''}
</div>`

const body = (state, result) =>
  state.responseTab === 'headers'
    ? html`<dl class="headers">${result.headers.map(([name, value]) => html`<dt>${name}</dt><dd>${value}</dd>`)}</dl>`
    : html`<pre class="body">${pretty(result)}</pre>`

export const response = (state) => {
  const data = state.response
  if (!data) {
    return html`<p class="empty">${t('A resposta aparece aqui.')}</p>`
  }
  if (data.error) {
    return html`<div class="error"><strong>${data.error.message}</strong>${data.error.detail ? html`<small>${data.error.detail}</small>` : ''}</div>`
  }
  const missing = data.unresolved.length
    ? html`<div class="warn-box">${t('Variáveis sem valor:')} ${data.unresolved.map((name) => html`<code>{{${name}}}</code> `)}</div>`
    : ''
  return html`${missing}${summary(data.result)}
    <nav class="tabs small">
      <button class="${state.responseTab === 'body' ? 'on' : ''}" data-rtab="body">${t('Corpo')}</button>
      <button class="${state.responseTab === 'headers' ? 'on' : ''}" data-rtab="headers">Headers</button>
    </nav>${body(state, data.result)}`
}
