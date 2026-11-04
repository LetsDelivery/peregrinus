import { LANGUAGES, renderDocumentation, renderStandalone } from '@postmano/docs'

import { ApiError, api } from './lib/api.js'
import { isLocal, logout, profile } from './lib/auth.js'
import { html, mount, raw } from './lib/html.js'
import { locale, setLocale, t } from './lib/i18n.js'
import { savePrefs, state } from './lib/store.js'
import { applyTheme, isNight } from './lib/theme.js'

/**
 * The page at `/docs/<slug>`: a published collection on its own, with no sidebar and no editor, as an API's
 * Swagger page. The server decides whether this person may open it; here there is only the page, or why not.
 */
const view = { page: null, failure: null, who: null }

const $ = (selector) => document.querySelector(selector)

const shell = html`<header class="top">
    <div class="top-left"><img class="logo" src="/wordmark-dark.svg" alt="postmano" height="36" /><strong id="viewer-title"></strong></div>
    <div class="top-right" id="viewer-tools"></div>
  </header>
  <main class="viewer" id="viewer-body"></main>`

const tools = () => {
  const night = isNight(state.settings.theme)
  return html`${
    view.page
      ? html`<select data-viewer-language aria-label="${t('Linguagem dos exemplos')}">${LANGUAGES.map((l) => html`<option value="${l.id}" ${l.id === state.docsLanguage ? 'selected' : ''}>${l.label}</option>`)}</select>
        <button class="ghost" data-viewer-export>${t('Exportar HTML')}</button>`
      : ''
  }
    <button class="icon-btn theme-toggle" data-viewer-theme aria-label="${night ? t('Modo claro') : t('Modo escuro')}" title="${night ? t('Mudar para o modo claro') : t('Mudar para o modo escuro')}">${night ? '☀️' : '🌙'}</button>
    ${view.who && !view.who.local ? html`<span class="who">${view.who.email}</span><button class="ghost" data-viewer-logout>${t('Sair')}</button>` : ''}`
}

const FAILURES = {
  forbidden: () => t('Você não tem acesso a esta documentação. Peça a quem a publicou para liberar o seu e-mail.'),
  not_found: () => t('Este link não existe ou foi removido.')
}

const body = () => {
  if (view.failure) {
    const message = (FAILURES[view.failure.code] ?? (() => t('Não foi possível abrir a documentação.')))()
    return html`<div class="viewer-message"><p>${message}</p>${view.who && !view.who.local && view.failure.code === 'forbidden' ? html`<p class="hint">${t('Conta em uso: {email}', { email: view.who.email })}</p><button class="ghost" data-viewer-logout>${t('Sair e entrar com outra conta')}</button>` : ''}</div>`
  }
  if (!view.page) {
    return html`<p class="empty">${t('Carregando…')}</p>`
  }
  return html`<div class="docs-frame">${raw(renderDocumentation(view.page.collection, options()))}</div>`
}

const options = () => ({ variables: view.page.variables, language: state.docsLanguage, locale: locale() })

const draw = () => {
  setLocale(state.settings.language)
  applyTheme(state.settings.theme)
  document.title = view.page ? `${view.page.title} · postmano` : 'postmano'
  $('#viewer-title').textContent = view.page?.title ?? ''
  mount($('#viewer-tools'), tools())
  mount($('#viewer-body'), body())
}

const download = () => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([renderStandalone(view.page.collection, options())], { type: 'text/html' }))
  link.download = `${view.page.title.replace(/[^\w-]+/g, '-')}.html`
  link.click()
  URL.revokeObjectURL(link.href)
}

const onClick = (event) => {
  const data = event.target.closest('[data-viewer-export],[data-viewer-theme],[data-viewer-logout]')?.dataset
  if (data?.viewerExport !== undefined) {
    download()
  } else if (data?.viewerTheme !== undefined) {
    state.settings.theme = isNight(state.settings.theme) ? 'light' : 'dark'
    savePrefs()
    draw()
  } else if (data?.viewerLogout !== undefined) {
    logout()
  }
}

const onChange = (event) => {
  if (event.target.dataset.viewerLanguage !== undefined) {
    state.docsLanguage = event.target.value
    savePrefs()
    draw()
  }
}

export const startViewer = async (slug) => {
  mount($('#app'), shell)
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  view.who = await profile().catch(() => null)
  draw()
  try {
    view.page = await api.get(`/v1/docs/${slug}`)
    state.docsLanguage = view.page.language
  } catch (error) {
    view.failure = error instanceof ApiError ? error : new ApiError('unknown')
  }
  draw()
  if (isLocal && view.page) {
    view.who = await profile()
  }
}
