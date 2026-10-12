// Wątek wiadomości kanału: karty (nadawca, rola, znaczniki, DTG, wzmianki, załączniki, stan doręczenia) i decyzja o przewijaniu.
import { escapeHtml as e } from '../../domain/markdown.js';
import { linkify } from '../../domain/linkify.js';
import { formatClock, formatDay, dayKey, formatDtgShort, formatGameTime, addMinutes } from '../../domain/format.js';
import { parseSender, messageTags } from '../../domain/messages.js';
import { symbolSvg } from '../../lib/symbols.js';
import { ic } from '../../lib/icons.js';
import { channelGlyph } from './glyphs.js';
import { attachmentKindLabel } from './orders.js';

// `box` — element wątku. Zwraca render(s), stickToBottom() (następne renderowanie zjedzie na dół) i attachment(klucz).
export function createThread({ box }) {
  const attachmentsById = new Map();
  let shownChannel = null; // kanał, którego wątek jest teraz wyrenderowany (do decyzji o przewijaniu)
  let forceBottom = false;

  function attachmentsHtml(m) {
    if (!m.attachments?.length) return '';
    return `<div>${m.attachments
      .map((a) => {
        const key = `${m.id}:${a.id}`;
        attachmentsById.set(key, a);
        return `<button type="button" class="att" data-attachment="${e(key)}" title="Pokaż na mapie">${ic('clip', 's')}${e(a.name)}<small>${e(attachmentKindLabel(a))}</small></button>`;
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

  return { render: renderThread, stickToBottom: () => { forceBottom = true; }, attachment: (key) => attachmentsById.get(key) };
}
