// Okno edycji rysunku (nazwa, opis, kolor, rodzaj znaku, symbol hipotezy). Zapis zleca przez `persist`.
import { symbolSvg } from '../../lib/symbols.js';
import { FUNCTIONS, ECHELONS, describeSidc } from '../../domain/sidc.js';
import { escapeHtml } from '../../domain/markdown.js';
import { GRAPHICS, ECHELON_MARKS, graphicInfo, autoName } from '../../domain/tactical.js';
import { KIND_NAMES, LEGACY_GRAPHIC, DEFAULT_NAMES, hypothesisSidc, graphicPreviewSvg, countOf } from './graphics.js';

export function createNoteEditor({ byId, getItems, persist }) {
  const dialogEls = {
    dialog: byId('note-dialog'),
    form: byId('note-form'),
    title: byId('note-title'),
    name: byId('note-name'),
    desc: byId('note-desc'),
    colorBox: byId('note-color-box'),
    symbolBox: byId('note-symbol-box'),
    affiliation: byId('note-affiliation'),
    fn: byId('note-fn'),
    echelon: byId('note-echelon'),
    preview: byId('note-preview'),
    previewDesc: byId('note-preview-desc'),
    remove: byId('note-remove'),
    cancel: byId('note-cancel'),
  };
  const d = dialogEls;
  const fnOptions = Object.entries(FUNCTIONS)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)
    .join('');
  d.fn.innerHTML = fnOptions;
  d.echelon.innerHTML =
    '<option value="-">— bez wielkości —</option>' +
    Object.entries(ECHELONS)
      .filter(([k]) => 'DEFGHIJ'.includes(k))
      .map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)
      .join('');
  let draft = null;
  let draftIsNew = false;

  function symbolFromForm() {
    return hypothesisSidc(d.affiliation.value, d.fn.value, d.echelon.value);
  }
  function updatePreview() {
    if (draft?.kind !== 'symbol') return;
    const sidc = symbolFromForm();
    d.preview.innerHTML = symbolSvg(sidc, { size: 36, uniqueDesignation: d.name.value || '' }).svg;
    d.previewDesc.textContent = describeSidc(sidc);
  }
  for (const el of [d.affiliation, d.fn, d.echelon, d.name]) el.addEventListener('input', updatePreview);

  // Rodzaj znaku taktycznego (graphic), szczebel granicy, strona znaku + podgląd.
  const g$ = (id) => d.form.querySelector('#' + id);
  const gx = { box: g$('note-graphic-box'), select: g$('note-graphic'), ech: g$('note-gechelon'), echBox: g$('note-gechelon-box'), flip: g$('note-flip'), flipBox: g$('note-flip-box'), preview: g$('note-gfx-preview'), hint: g$('note-gfx-hint') };
  gx.ech.innerHTML =
    '<option value="">— bez oznaczenia —</option>' +
    Object.entries(ECHELON_MARKS)
      .map(([k, m]) => `<option value="${k}">${escapeHtml(m)} · ${escapeHtml(ECHELONS[k])}</option>`)
      .join('');
  let nameTouched = false;
  const colorValue = () => d.form.querySelector('input[name=color]:checked')?.value || 'black';
  d.name.addEventListener('input', () => {
    nameTouched = true;
  });

  function refreshGraphicUi() {
    if (!draft || gx.box.hidden) return;
    const gid = gx.select.value;
    gx.echBox.hidden = gid !== 'boundary';
    gx.flipBox.hidden = !['flot', 'obstacle_line'].includes(gid);
    const info = graphicInfo(draft.kind, gid);
    gx.hint.textContent = info?.hint || '';
    gx.preview.innerHTML = graphicPreviewSvg(draft.kind, gid, colorValue(), { name: d.name.value || 'Nazwa', echelon: gx.ech.value || undefined, flip: gx.flip.checked });
  }
  function autoRename() {
    if (!draft || nameTouched || gx.box.hidden) return;
    d.name.value = autoName(draft.kind, gx.select.value, colorValue(), countOf(getItems(), draft.kind, gx.select.value) + 1);
  }
  gx.select.addEventListener('change', () => {
    autoRename();
    refreshGraphicUi();
  });
  d.form.addEventListener('change', (e) => {
    if (e.target.name === 'color') {
      autoRename();
      refreshGraphicUi();
    }
  });
  for (const el of [gx.ech, gx.flip, d.name]) el.addEventListener('input', refreshGraphicUi);

  // Dwuetapowe usuwanie w oknie (bez natywnego confirm()).
  let removeTimer = null;
  function disarmRemove() {
    clearTimeout(removeTimer);
    removeTimer = null;
    d.remove.textContent = 'Usuń';
    d.remove.classList.remove('dng');
  }

  function openEditor(note, isNew) {
    draft = { ...note };
    draftIsNew = isNew;
    disarmRemove();
    d.title.textContent = (isNew ? 'Nowy: ' : 'Edycja: ') + KIND_NAMES[note.kind];
    d.name.value = note.name;
    nameTouched = !isNew;
    d.desc.value = note.description || '';
    for (const r of d.form.querySelectorAll('input[name=color]')) r.checked = r.value === (note.color || 'black');
    d.symbolBox.hidden = note.kind !== 'symbol';
    d.colorBox.hidden = note.kind === 'symbol';
    d.remove.hidden = isNew;
    gx.box.hidden = note.kind === 'symbol';
    if (note.kind !== 'symbol') {
      gx.select.innerHTML = GRAPHICS[note.kind].map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
      gx.select.value = note.graphic || LEGACY_GRAPHIC[note.kind];
      gx.ech.value = note.echelon || '';
      gx.flip.checked = !!note.flip;
      refreshGraphicUi();
    }
    if (note.kind === 'symbol') {
      const s = note.sidc;
      d.affiliation.value = s[1];
      const fnCode = s.slice(4, 10).replace(/-+$/, '');
      const key = `${s[2]}:${fnCode}`;
      d.fn.value = key in FUNCTIONS ? key : 'G:UCI';
      d.echelon.value = s[11] in ECHELONS ? s[11] : '-';
      updatePreview();
    }
    d.dialog.showModal();
    d.name.select();
  }

  d.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!draft) return;
    const note = {
      ...draft,
      name: d.name.value.trim() || DEFAULT_NAMES[draft.kind],
      description: d.desc.value.trim() || undefined,
      color: draft.kind === 'symbol' ? (d.affiliation.value === 'F' ? 'blue' : 'red') : d.form.querySelector('input[name=color]:checked')?.value || 'black',
    };
    if (note.kind === 'symbol') note.sidc = symbolFromForm();
    else {
      note.graphic = gx.select.value;
      if (note.graphic === 'boundary' && gx.ech.value) note.echelon = gx.ech.value;
      else delete note.echelon;
      if (['flot', 'obstacle_line'].includes(note.graphic) && gx.flip.checked) note.flip = true;
      else delete note.flip;
    }
    const next = draftIsNew ? [...getItems(), note] : getItems().map((i) => (i.id === note.id ? note : i));
    d.dialog.close();
    await persist(next);
  });
  d.cancel.addEventListener('click', () => d.dialog.close());
  d.remove.addEventListener('click', async () => {
    if (!removeTimer) {
      d.remove.textContent = 'Na pewno usunąć?';
      d.remove.classList.add('dng');
      removeTimer = setTimeout(disarmRemove, 4000);
      return;
    }
    disarmRemove();
    const id = draft?.id;
    d.dialog.close();
    if (id) await persist(getItems().filter((i) => i.id !== id));
  });

  return { open: openEditor };
}
