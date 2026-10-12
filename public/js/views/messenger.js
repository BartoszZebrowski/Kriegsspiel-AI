// Widok: prawy dok, „Komunikator” — pasek przypiętych kanałów (+ popover „Wszystkie kanały”), nagłówek kanału,
// karty wiadomości (nadawca, rola, znaczniki, DTG i tura, wzmianki, załączniki, stan doręczenia)
// oraz komponowanie (rodzaj, „Pilne”, szablony, szkice, podpowiedzi @ i #).
// Renderuje ze store; wszystkie akcje zgłasza kontrolerowi.
import { escapeHtml as e } from '../domain/markdown.js';
import { draftType, channelListModel } from '../domain/compose.js';
import { draftOrders } from '../domain/order.js';
import { countCcir } from '../domain/ccir.js';
import { ic } from '../lib/icons.js';
import { TEMPLATES, PLACEHOLDERS, TEMPLATE_MENU, isTemplate } from './messenger/templates.js';
import { channelGlyph } from './messenger/glyphs.js';
import { createThread } from './messenger/thread.js';
import { createMentionPopup } from './messenger/mentions.js';
import { orderChipsHtml } from './messenger/orders.js';
import { warnHtml } from './messenger/warn.js';
import { createFormPanel } from './messenger/form.js';
import { FORM_MENU, missingFields, composeFormMessage } from '../domain/forms.js';

export { TEMPLATES };

