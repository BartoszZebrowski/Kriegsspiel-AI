// Widok: prawy dok, „Komunikator” — pasek przypiętych kanałów (+ popover „Wszystkie kanały”), nagłówek kanału,
// karty wiadomości (nadawca, rola, znaczniki, DTG i tura, wzmianki, załączniki, stan doręczenia)
// oraz komponowanie (rodzaj, „Pilne”, szablony, szkice, podpowiedzi @ i #).
// Renderuje ze store; wszystkie akcje zgłasza kontrolerowi.
import { escapeHtml as e } from '../domain/markdown.js';
import { draftType, foreignUnitMentions, unknownPlaceNames, channelListModel } from '../domain/compose.js';
import { draftOrders } from '../domain/order.js';
import { ic } from '../lib/icons.js';
import { TEMPLATES, PLACEHOLDERS, TEMPLATE_MENU, isTemplate } from './messenger/templates.js';
import { channelGlyph } from './messenger/glyphs.js';
import { createThread } from './messenger/thread.js';
import { createMentionPopup } from './messenger/mentions.js';
import { orderChipsHtml } from './messenger/orders.js';

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
  const thread = createThread({ box: els.thread });
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
    if (fill && (!text.trim() || isTemplate(text))) patch.text = TEMPLATES[t];
    patchDraft(patch);
  }

  const setUrgent = (on) => patchDraft({ urgent: on });

  // Przenosi szkic ze store do pól formularza (tylko gdy się różnią — bez skakania kursora).
  function syncDraft(s) {
    const d = s.draft;
    const ty = draftType(d, s.channel);
    if (els.text.value !== d.text) els.text.value = d.text;
    for (const b of els.types.querySelectorAll('button')) b.classList.toggle('on', b.dataset.ty === ty);
    els.text.placeholder = PLACEHOLDERS[ty];
    els.urgent.classList.toggle('on', d.urgent);
    els.urgent.setAttribute('aria-pressed', String(d.urgent));
    renderChips();
    renderWarn(s);
  }

  // Ostrzeżenia pod polem (nieblokujące): inna własna jednostka w treści rozkazu; nazwa spoza gazetera.
  function renderWarn(s) {
    const text = s.draft.text;
    const units = s.turn?.units ?? [];
    const parts = [];
    if (s.channel?.kind === 'subordinate' && !s.archive) {
      const others = foreignUnitMentions(text, s.channelUnit, units);
      if (others.length) {
        parts.push(`<div class="warn warn--unit">${ic('zap', 's')}<span>Treść wymienia ${others.map((u) => `„${e(u.name)}”`).join(', ')}, a adresatem jest ${e(s.channel.name)}. Czy to właściwy adresat?</span></div>`);
      }
    }
    if (s.channel && !s.archive) {
      const ctx = { places: s.places, units, contacts: s.turn?.contacts ?? [], assets: s.turn?.assets ?? [] };
      for (const p of unknownPlaceNames(text, ctx)) {
        parts.push(`<div class="warn warn--place">${ic('pin', 's')}<span>„${e(p.text)}” nie ma w gazeterze.</span><button type="button" class="sw" data-pin="${e(p.text)}">Wskaż na mapie</button></div>`);
      }
    }
    els.warn.innerHTML = parts.join('');
    els.warn.hidden = !parts.length;
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
    els.tplMenu.innerHTML = `<div class="cl-g cap">Szablony</div>` + TEMPLATE_MENU.map(([id, name]) => `<div class="cl-i" role="menuitem" tabindex="0" data-tpl="${id}">${ic('tpl', 's')}<span>${name}</span></div>`).join('');
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
    const item = ev.target.closest('[data-tpl]');
    if (!item) return;
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
    const text = els.text.value.trim();
    if (!text || !s.channel || s.archive) return;
    if (isTemplate(els.text.value)) {
      els.text.focus(); // szablon bez uzupełnienia nie jest rozkazem
      return;
    }
    els.send.disabled = true;
    thread.stickToBottom();
    const d = draft();
    const msg = await controller.sendMessage(text, d.attachIds, { type: type(), priority: d.urgent ? 'urgent' : 'normal', orders: draftOrders(d) });
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
  store.subscribe(['channel', 'visibleMessages', 'archive', 'currentTurn', 'scenario', 'turn', 'places', 'fresh'], (s) => {
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
  store.subscribe('ui', ({ ui }) => $('m-leader').classList.toggle('on', ui.leader), { immediate: true });
  store.subscribe('command', ({ command }) => {
    if (command?.name !== 'compose') return;
    if (command.arg?.type) setType(command.arg.type);
    els.text.focus();
  });
}
