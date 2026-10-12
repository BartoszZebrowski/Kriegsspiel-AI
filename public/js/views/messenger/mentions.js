// Podpowiedzi @ (jednostki, kontakty, środki) i # (miejsca) w polu wiadomości.
import { escapeHtml as e } from '../../domain/markdown.js';
import { activeTrigger, mentionSuggestions, applySuggestion } from '../../domain/mentions.js';
import { symbolSvg } from '../../lib/symbols.js';
import { ic } from '../../lib/icons.js';

// `text` — pole tekstowe, `pop` — lista podpowiedzi; `onSend` — Ctrl+Enter.
export function createMentionPopup({ text, pop, S, patchDraft, onSend }) {
  let trig = null; // aktywne oznaczenie @ / # w polu tekstowym
  let suggestions = [];
  let sugIndex = 0;

  function closeMention() {
    trig = null;
    suggestions = [];
    pop.classList.remove('open');
  }

  function renderMention() {
    pop.innerHTML = suggestions
      .map((sg, i) => {
        const s = S();
        const sidc = sg.sidc;
        const glyph = sg.kind === 'place' ? ic('pin') : sidc ? symbolSvg(sidc, { size: 16 }).svg : '';
        return `<div class="cl-i${i === sugIndex ? ' sel' : ''}" role="option" aria-selected="${i === sugIndex}" data-sug="${i}"><span class="ch-ic">${glyph}</span><span>${e(sg.text)}</span><small>${e(sg.sub)}</small></div>`;
      })
      .join('');
    pop.classList.toggle('open', suggestions.length > 0);
  }

  function updateMention() {
    const s = S();
    trig = activeTrigger(text.value, text.selectionStart ?? 0);
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
    const caret = text.selectionStart ?? text.value.length;
    const res = applySuggestion(text.value, trig, caret, sg);
    text.value = res.text;
    text.setSelectionRange(res.caret, res.caret);
    patchDraft({ text: res.text });
    closeMention();
    text.focus();
  }

  text.addEventListener('input', () => {
    patchDraft({ text: text.value });
    sugIndex = 0;
    updateMention();
  });
  text.addEventListener('click', updateMention);
  text.addEventListener('blur', () => setTimeout(closeMention, 120));
  pop.addEventListener('mousedown', (ev) => {
    const item = ev.target.closest('[data-sug]');
    if (!item) return;
    ev.preventDefault();
    applyMention(+item.dataset.sug);
  });

  text.addEventListener('keydown', (ev) => {
    if (suggestions.length && pop.classList.contains('open')) {
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
      onSend();
    }
  });

  return { close: closeMention };
}
