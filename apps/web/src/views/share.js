import { LANGUAGES } from '@peregrinus/docs'

import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { folderOptions, shareUrl } from '../lib/share.js'

const visibilities = () => [
  ['workspace', t('Só os membros do workspace')],
  ['people', t('Pessoas específicas')],
  ['company', t('Qualquer pessoa da empresa (com login)')],
  ['link', t('Qualquer pessoa com o link (sem login)')]
]

const options = (list, current) =>
  list.map(([value, label]) => html`<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`)

const field = (label, control) => html`<label class="field">${label}${control}</label>`

const scopeOptions = (state) => [
  ['', t('Coleção inteira')],
  ...folderOptions(state.collection.items).map((o) => [o.value, o.label])
]

const environmentOptions = (state) => [['', t('Nenhum')], ...state.environments.map((env) => [env.id, env.name])]

const address = (draft, index) =>
  draft.slug
    ? html`<div class="share-url">
        <input readonly value="${shareUrl(location.origin, draft.slug)}" aria-label="${t('Endereço')}" />
        <button class="ghost" data-action="copy-share" data-index="${index}">${t('Copiar')}</button>
      </div>`
    : html`<p class="hint">${t('O endereço aparece depois de salvar.')}</p>`

const rules = (draft, index) => html`
  ${field(t('Quem pode abrir'), html`<select data-share-bind="${index}.visibility">${options(visibilities(), draft.visibility)}</select>`)}
  ${
    draft.visibility === 'people'
      ? field(
          t('Endereços de e-mail (um por linha)'),
          html`<textarea rows="3" data-share-bind="${index}.peopleText" placeholder="nome@uselets.com">${draft.peopleText}</textarea>`
        )
      : ''
  }
  ${draft.visibility === 'link' ? html`<p class="warn-box">${t('Qualquer pessoa com o endereço abre esta página, sem entrar. Confira que nada confidencial aparece nela.')}</p>` : ''}`

const card = (draft, index, state) => html`<section class="share-card">
  ${field(t('Nome do link'), html`<input data-share-bind="${index}.title" value="${draft.title}" />`)}
  ${rules(draft, index)}
  ${field(t('O que publicar'), html`<select data-share-bind="${index}.folder">${options(scopeOptions(state), draft.folder)}</select>`)}
  ${field(t('Ambiente para os exemplos'), html`<select data-share-bind="${index}.environmentId">${options(environmentOptions(state), draft.environmentId)}</select>`)}
  ${field(
    t('Linguagem dos exemplos'),
    html`<select data-share-bind="${index}.language">${options(
      LANGUAGES.map((l) => [l.id, l.label]),
      draft.language
    )}</select>`
  )}
  ${address(draft, index)}
  <div class="actions">
    <button class="primary" data-action="save-share" data-index="${index}">${t('Salvar link')}</button>
    ${draft.slug ? html`<button class="ghost" data-action="delete-share" data-index="${index}">${t('Excluir link')}</button>` : html`<button class="ghost" data-action="drop-share" data-index="${index}">${t('Descartar')}</button>`}
  </div>
</section>`

/** The links of the open collection: each is an address with its own rule for who may open it. */
export const share = (state) => {
  if (!state.shareOpen || !state.collection) {
    return ''
  }
  return html`<div class="backdrop"><div class="dialog share-dialog" role="dialog" aria-label="${t('Compartilhar a documentação')}">
    <div class="dialog-body wide">
      <button class="icon close" data-action="close-share" aria-label="${t('Fechar')}">×</button>
      <h3>${t('Compartilhar a documentação')}</h3>
      <p class="hint">${t('Cada link tem a sua regra de acesso. A página acompanha a coleção: o que você edita aparece sem publicar de novo. Senhas, tokens e variáveis secretas nunca saem.')}</p>
      ${state.shares.length === 0 ? html`<p class="empty">${t('Esta coleção ainda não tem links.')}</p>` : state.shares.map((draft, index) => card(draft, index, state))}
      <div class="actions"><button class="ghost" data-action="new-share">${t('+ Novo link')}</button></div>
    </div>
  </div></div>`
}
