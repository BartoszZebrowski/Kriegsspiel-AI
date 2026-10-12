// Formularze meldunków i rozkazów (T50) w komunikatorze: panel pól nad polem tekstu (komponowanie) i tabelka
// w wątku (wiadomości z `form`). Cały tekst użytkownika i sędziego przechodzi przez escapeHtml.
import { escapeHtml as e } from '../../domain/markdown.js';
import { formDef, formRows, shapeName } from '../../domain/forms.js';
import { ic } from '../../lib/icons.js';

// Tabelka wiadomości z formularzem (gracza albo postaci); '' gdy brak `form` lub nieznany rodzaj.
export function formTableHtml(form) {
  const def = formDef(form?.kind);
  if (!def) return '';
  const rows = formRows(form);
  return `<table class="form-tbl"><caption>${e(def.short)}</caption><tbody>${rows.map((r) => `<tr><th>${e(r.label)}</th><td>${e(r.value)}</td></tr>`).join('')}</tbody></table>`;
}

function fieldHtml(f, form) {
  const id = `ff-${f.id}`;
  const req = f.required ? '<i class="req" title="Pole wymagane">*</i>' : '';
  const label = `<label for="${id}">${e(f.label)}${req}</label>`;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" data-ff="${f.id}" rows="2" maxlength="1000" placeholder="${e(f.hint ?? '')}"></textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" data-ff="${f.id}"><option value="">—</option>${f.options.map((o) => `<option value="${e(o)}">${e(o)}</option>`).join('')}</select>`;
  else if (f.type === 'geo') {
    input = `<div class="ff-geo" id="${id}"><span class="ff-val" data-ff-geo="${f.id}"></span>${f.shapes.map((s) => `<button type="button" class="sw" data-ff-pick="${f.id}" data-shape="${s}" title="Wskaż na mapie: ${e(shapeName(s).toLowerCase())}">${ic('pin', 's')}${e(shapeName(s))}</button>`).join('')}</div>`;
  } else input = `<input id="${id}" data-ff="${f.id}" type="text" maxlength="1000" autocomplete="off" placeholder="${e(f.hint ?? '')}">`;
  return `<div class="ff ff--${f.type}" data-field="${f.id}">${label}${input}</div>`;
}

// Panel formularza kanału. `box` — element panelu; zwraca render(state). Bez przebudowy przy pisaniu (fokus zostaje).
export function createFormPanel({ box, S, controller }) {
  let shown = null; // `${kanał}|${rodzaj}` aktualnie zbudowanego panelu

  const channelId = () => S().activeChannel;

  function build(form) {
    const def = formDef(form.kind);
    box.innerHTML = `<div class="ff-head"><b>${e(def.name)}</b><span class="ff-miss" data-ff-miss></span><a role="button" tabindex="0" data-ff-close aria-label="Zamknij formularz" title="Zamknij formularz (wróć do wolnego tekstu)">${ic('x', 's')}</a></div><div class="ff-grid">${def.fields.map((f) => fieldHtml(f, form)).join('')}</div>`;
  }

  function sync(form) {
    const def = formDef(form.kind);
    const pick = S().ccirEditor.pick;
    for (const f of def.fields) {
      const v = form.fields?.[f.id];
      if (f.type === 'geo') {
        const el = box.querySelector(`[data-ff-geo="${f.id}"]`);
        const txt = formRows({ kind: form.kind, fields: { [f.id]: v } })[0]?.value ?? 'nie wskazano';
        if (el.textContent !== txt) el.textContent = txt;
        el.classList.toggle('empty', v === undefined);
        for (const b of box.querySelectorAll(`[data-ff-pick="${f.id}"]`)) b.classList.toggle('on', pick?.target === 'form' && pick.id === f.id && pick.shape === b.dataset.shape);
      } else {
        const el = box.querySelector(`[data-ff="${f.id}"]`);
        const want = v === undefined ? '' : String(v);
        if (el.value !== want && el !== document.activeElement) el.value = want;
      }
    }
    const miss = def.fields.filter((f) => f.required && (form.fields?.[f.id] === undefined || String(form.fields[f.id]).trim() === '')).length;
    const m = box.querySelector('[data-ff-miss]');
    m.textContent = miss ? `brak wymaganych: ${miss}` : 'komplet';
    m.classList.toggle('ok', !miss);
  }

  function render(s) {
    const form = s.channel && !s.archive ? (s.drafts[s.channel.id]?.form ?? null) : null;
    box.hidden = !form;
    if (!form) {
      shown = null;
      box.innerHTML = '';
      return;
    }
    const key = `${s.channel.id}|${form.kind}`;
    if (key !== shown) {
      build(form);
      shown = key;
    }
    sync(form);
  }

  box.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-ff]');
    if (el) controller.formSetField(channelId(), el.dataset.ff, el.value);
  });
  box.addEventListener('click', (ev) => {
    const pick = ev.target.closest('[data-ff-pick]');
    if (pick) {
      controller.formPickStart(channelId(), pick.dataset.ffPick, pick.dataset.shape);
      if (S().ccirEditor.pick?.target === 'form') controller.notify('Wskaż na mapie (Esc anuluje; linia i rejon: dwuklik lub Enter zatwierdza)');
      return;
    }
    if (ev.target.closest('[data-ff-close]')) controller.formClear(channelId());
  });

  return { render };
}
