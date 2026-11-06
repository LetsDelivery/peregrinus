import { LANGUAGES } from '@postmano/docs'

import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { daysLeft, formatUtc, formatUtcDay, shareUrl, treeRows, WARN_DAYS } from '../lib/share.js'
import { canAdmin } from '../lib/store.js'

const visibilities = (draft) => [
  ['workspace', t('Só os membros do workspace')],
  ['people', t('Pessoas específicas')],
  ['company', t('Qualquer pessoa da empresa (com login)')],
  ['link', t('Qualquer pessoa com o link (sem login)')],
  // Only an admin makes a page with a password; one that already is one stays in the list for whoever reads it.
  ...(canAdmin() || draft.visibility === 'password' ? [['password', t('Cliente, com senha')]] : [])
]

const options = (list, current) =>
  list.map(([value, label]) => html`<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`)

const field = (label, control) => html`<label class="field">${label}${control}</label>`

const environmentOptions = (state) => [['', t('Nenhum')], ...state.environments.map((env) => [env.id, env.name])]

const address = (draft, index) =>
  draft.slug
    ? html`<div class="share-url">
        <input readonly value="${shareUrl(location.origin, draft.slug)}" aria-label="${t('Endereço')}" />
        <button class="ghost" data-action="copy-share" data-index="${index}">${t('Copiar')}</button>
      </div>`
    : html`<p class="hint">${t('O endereço aparece depois de salvar.')}</p>`

// ---- what to publish --------------------------------------------------------------------------------------

const health = (draft) => {
  const { added = 0, removed = 0 } = draft.health ?? {}
  return html`${added > 0 ? html`<p class="warn-box">${t('{count} requisição(ões) nova(s) na coleção não estão publicadas.', { count: added })}</p>` : ''}
    ${removed > 0 ? html`<p class="warn-box">${t('{count} requisição(ões) da seleção foram apagadas da coleção.', { count: removed })}</p>` : ''}`
}

const row = (item, index) =>
  item.empty
    ? html`<div class="tree-row muted" style="padding-left:${item.depth * 18}px">${item.name}</div>`
    : html`<label class="tree-row ${item.kind}" style="padding-left:${item.depth * 18}px">
        <input type="checkbox" data-share-tick="${index}" data-node="${item.id}" data-state="${item.state}" ${item.state === 'on' ? 'checked' : ''} />
        ${item.kind === 'request' ? html`<span class="method m-${item.method.toLowerCase()}">${item.method}</span>` : ''}
        <span>${item.name}</span>
      </label>`

const tree = (draft, index, state) =>
  html`<div class="select-tree" role="group" aria-label="${t('O que publicar')}">${treeRows(state.collection.items, draft.selection).map((item) => row(item, index))}</div>
    <p class="hint">${t('Marque as requisições que aparecem. Marcar uma pasta marca o que há nela agora; o que for acrescentado depois não entra sozinho.')}</p>
    ${health(draft)}`

const scope = (draft, index, state) => html`
  <fieldset class="field radios">
    <legend>${t('O que publicar')}</legend>
    <label><input type="radio" name="mode-${index}" data-share-bind="${index}.mode" value="whole" ${draft.mode === 'whole' ? 'checked' : ''} /> ${t('Coleção inteira (acompanha o que for acrescentado)')}</label>
    <label><input type="radio" name="mode-${index}" data-share-bind="${index}.mode" value="selection" ${draft.mode === 'selection' ? 'checked' : ''} /> ${t('Seleção')}</label>
  </fieldset>
  ${draft.mode === 'selection' ? tree(draft, index, state) : ''}`

// ---- until when -------------------------------------------------------------------------------------------

const expiryOptions = (draft) => [
  ...(draft.slug
    ? [
        [
          'keep',
          draft.expiresAt
            ? t('Manter: vence em {date}', { date: formatUtc(draft.expiresAt) })
            : t('Manter: sem validade')
        ]
      ]
    : []),
  ['7', t('7 dias')],
  ['30', t('30 dias')],
  ['90', t('90 dias')],
  ['date', t('Até uma data')],
  ['never', t('Sem validade')]
]

const expiryNote = (draft) => {
  const left = daysLeft(draft.expiresAt)
  if (draft.slug && left !== null && left <= 0) {
    return html`<p class="warn-box">${t('Já expirou em {date}. Quem abre vê que o acesso expirou.', { date: formatUtc(draft.expiresAt) })}</p>`
  }
  if (draft.slug && left !== null && left <= WARN_DAYS) {
    return html`<p class="warn-box">${t('Expira em {days} dia(s), em {date}.', { days: left, date: formatUtc(draft.expiresAt) })}</p>`
  }
  const renews = draft.visibility === 'password' && draft.slug && draft.expiryKind !== 'keep'
  return renews
    ? html`<p class="hint">${t('Renovar uma página com senha também troca a senha: a nova aparece depois de salvar.')}</p>`
    : ''
}

const expiry = (draft, index) => html`
  ${field(t('Validade'), html`<select data-share-bind="${index}.expiryKind">${options(expiryOptions(draft), draft.expiryKind)}</select>`)}
  ${draft.expiryKind === 'date' ? field(t('Vale até o fim deste dia (horário UTC)'), html`<input type="date" data-share-bind="${index}.expiryDate" value="${draft.expiryDate}" />`) : ''}
  ${expiryNote(draft)}`