export function createMessengerView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const els = {
    tabs: $('chtabs'),
    search: $('ch-search'),
    warn: $('compose-warn'),
    head: $('m-head'),
    thread: $('thread'),
    form: $('compose'),
    text: $('compose-text'),
    send: $('compose-send'),
    hint: $('compose-hint'),
    chips: $('compose-chips'),
    attachBtn: $('attach-btn'),
    attachMenu: $('attach-menu'),
    tplBtn: $('tpl-btn'),
    tplMenu: $('tpl-menu'),
    urgent: $('sw-urg'),
    types: $('seg-type'),
    mention: $('mention-pop'),
    ccirBtn: $('m-ccir'),
    formBox: $('compose-form'),
  };
  const S = () => store.get();

  // Szkic wiadomości (tekst, rodzaj, „Pilne”, załączniki) żyje w store, osobno dla każdego kanału.
  // Stan lokalny widoku: zapytanie na liście kanałów, oczekująca pinezka, podpowiedzi.
  const draft = () => S().draft;
  const type = () => draftType(S().draft, S().channel);
  const patchDraft = (patch) => controller.setDraft(S().activeChannel, patch);
  let channelQuery = '';
  let pendingPin = null; // { channel } — pinezka rysowana na prośbę podpowiedzi; po zapisie trafia jako załącznik
  let knownNoteIds = new Set();
  let ccirOnly = false; // filtr „tylko CCIR” (T48) — stan lokalny widoku
  const thread = createThread({ box: els.thread, ccirOnly: () => ccirOnly });
  const formPanel = createFormPanel({ box: els.formBox, S, controller });
  const mentions = createMentionPopup({ text: els.text, pop: els.mention, S, patchDraft, onSend: () => send() });

  // ---------- lista kanałów (stale na wierzchu: przełożony, sztab, sąsiedzi, podwładni) ----------
  function renderTabs(s) {
    const groups = channelListModel(s.channels, { query: channelQuery, activeId: s.channel?.id ?? null });
    els.tabs.innerHTML = groups.length
      ? groups
          .map(
            (g) =>
              `<div class="cl-g cap">${g.title}</div>${g.channels
                .map((c) => {
                  const n = s.unread.byChannel[c.id] || 0;
                  const on = s.channel?.id === c.id;
                  return `<div class="cl-i k-${c.kind}${on ? ' on' : ''}" role="option" aria-selected="${on}" tabindex="0"${on ? ' data-leader-anchor' : ''} data-ch="${e(c.id)}" title="${e(c.description || c.name)}"><span class="ch-ic">${channelGlyph(s, c, 16)}</span><span>${e(c.name)}</span>${n ? `<span class="ubadge${c.kind === 'superior' ? ' urg' : ''}">${n}</span>` : ''}</div>`;
                })
                .join('')}`,
          )
          .join('')
      : '<div class="attach__empty">Brak kanałów pasujących do wyszukiwania.</div>';
    els.tabs.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- nagłówek kanału ----------
  function renderHead(s) {
    const c = s.channel;
    if (!c) {
      els.head.innerHTML = '<div class="m-none">Wybierz kanał</div>';
      return;
    }
    els.head.innerHTML = `<div class="av">${channelGlyph(s, c, 28)}</div><div class="m-head-t"><h3>${e(c.name)}</h3><p>${e(c.description || '')}</p></div>`;
    els.head.title = 'Kliknij, aby pokazać jednostkę na mapie';
  }

  // ---------- komponowanie ----------
  function renderCompose({ archive, channel, currentTurn }) {
    const disabled = archive || !channel;
    els.form.classList.toggle('is-disabled', disabled);
    els.text.disabled = disabled;
    els.send.disabled = disabled;
    els.attachBtn.disabled = disabled;
    els.tplBtn.disabled = disabled;
    els.urgent.disabled = disabled;
    for (const b of els.types.querySelectorAll('button')) b.disabled = disabled;
    els.hint.innerHTML = archive
      ? 'Archiwum — wróć do bieżącej tury, aby wydawać rozkazy'
      : channel
        ? `<span class="mono">T${currentTurn}</span><kbd>Ctrl</kbd><kbd>↵</kbd>`
        : 'Wybierz kanał';
  }

  function setType(t, { fill = true } = {}) {
    const patch = { type: t };
    const text = draft().text;
    if (fill && !draft().form && (!text.trim() || isTemplate(text))) patch.text = TEMPLATES[t];
    patchDraft(patch);
  }

  const setUrgent = (on) => patchDraft({ urgent: on });

  // Przenosi szkic ze store do pól formularza (tylko gdy się różnią — bez skakania kursora).
  function syncDraft(s) {
    const d = s.draft;
    const ty = draftType(d, s.channel);
    if (els.text.value !== d.text) els.text.value = d.text;
    for (const b of els.types.querySelectorAll('button')) b.classList.toggle('on', b.dataset.ty === ty);
    els.text.placeholder = d.form ? 'Dopisek do formularza (opcjonalnie)…' : PLACEHOLDERS[ty];
    els.urgent.classList.toggle('on', d.urgent);
    els.urgent.setAttribute('aria-pressed', String(d.urgent));
    renderChips();
    formPanel.render(s);
    renderWarn(s);
  }

  function renderWarn(s) {
    const html = warnHtml(s);
    els.warn.innerHTML = html;
    els.warn.hidden = !html;
  }

  function renderChips() {
    const { notes } = S();
    const ids = draft().attachIds.filter((id) => notes.some((n) => n.id === id));
    els.chips.innerHTML =
      ids
        .map((id) => {
          const n = notes.find((x) => x.id === id);
          return `<span class="att att--sel">${ic('clip', 's')}${e(n.name)}<a role="button" tabindex="0" data-unattach="${e(id)}" aria-label="Usuń załącznik">${ic('x', 's')}</a></span>`;
        })
        .join('') + orderChipsHtml(draftOrders(draft()));
  }

  function renderAttachMenu() {
    const { notes } = S();
    els.attachMenu.innerHTML =
      `<div class="cl-g cap">Dołącz szkic z mapy</div>` +
      (notes.length
        ? notes
            .map((n) => `<label class="cl-i attach__item"><input type="checkbox" value="${e(n.id)}"${draft().attachIds.includes(n.id) ? ' checked' : ''}> <span>${e(n.name)}</span></label>`)
            .join('')
        : '<div class="attach__empty">Brak szkiców. Narysuj coś na mapie narzędziami po lewej.</div>');
  }

  function renderTemplateMenu() {
    const item = (attr, id, name) => `<div class="cl-i" role="menuitem" tabindex="0" ${attr}="${id}">${ic('tpl', 's')}<span>${name}</span></div>`;
    els.tplMenu.innerHTML =
      `<div class="cl-g cap">Szablony</div>` + TEMPLATE_MENU.map(([id, name]) => item('data-tpl', id, name)).join('') +
      `<div class="cl-g cap">Formularze</div>` + FORM_MENU.map(([id, name]) => item('data-form', id, e(name))).join('');
  }

  const closeMenus = () => {
    els.attachMenu.classList.remove('open');
    els.tplMenu.classList.remove('open');
  };

  els.attachBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const was = els.attachMenu.classList.contains('open');
    closeMenus();
    if (!was) {
      renderAttachMenu();
      els.attachMenu.classList.add('open');
    }
  });
  els.tplBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const was = els.tplMenu.classList.contains('open');
    closeMenus();
    if (!was) {
      renderTemplateMenu();
      els.tplMenu.classList.add('open');
    }
  });
  els.attachMenu.addEventListener('change', (ev) => {
    const id = ev.target.value;
    const cur = draft().attachIds;
    patchDraft({ attachIds: ev.target.checked ? [...new Set([...cur, id])] : cur.filter((x) => x !== id) });
  });
  els.tplMenu.addEventListener('click', (ev) => {
    const form = ev.target.closest('[data-form]');
    if (form) {
      controller.formSelect(S().activeChannel, form.dataset.form);
      closeMenus();
      return;
    }
    const item = ev.target.closest('[data-tpl]');
    if (!item) return;
    controller.formClear(S().activeChannel);
    patchDraft({ type: item.dataset.tpl, text: TEMPLATES[item.dataset.tpl] });
    closeMenus();
    els.text.focus();
  });
  els.chips.addEventListener('click', (ev) => {
    const show = ev.target.closest('[data-order-show]');
    const del = ev.target.closest('[data-order-del]');
    if (show) return controller.showAttachment(draftOrders(draft()).find((o) => o.id === show.dataset.orderShow));
    if (del) return patchDraft({ orders: draftOrders(draft()).filter((o) => o.id !== del.dataset.orderDel) });
    const btn = ev.target.closest('[data-unattach]');
    if (!btn) return;
    patchDraft({ attachIds: draft().attachIds.filter((x) => x !== btn.dataset.unattach) });
  });
  els.types.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ty]');
    if (b) setType(b.dataset.ty);
  });
  els.urgent.addEventListener('click', () => setUrgent(!draft().urgent));
  els.warn.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pin]');
    if (!b || !S().channel) return;
    pendingPin = { channel: S().channel.id };
    controller.notify(`Wskaż „${b.dataset.pin}” na mapie: postawiona pinezka trafi do wiadomości jako załącznik`);
    controller.command('tool', 'point');
  });

  // ---------- wysyłanie ----------
  async function send() {
    const s = S();
    const form = draft().form ?? null;
    if (form) {
      const missing = missingFields(form);
      if (missing.length) return controller.notify(`Uzupełnij pola formularza: ${missing.join(', ')}`, true);
    }
    const text = form ? composeFormMessage(form, els.text.value) : els.text.value.trim();
    if (!text || !s.channel || s.archive) return;
    if (!form && isTemplate(els.text.value)) {
      els.text.focus(); // szablon bez uzupełnienia nie jest rozkazem
      return;
    }
    els.send.disabled = true;
    thread.stickToBottom();
    const d = draft();
    const msg = await controller.sendMessage(text, d.attachIds, { type: type(), priority: d.urgent ? 'urgent' : 'normal', orders: draftOrders(d), ...(form ? { form } : {}) });
    if (msg) mentions.close(); // kontroler czyści szkic kanału, widok synchronizuje pola
    renderCompose(S());
  }
  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    send();
  });

  // ---------- zdarzenia użytkownika → intencje ----------
  els.tabs.addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-ch]');
    if (item) controller.selectChannel(item.dataset.ch);
  });
  els.tabs.addEventListener('keydown', (ev) => {
    const item = ev.target.closest('[data-ch]');
    if (item && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      controller.selectChannel(item.dataset.ch);
    }
  });
  els.search.addEventListener('input', () => {
    channelQuery = els.search.value;
    renderTabs(S());
  });
  els.search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const first = els.tabs.querySelector('[data-ch]');
      if (first) controller.selectChannel(first.dataset.ch);
    } else if (ev.key === 'Escape' && els.search.value) {
      ev.stopPropagation();
      els.search.value = channelQuery = '';
      renderTabs(S());
    }
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.comp-bar')) closeMenus();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeMenus();
  });

  els.head.addEventListener('click', () => controller.focusEntity(S().channelUnit));
  $('m-leader').addEventListener('click', () => controller.toggleLeader());
  $('m-search').addEventListener('click', () => controller.openOmnibox());

  els.thread.addEventListener('click', async (ev) => {
    const mention = ev.target.closest('[data-mention-kind]');
    if (mention) return controller.mentionClick(mention.dataset.mentionKind, mention.dataset.mentionId);
    const att = ev.target.closest('[data-attachment]');
    if (att) {
      const a = thread.attachment(att.dataset.attachment);
      if (a) controller.showAttachment(a);
      return;
    }
    const btn = ev.target.closest('[data-withdraw]');
    if (!btn) return;
    btn.dataset.busy = '1';
    if (!(await controller.withdrawMessage(btn.dataset.withdraw))) delete btn.dataset.busy;
  });

  // ---------- subskrypcje ----------
  store.subscribe(['channels', 'channel', 'unread', 'turn'], (s) => {
    renderTabs(s);
    renderHead(s);
  }, { immediate: true });
  function renderCcirFilter(s) {
    els.ccirBtn.classList.toggle('on', ccirOnly);
    els.ccirBtn.setAttribute('aria-pressed', String(ccirOnly));
    const n = countCcir(s.visibleMessages);
    els.ccirBtn.dataset.tip = ccirOnly ? 'Pokaż wszystkie wiadomości' : `Tylko wiadomości z odwołaniem do CCIR (${n})`;
  }
  els.ccirBtn.addEventListener('click', () => {
    ccirOnly = !ccirOnly;
    renderCcirFilter(S());
    thread.render(S());
  });
  store.subscribe('visibleMessages', renderCcirFilter, { immediate: true });
  store.subscribe(['channel', 'visibleMessages', 'archive', 'currentTurn', 'scenario', 'turn', 'places', 'fresh', 'ccir'], (s) => {
    if (s.scenario) thread.render(s);
  }, { immediate: true });
  store.subscribe(['archive', 'channel', 'currentTurn'], renderCompose, { immediate: true });
  store.subscribe(['draft', 'channel', 'turn', 'places', 'archive'], syncDraft, { immediate: true });
  knownNoteIds = new Set(S().notes.map((n) => n.id));
  store.subscribe('notes', ({ notes }) => {
    // Pinezka narysowana na prośbę podpowiedzi „wskaż na mapie” → załącznik szkicu kanału, z którego wyszła.
    const added = notes.filter((n) => !knownNoteIds.has(n.id));
    knownNoteIds = new Set(notes.map((n) => n.id));
    if (pendingPin && added.length) {
      const target = pendingPin.channel;
      pendingPin = null;
      const cur = S().drafts[target]?.attachIds ?? [];
      controller.setDraft(target, { attachIds: [...new Set([...cur, ...added.map((n) => n.id)])] });
    }
    renderChips();
    if (els.attachMenu.classList.contains('open')) renderAttachMenu();
  });
  store.subscribe('ccirEditor', (s) => formPanel.render(s)); // przycisk wskazywania na mapie (tryb aktywny)
  store.subscribe('ui', ({ ui }) => $('m-leader').classList.toggle('on', ui.leader), { immediate: true });
  store.subscribe('command', ({ command }) => {
    if (command?.name !== 'compose') return;
    if (command.arg?.type) setType(command.arg.type);
    els.text.focus();
  });
}
