// Widok: prawy dok, „Komunikator” — pasek przypiętych kanałów (+ popover „Wszystkie kanały”), nagłówek kanału,
// karty wiadomości (nadawca, rola, znaczniki, DTG i tura, wzmianki, załączniki, stan doręczenia)
// oraz komponowanie (rodzaj, „Pilne”, szablony, szkice, podpowiedzi @ i #).
// Renderuje ze store; wszystkie akcje zgłasza kontrolerowi.
import { escapeHtml as e } from '../domain/markdown.js';
import { linkify } from '../domain/linkify.js';
import { formatClock, formatDay, dayKey, formatDtgShort, formatGameTime, addMinutes } from '../domain/format.js';
import { parseSender, messageTags, tabLabel } from '../domain/messages.js';
import { draftType, foreignUnitMentions, unknownPlaceNames, channelListModel } from '../domain/compose.js';
import { channelUnitId } from '../domain/orbat.js';
import { activeTrigger, mentionSuggestions, applySuggestion } from '../domain/mentions.js';
import { symbolSvg } from '../lib/symbols.js';
import { ic } from '../lib/icons.js';

// Szablony wiadomości wg rodzaju (wstawiane przy wyborze rodzaju lub z menu „Szablon”).
export const TEMPLATES = {
  rozkaz: 'ROZKAZ BOJOWY nr \n1. Sytuacja:\n2. Zadanie:\n3. Zamiar:\n4. Współdziałanie:\n5. Zabezpieczenie:\n6. Dowodzenie i łączność:',
  zarzadzenie: 'ZARZĄDZENIE \nPodstawa:\nPolecam:\nTermin wykonania:',
  meldunek: 'MELDUNEK \nSytuacja:\nStan jednostek:\nZamiary:\nProszę o:',
  wiadomosc: '',
};
const PLACEHOLDERS = {
  rozkaz: 'Treść rozkazu… użyj @ aby wskazać jednostkę, # aby wskazać miejsce',
  zarzadzenie: 'Treść zarządzenia… (@ jednostka, # miejsce)',
  meldunek: 'Treść meldunku… (@ jednostka, # miejsce)',
  wiadomosc: 'Wiadomość… (@ jednostka, # miejsce)',
};
const TEMPLATE_MENU = [
  ['rozkaz', 'Rozkaz bojowy (5 punktów)'],
  ['zarzadzenie', 'Zarządzenie'],
  ['meldunek', 'Meldunek sytuacyjny'],
];
const isTemplate = (text) => Object.values(TEMPLATES).includes(text);

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
  const attachmentsById = new Map();
  let shownChannel = null; // kanał, którego wątek jest teraz wyrenderowany (do decyzji o przewijaniu)
  let forceBottom = false;
  let trig = null; // aktywne oznaczenie @ / # w polu tekstowym
  let suggestions = [];
  let sugIndex = 0;

  // ---------- ikony i awatary kanałów ----------
  const unitSidc = (s, unitId) => (s.turn?.units || []).find((u) => u.id === unitId)?.sidc;
  const roleIcon = (c) => (c.kind === 'recon' ? ic('radio', 's') : c.kind === 'logistics' ? ic('truck', 's') : null);

  function channelGlyph(s, c, size) {
    const sidc = unitSidc(s, channelUnitId(c));
    if (sidc && c.kind !== 'recon') return symbolSvg(sidc, { size }).svg;
    return roleIcon(c) || e(tabLabel(c).slice(0, 3));
  }

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

  // ---------- wątek ----------
  function attachmentsHtml(m) {
    if (!m.attachments?.length) return '';
    return `<div>${m.attachments
      .map((a) => {
        const key = `${m.id}:${a.id}`;
        attachmentsById.set(key, a);
        return `<button type="button" class="att" data-attachment="${e(key)}" title="Pokaż na mapie">${ic('clip', 's')}${e(a.name)}<small>${e(a.kind || 'szkic')}</small></button>`;
      })
      .join('')}</div>`;
  }

  // Ikona/symbol przy wzmiance: miniatura jednostki, pinezka miejsca.
  function decorateMentions(html, s) {
    const turn = s.turn || {};
    const sidcOf = (kind, id) => {
      const list = kind === 'unit' ? turn.units : kind === 'contact' ? turn.contacts : turn.assets;
      return (list || []).find((x) => x.id === id)?.sidc;
    };
    return html.replace(/(<button[^>]*data-mention-kind="(\w+)" data-mention-id="([^"]*)"[^>]*>)/g, (full, open, kind, id) => {
      const idRaw = id.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      if (kind === 'place') return open + ic('pin');
      const sidc = sidcOf(kind, idRaw);
      return sidc ? open + symbolSvg(sidc, { size: 14 }).svg.replace('<svg', '<svg class="ms"') : open;
    });
  }

  function messageHtml(m, s, ctx) {
    const out = m.direction === 'out';
    const tz = s.scenario.timezone;
    const ch = s.channel;
    const sender = out ? { name: 'Ty', role: '' } : parseSender(m.from);
    const urgentMsg = m.priority === 'urgent';
    const av = out ? 'TY' : channelGlyph(s, ch, 22);
    const tags = messageTags(m)
      .map((t) => `<span class="tag ${t.cls}">${t.label}</span>`)
      .join('');
    let foot = '';
    if (out) {
      const pending = m.turn === s.currentTurn && !s.archive;
      if (pending) {
        foot = `<div class="mf"><span class="wait">● W skrzynce</span><span>rozpatrzenie w turze ${m.turn + 1}</span><a role="button" tabindex="0" data-withdraw="${e(m.id)}">Wycofaj</a></div>`;
      } else {
        const next = addMinutes(s.scenario.start, (m.turn + 1) * s.scenario.turnMinutes);
        foot = `<div class="mf"><span class="ok">✓✓ Doręczono ${e(formatClock(next, tz))}</span><span>tura ${m.turn} rozstrzygnięta</span></div>`;
      }
    }
    const text = decorateMentions(linkify(m.text, ctx.link), s);
    return `<div class="msg${urgentMsg ? ' urgent' : ''}${out ? ' out' : ''}" data-id="${e(m.id)}"><div class="av">${av}</div><div class="mc">
      <div class="mh"><b>${e(sender.name || ch.name)}</b>${sender.role ? `<span class="role">${e(sender.role)}</span>` : ''}${tags}<time title="${e(formatGameTime(m.time, tz))}">${e(formatDtgShort(m.time, tz))} · T${m.turn}</time></div>
      <div class="mb">${text}</div>${attachmentsHtml(m)}${foot}</div></div>`;
  }

  function renderThread(s) {
    const box = els.thread;
    const ch = s.channel;
    if (!ch) {
      shownChannel = null;
      box.innerHTML = `<div class="insp-empty"><b>Wybierz kanał</b><span>Wybierz kartę kanału powyżej albo kanał z listy.</span></div>`;
      return;
    }
    const list = s.visibleMessages.filter((m) => m.channel === ch.id);
    const keepScroll = shownChannel === ch.id && !forceBottom && box.scrollHeight - box.scrollTop - box.clientHeight > 40;
    const top = box.scrollTop;
    if (!list.length) {
      box.innerHTML = `<div class="insp-empty">${ic('msg')}<b>Brak wiadomości</b><span>Napisz rozkaz lub meldunek do: ${e(ch.name)}.</span></div>`;
    } else {
      const ctx = { link: { places: s.places, units: s.turn?.units ?? [], contacts: s.turn?.contacts ?? [], assets: s.turn?.assets ?? [] } };
      const tz = s.scenario.timezone;
      let html = '';
      let day = null;
      let newShown = false;
      for (const m of list) {
        const dk = dayKey(m.time, tz);
        if (dk !== day) {
          day = dk;
          html += `<div class="day cap">${e(formatDay(m.time, tz))}</div>`;
        }
        if (!newShown && m.direction === 'in' && s.fresh.has(m.id)) {
          html += '<div class="day new cap">Nowe</div>';
          newShown = true;
        }
        html += messageHtml(m, s, ctx);
      }
      box.innerHTML = html;
    }
    // Nowy wątek albo gracz przy dole → na dół; w przeciwnym razie zostaje tam, gdzie czytał.
    box.scrollTop = keepScroll ? top : box.scrollHeight;
    shownChannel = ch.id;
    forceBottom = false;
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
    els.chips.innerHTML = ids
      .map((id) => {
        const n = notes.find((x) => x.id === id);
        return `<span class="att att--sel">${ic('clip', 's')}${e(n.name)}<a role="button" tabindex="0" data-unattach="${e(id)}" aria-label="Usuń załącznik">${ic('x', 's')}</a></span>`;
      })
      .join('');
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

  // ---------- podpowiedzi @ i # ----------
  function closeMention() {
    trig = null;
    suggestions = [];
    els.mention.classList.remove('open');
  }

  function renderMention() {
    els.mention.innerHTML = suggestions
      .map((sg, i) => {
        const s = S();
        const sidc = sg.sidc;
        const glyph = sg.kind === 'place' ? ic('pin') : sidc ? symbolSvg(sidc, { size: 16 }).svg : '';
        return `<div class="cl-i${i === sugIndex ? ' sel' : ''}" role="option" aria-selected="${i === sugIndex}" data-sug="${i}"><span class="ch-ic">${glyph}</span><span>${e(sg.text)}</span><small>${e(sg.sub)}</small></div>`;
      })
      .join('');
    els.mention.classList.toggle('open', suggestions.length > 0);
  }

  function updateMention() {
    const s = S();
    trig = activeTrigger(els.text.value, els.text.selectionStart ?? 0);
    if (!trig) return closeMention();
    suggestions = mentionSuggestions(trig.trigger, trig.query, {
      units: s.turn?.units ?? [],
      contacts: s.turn?.contacts ?? [],
      assets: s.turn?.assets ?? [],
      places: s.places,
    });
    sugIndex = Math.min(sugIndex, Math.max(0, suggestions.length - 1));
    if (!suggestions.length) return closeMention();
    renderMention();
  }

  function applyMention(i) {
    const sg = suggestions[i];
    if (!sg || !trig) return;
    const caret = els.text.selectionStart ?? els.text.value.length;
    const res = applySuggestion(els.text.value, trig, caret, sg);
    els.text.value = res.text;
    els.text.setSelectionRange(res.caret, res.caret);
    patchDraft({ text: res.text });
    closeMention();
    els.text.focus();
  }

  els.text.addEventListener('input', () => {
    patchDraft({ text: els.text.value });
    sugIndex = 0;
    updateMention();
  });
  els.text.addEventListener('click', updateMention);
  els.text.addEventListener('blur', () => setTimeout(closeMention, 120));
  els.mention.addEventListener('mousedown', (ev) => {
    const item = ev.target.closest('[data-sug]');
    if (!item) return;
    ev.preventDefault();
    applyMention(+item.dataset.sug);
  });

  els.text.addEventListener('keydown', (ev) => {
    if (suggestions.length && els.mention.classList.contains('open')) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        sugIndex = (sugIndex + (ev.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
        renderMention();
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        if (!(ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
          ev.preventDefault();
          applyMention(sugIndex);
          return;
        }
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeMention();
        return;
      }
    }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      send();
    }
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
    forceBottom = true;
    const d = draft();
    const msg = await controller.sendMessage(text, d.attachIds, { type: type(), priority: d.urgent ? 'urgent' : 'normal' });
    if (msg) closeMention(); // kontroler czyści szkic kanału, widok synchronizuje pola
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
      const a = attachmentsById.get(att.dataset.attachment);
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
    if (s.scenario) renderThread(s);
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