// ---- who may open it --------------------------------------------------------------------------------------

const issuedBox = (issued, index) =>
  issued
    ? html`<div class="password-box">
        <strong>${t('Senha de acesso')}</strong>
        <code>${issued}</code>
        <button class="ghost" data-action="copy-password" data-index="${index}">${t('Copiar senha')}</button>
        <p class="hint">${t('Aparece só agora. Copie e envie ao cliente; se perder, troque a senha.')}</p>
      </div>`
    : ''

const passwordStatus = (draft, index) =>
  draft.slug && draft.passwordSetAt
    ? html`<p>${t('Senha definida em {date}.', { date: formatUtcDay(draft.passwordSetAt) })}
        ${canAdmin() ? html`<button class="ghost" data-action="rotate-share" data-index="${index}">${t('Trocar senha')}</button>` : ''}</p>`
    : ''

const lockNote = (draft) =>
  draft.lockedUntil && Date.parse(draft.lockedUntil) > Date.now()
    ? html`<p class="warn-box">${t('Bloqueado até {time} por tentativas erradas. Trocar a senha libera.', { time: formatUtc(draft.lockedUntil) })}</p>`
    : ''

const passwordBox = (draft, index, state) => {
  if (draft.visibility !== 'password') {
    return ''
  }
  return html`<p class="warn-box">${t('Esta página é para quem não é da empresa: quem souber a senha abre, sem entrar. Confira que nada confidencial aparece nela.')}</p>
    ${draft.slug ? '' : html`<p class="hint">${t('A senha é gerada ao salvar e aparece uma única vez.')}</p>`}
    ${issuedBox(draft.slug ? state.issued[draft.slug] : undefined, index)}
    ${passwordStatus(draft, index)}
    ${lockNote(draft)}`
}

const rules = (draft, index, state) => html`
  ${field(t('Quem pode abrir'), html`<select data-share-bind="${index}.visibility">${options(visibilities(draft), draft.visibility)}</select>`)}
  ${
    draft.visibility === 'people'
      ? field(
          t('Endereços de e-mail (um por linha)'),
          html`<textarea rows="3" data-share-bind="${index}.peopleText" placeholder="nome@uselets.com">${draft.peopleText}</textarea>`
        )
      : ''
  }
  ${draft.visibility === 'link' ? html`<p class="warn-box">${t('Qualquer pessoa com o endereço abre esta página, sem entrar. Confira que nada confidencial aparece nela.')}</p>` : ''}
  ${passwordBox(draft, index, state)}`

const lastAccess = (draft) =>
  draft.slug
    ? html`<p class="hint">${draft.lastAccessAt ? t('Último acesso: {date}', { date: formatUtc(draft.lastAccessAt) }) : t('Ainda sem acessos.')}</p>`
    : ''

const actions = (draft, index) =>
  html`<div class="actions">
    <button class="primary" data-action="save-share" data-index="${index}">${t('Salvar link')}</button>
    ${draft.slug ? html`<button class="ghost" data-action="delete-share" data-index="${index}">${t('Excluir link')}</button>` : html`<button class="ghost" data-action="drop-share" data-index="${index}">${t('Descartar')}</button>`}
  </div>`

const card = (draft, index, state) => {
  // A page with a password is the admins' alone: an editor sees it, and every field is closed.
  const closed = draft.adminOnly && !canAdmin()
  return html`<section class="share-card">
    ${closed ? html`<p class="hint">${t('Só um admin do workspace muda uma página com senha.')}</p>` : ''}
    <fieldset class="share-fields" ${closed ? 'disabled' : ''}>
      ${field(t('Nome do link'), html`<input data-share-bind="${index}.title" value="${draft.title}" />`)}
      ${rules(draft, index, state)}
      ${scope(draft, index, state)}
      ${expiry(draft, index)}
      ${field(t('Ambiente para os exemplos'), html`<select data-share-bind="${index}.environmentId">${options(environmentOptions(state), draft.environmentId)}</select>`)}
      ${field(
        t('Linguagem dos exemplos'),
        html`<select data-share-bind="${index}.language">${options(
          LANGUAGES.map((l) => [l.id, l.label]),
          draft.language
        )}</select>`
      )}
    </fieldset>
    ${address(draft, index)}
    ${lastAccess(draft)}
    ${closed ? '' : actions(draft, index)}
  </section>`
}

/** The links of the open collection: each is an address with its own rule for who may open it, and until when. */
export const share = (state) => {
  if (!state.shareOpen || !state.collection) {
    return ''
  }
  return html`<div class="backdrop"><div class="dialog share-dialog" role="dialog" aria-label="${t('Compartilhar a documentação')}">
    <div class="dialog-body wide">
      <button class="icon close" data-action="close-share" aria-label="${t('Fechar')}">×</button>
      <h3>${t('Compartilhar a documentação')}</h3>
      <p class="hint">${t('Cada link tem a sua regra de acesso e a sua validade. Senhas, tokens e variáveis secretas nunca saem.')}</p>
      ${state.shares.length === 0 ? html`<p class="empty">${t('Esta coleção ainda não tem links.')}</p>` : state.shares.map((draft, index) => card(draft, index, state))}
      <div class="actions"><button class="ghost" data-action="new-share">${t('+ Novo link')}</button></div>
    </div>
  </div></div>`
}
