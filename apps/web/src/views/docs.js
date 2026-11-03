import { LANGUAGES, renderDocumentation, renderStandalone } from '@peregrinus/docs'

import { html, raw } from '../lib/html.js'
import { locale, t } from '../lib/i18n.js'
import { canEdit, publicVariables } from '../lib/store.js'

const options = (state) => ({ variables: publicVariables(), language: state.docsLanguage, locale: locale() })

export const docsHtml = (state) => renderDocumentation(state.collection, options(state))

export const standalone = (state) => renderStandalone(state.collection, options(state))

export const docs = (state) => {
  if (!state.collection) {
    return html`<p class="empty">${t('Abra uma coleção para ver a documentação.')}</p>`
  }
  return html`<div class="docs-bar">
      <label>${t('Exemplos em')}
        <select data-docs-language>${LANGUAGES.map((language) => html`<option value="${language.id}" ${language.id === state.docsLanguage ? 'selected' : ''}>${language.label}</option>`)}</select>
      </label>
      <button class="ghost" data-action="export-docs">${t('Exportar HTML')}</button>
      ${canEdit() ? html`<button class="primary" data-action="open-share">${t('Compartilhar')}</button>` : ''}
      <span class="hint">${t('Variáveis do ambiente escolhido entram nos exemplos. As secretas não.')}</span>
    </div>
    <div class="docs-frame">${raw(docsHtml(state))}</div>`
}
