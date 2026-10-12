// Widok: szkice gracza na mapie (strzałki, linie, rejony, punkty, własne symbole NATO) i miarka.
// Szkice czyta ze store.notes, zapisuje przez controller.saveNotes; stan edycji i narzędzi jest lokalny.
/* global L */
import { symbolIcon, symbolSvg } from '../lib/symbols.js';
import { FUNCTIONS, ECHELONS, describeSidc } from '../domain/sidc.js';
import { escapeHtml } from '../domain/markdown.js';
import { arrowHead, pathLengthKm, marchTable, formatKm, formatMarch, toLatLng } from '../domain/geo.js';
import { GRAPHICS, ECHELON_MARKS, defaultGraphic, graphicInfo, autoName, buildGraphic, mainStyle, pointIconSvg } from '../domain/tactical.js';
import { ic } from '../lib/icons.js';

export const COLORS = { blue: '#2f7bff', red: '#ff2a2a', black: '#111111' };
const COLOR_NAMES = { blue: 'własne', red: 'przeciwnik', black: 'ogólne' };
const KIND_NAMES = { arrow: 'Oś / kierunek', line: 'Linia', area: 'Rejon', point: 'Punkt', symbol: 'Symbol (hipoteza)' };
// Rodzaj znaku dla rysunków sprzed T12.2 (bez pola graphic) — tak są pokazywane w oknie edycji.
const LEGACY_GRAPHIC = { arrow: 'direction', line: 'line', area: 'generic', point: 'point' };
// Paleta narzędzi (pionowa szyna): id, ikona, nazwa, skrót klawiszowy. `extra` — chowane na telefonie.
const TOOLS = [
  { id: 'select', icon: 'cursor', title: 'Wybieraj', key: 'V' },
  { sep: true },
  { id: 'arrow', icon: 'arrow', title: 'Strzałka — oś / kierunek natarcia', key: 'A' },
  { id: 'line', icon: 'line', title: 'Linia — rubież, granica, FLOT, zapory', key: 'L' },
  { id: 'area', icon: 'poly', title: 'Rejon (wielokąt) — AA, OBJ, EA, BP, pole minowe', key: 'R' },
  { id: 'point', icon: 'point', title: 'Punkt — CP, styczność, cel', key: 'P', extra: true },
  { id: 'symbol', icon: 'sym', title: 'Symbol (hipoteza) — własny symbol NATO', key: 'Y', extra: true },
  { id: 'gfx', icon: 'flag', title: 'Znaki taktyczne NATO', key: 'G', flyout: true },
  { sep: true },
  { id: 'measure', icon: 'ruler', title: 'Miarka — odległość i czas marszu', key: 'M' },
];
const HINTS = {
  arrow: 'Oś / kierunek: klikaj kolejne punkty, dwuklik kończy. Esc — anuluj.',
  line: 'Linia: klikaj kolejne punkty, dwuklik kończy. Esc — anuluj.',
  area: 'Rejon: klikaj wierzchołki, kliknięcie pierwszego zamyka. Esc — anuluj.',
  point: 'Punkt: kliknij miejsce na mapie.',
  symbol: 'Symbol: kliknij miejsce na mapie, potem wybierz rodzaj.',
  measure: 'Miarka: klikaj punkty trasy, dwuklik lub Esc kończy.',
};
const DEFAULT_NAMES = { arrow: 'Kierunek', line: 'Linia', area: 'Rejon', point: 'Punkt', symbol: 'Hipoteza' };

const uid = () => 'n-' + Math.random().toString(36).slice(2, 10);

// SIDC hipotezy: status „A” (przewidywany) daje ramkę przerywaną.
export function hypothesisSidc(affiliation, fnKey, echelon) {
  const [dim, code] = fnKey.split(':');
  const fn = code.padEnd(6, '-');
  return `S${affiliation}${dim}A${fn}-${dim === 'G' ? echelon || '-' : '-'}---`;
}

// Podgląd znaku w oknie edycji: ten sam opis co na mapie (buildGraphic), narysowany jako SVG na przykładowej ścieżce.
const SAMPLE = {
  arrow: [{ x: 14, y: 46 }, { x: 80, y: 34 }, { x: 118, y: 36 }, { x: 176, y: 16 }],
  line: [{ x: 14, y: 44 }, { x: 70, y: 22 }, { x: 120, y: 38 }, { x: 176, y: 18 }],
  area: [{ x: 36, y: 50 }, { x: 28, y: 22 }, { x: 90, y: 10 }, { x: 150, y: 18 }, { x: 160, y: 48 }],
};
export function graphicPreviewSvg(kind, graphic, colorKey, opts = {}) {
  const W = 190;
  const H = 64;
  const color = COLORS[colorKey] || COLORS.black;
  const enemy = colorKey === 'red';
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  if (kind === 'point') {
    const icon = pointIconSvg(graphic, color).replace('<svg ', `<svg x="${W / 2 - 14}" y="${H / 2 - 14}" `);
    return svg(icon);
  }
  const pts = SAMPLE[kind];
  const d = (arr, close) => 'M' + arr.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + (close ? 'Z' : '');
  const built = buildGraphic(kind, graphic, pts, { enemy, flip: opts.flip, echelon: opts.echelon, name: opts.name || '' });
  const st = mainStyle(kind, graphic, enemy);
  let out = '';
  if (kind === 'area') out += `<path d="${d(pts, true)}" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="${st.weight}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
  else if (!st.hidden) out += `<path d="${d(pts)}" fill="none" stroke="${color}" stroke-width="${st.weight}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
  for (const s of built.shapes) {
    const path = s.parts.map((p) => d(p, s.closed || s.role === 'fill')).join('');
    if (s.role === 'fill') out += `<path d="${path}" fill="${color}" fill-opacity="${s.fillOpacity}"/>`;
    else out += `<path d="${path}" fill="${s.solid ? color : 'none'}" stroke="${color}" stroke-width="${s.weight}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
  }
  for (const lb of built.labels) {
    const dy = lb.anchor === 'above' ? -8 : lb.anchor === 'below' ? 14 : 4;
    const lines = lb.text.split(/\n/);
    const tsp = lines.map((t, i) => `<tspan x="${lb.x.toFixed(1)}" dy="${i === 0 ? dy - (lines.length - 1) * 6 : 12}">${escapeHtml(t)}</tspan>`).join('');
    out += `<text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" font-family="Segoe UI,Arial,sans-serif" fill="${color}" stroke="#fff" stroke-width="2.5" paint-order="stroke" transform="rotate(${lb.angle} ${lb.x.toFixed(1)} ${lb.y.toFixed(1)})">${tsp}</text>`;
  }
  return svg(out);
}

export function createDrawView({ store, controller, surface, root = document }) {
  const map = surface.map;
  const toast = (text) => controller.notify(text);
  const byId = (id) => root.getElementById(id);
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
  const layer = L.layerGroup().addTo(map);
  const measureLayer = L.layerGroup().addTo(map);
  let items = [];
  let turn = 0;
  let readOnly = true;
  let editing = null; // { id, layer }
  let tool = null;
  let tempHighlight = null;
  let presetGraphic = null; // znak wybrany z flyoutu (null = domyślny dla narzędzia)

  map.pm?.setLang?.('pl');
  map.pm?.setGlobalOptions?.({ templineStyle: { color: '#ffd54a' }, hintlineStyle: { color: '#ffd54a', dashArray: '5 5' } });

  // ---------- Paleta narzędzi (pływająca szyna z lewej) ----------
  const barEl = byId('rail');
  const flyoutEl = byId('flyout');
  barEl.innerHTML =
    TOOLS.map((tl) =>
      tl.sep
        ? '<div class="sep"></div>'
        : `<button type="button" class="tool${tl.extra ? ' t-extra' : ''}" data-tool="${tl.id}" data-tip="${escapeHtml(tl.title)}" data-k="${tl.key}" data-pos="r" aria-label="${escapeHtml(tl.title)}">${ic(tl.icon)}${tl.flyout ? '<span class="fl"></span>' : ''}</button>`,
    ).join('') +
    `<button type="button" class="tool draw-bar__finish" data-tool="finish" data-tip="Zakończ edycję kształtu" data-k="Enter" data-pos="r" hidden aria-label="Zakończ edycję kształtu">${ic('check')}</button>
     <button type="button" class="tool" data-tool="clear-measure" data-tip="Wyczyść pomiar" data-pos="r" hidden aria-label="Wyczyść pomiar">${ic('x')}</button>`;
  barEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tool]');
    if (btn && !btn.disabled) onTool(btn.dataset.tool);
  });

  // Flyout znaków taktycznych NATO: wybór znaku zaczyna rysowanie odpowiedniego rodzaju geometrii.
  const GFX_KIND_NAMES = { arrow: 'Osie i kierunki', line: 'Linie', area: 'Rejony', point: 'Punkty' };
  flyoutEl.innerHTML = Object.entries(GFX_KIND_NAMES)
    .map(
      ([kind, title]) =>
        `<div class="cl-g cap">${title}</div>${GRAPHICS[kind]
          .map((g) => `<div class="cl-i" role="menuitem" tabindex="0" data-gfx-kind="${kind}" data-gfx="${g.id}"><span class="ch-ic">${ic(kind === 'area' ? 'poly' : kind === 'point' ? 'point' : kind === 'arrow' ? 'arrow' : 'line', 's')}</span><span>${escapeHtml(g.name)}</span></div>`)
          .join('')}`,
    )
    .join('');
  let flyoutOpen = false;
  function setFlyout(on) {
    flyoutOpen = on && !readOnly;
    flyoutEl.classList.toggle('open', flyoutOpen);
    barEl.querySelector('[data-tool="gfx"]')?.classList.toggle('on', flyoutOpen || (tool && presetGraphic !== null));
  }
  flyoutEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-gfx]');
    if (!item) return;
    setFlyout(false);
    startDraw(item.dataset.gfxKind, item.dataset.gfx);
  });
  flyoutEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.target.closest('[data-gfx]')?.click();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (flyoutOpen && !e.target.closest('#flyout, [data-tool="gfx"]')) setFlyout(false);
  });

  function updateToolbar() {
    for (const b of barEl.querySelectorAll('[data-tool]')) {
      const id = b.dataset.tool;
      if (id === 'finish') b.hidden = !editing;
      else if (id === 'clear-measure') b.hidden = measureLayer.getLayers().length === 0;
      else if (id === 'measure') b.classList.toggle('on', tool === 'measure');
      else if (id === 'select') b.classList.toggle('on', !tool);
      else if (id === 'gfx') {
        b.disabled = readOnly;
        b.classList.toggle('on', flyoutOpen || (tool && presetGraphic !== null));
      } else {
        b.disabled = readOnly;
        b.classList.toggle('on', tool === id && presetGraphic === null);
      }
    }
    barEl.title = readOnly ? 'Archiwum — szkice tylko do podglądu (miarka działa)' : '';
  }

  // Grot strzałki widoczny już podczas rysowania: od ostatniego postawionego punktu do kursora.
  let drawingLayer = null;
  let drawHead = null;
  const clearDrawHead = () => {
    if (drawHead) map.removeLayer(drawHead);
    drawHead = null;
    drawingLayer = null;
  };
  map.on('pm:drawstart', (ev) => {
    drawingLayer = ev.workingLayer || null;
  });
  map.on('mousemove', (ev) => {
    if (tool !== 'arrow' || !drawingLayer) return;
    const placed = [].concat(drawingLayer.getLatLngs?.() ?? []).flat();
    const cursor = map.latLngToLayerPoint(ev.latlng);
    const from = [...placed].reverse().find((ll) => map.latLngToLayerPoint(ll).distanceTo(cursor) > 4);
    if (!from) return drawHead?.setLatLngs([]);
    const head = headLatLngs([from, ev.latlng]);
    if (drawHead) drawHead.setLatLngs(head);
    else drawHead = L.polyline(head, { color: '#ffd54a', weight: 3, interactive: false }).addTo(map);
  });

  function stopTool() {
    if (tool && tool !== 'measure') {
      map.pm?.disableDraw();
      map.getContainer().classList.remove('is-drawing');
      setTimeout(() => map.doubleClickZoom.enable(), 0);
    }
    if (tool === 'measure') endMeasure();
    clearDrawHead();
    tool = null;
    presetGraphic = null;
    updateToolbar();
  }

  function onTool(id, graphic = null) {
    if (id === 'finish') return finishShapeEdit();
    if (id === 'gfx') return setFlyout(!flyoutOpen);
    setFlyout(false);
    if (id === 'select') {
      stopTool();
      return;
    }
    if (id === 'clear-measure') {
      measureLayer.clearLayers();
      measureBox.hide();
      return updateToolbar();
    }
    const was = tool;
    stopTool();
    if (was === id) return;
    if (id === 'measure') return startMeasure();
    if (readOnly) return;
    tool = id;
    presetGraphic = graphic;
    const shape = { arrow: 'Line', line: 'Line', area: 'Polygon', point: 'Marker', symbol: 'Marker' }[id];
    map.pm.enableDraw(shape, {
      markerStyle: { icon: L.divIcon({ className: 'draw-cursor', iconSize: [12, 12] }) },
      pathOptions: { color: '#ffd54a' },
      continueDrawing: false,
      finishOn: shape === 'Line' ? 'dblclick' : null,
    });
    if (shape === 'Line') map.doubleClickZoom.disable();
    map.getContainer().classList.add('is-drawing');
    toast(HINTS[id]);
    updateToolbar();
  }
  // Rysowanie z konkretnym znakiem taktycznym (z flyoutu): to samo narzędzie, ale z predefiniowanym rodzajem znaku.
  function startDraw(kind, graphic) {
    if (readOnly) return;
    stopTool();
    onTool(kind, graphic);
  }

  map.on('pm:create', (e) => {
    const kind = tool;
    const preset = presetGraphic;
    map.removeLayer(e.layer);
    stopTool();
    if (!kind) return;
    const geometry = e.layer.toGeoJSON().geometry;
    const graphic = preset || defaultGraphic(kind);
    const color = kind === 'symbol' ? 'red' : 'blue';
    const name = autoName(kind, graphic, color, countOf(kind, graphic) + 1);
    openEditor({ id: uid(), kind, graphic, name, color, geometry, sidc: kind === 'symbol' ? hypothesisSidc('H', 'G:UCAT', 'E') : undefined }, true);
  });

  const countOf = (kind, graphic) => items.filter((i) => i.kind === kind && (i.graphic || LEGACY_GRAPHIC[kind]) === graphic).length;

  // ---------- Okno edycji rysunku ----------
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
    d.name.value = autoName(draft.kind, gx.select.value, colorValue(), countOf(draft.kind, gx.select.value) + 1);
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
    const next = draftIsNew ? [...items, note] : items.map((i) => (i.id === note.id ? note : i));
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
    if (id) await persist(items.filter((i) => i.id !== id));
  });

  // Zapis idzie przez kontroler; nowa lista wraca przez store.notes (subskrypcja `sync` poniżej).
  // Gdy zapis się nie uda, rysunek wraca do ostatniego zapisanego stanu.
  async function persist(next) {
    if (!(await controller.saveNotes(next))) render();
  }

  // ---------- Rysowanie elementów ----------
  const arrowHeads = []; // strzałki klasyczne (bez graphic)
  const tips = []; // strzałki-znaki: { line, out } do diagnostyki
  const decors = new Set(); // funkcje przerysowujące dekoracje znaków

  function headLatLngs(latlngs) {
    if (latlngs.length < 2) return [];
    const a = map.latLngToLayerPoint(latlngs.at(-2));
    const b = map.latLngToLayerPoint(latlngs.at(-1));
    return arrowHead(a, b, 18, 14).map((p) => map.layerPointToLatLng(L.point(p.x, p.y)));
  }

  // Dekoracje i etykiety liczone w pikselach — przeliczane po zoomie i podczas edycji.
  function redrawAll() {
    for (const { line, head } of arrowHeads) head.setLatLngs(headLatLngs(line.getLatLngs()));
    for (const fn of decors) fn();
  }
  map.on('zoomend', redrawAll);

  const toPx = (latlngs) =>
    latlngs.map((ll) => {
      const p = map.latLngToLayerPoint(ll);
      return { x: p.x, y: p.y };
    });
  const toLL = (p) => map.layerPointToLatLng(L.point(p.x, p.y));

  function popupHtml(note) {
    const actions = readOnly
      ? ''
      : `<div class="card__actions">
          <button class="btn sm" data-note-edit="${note.id}">Opis</button>
          <button class="btn sm" data-note-shape="${note.id}">${note.kind === 'point' || note.kind === 'symbol' ? 'Przesuń' : 'Kształt'}</button>
          <button class="btn sm" data-note-del="${note.id}">Usuń</button></div>
        <div class="card__actions card__confirm" hidden>
          <span class="confirm-q">Na pewno usunąć?</span>
          <button class="btn sm dng" data-note-del-yes="${note.id}">Tak, usuń</button>
          <button class="btn sm" data-note-del-no>Anuluj</button></div>`;
    let extra = '';
    if (note.kind === 'arrow' || note.kind === 'line') {
      const km = pathLengthKm(note.geometry.coordinates);
      extra = `<dt>Długość</dt><dd>${formatKm(km)}</dd>`;
    }
    const typeName = graphicInfo(note.kind, note.graphic)?.name || KIND_NAMES[note.kind];
    return `<div class="card"><h4>${escapeHtml(note.name)}</h4>
      <div class="card__type">${escapeHtml(typeName)}${note.kind === 'symbol' ? ' · ' + escapeHtml(describeSidc(note.sidc)) : ' · ' + COLOR_NAMES[note.color || 'black']}</div>
      <dl>${note.description ? `<dt>Opis</dt><dd>${escapeHtml(note.description)}</dd>` : ''}${extra}</dl>${actions}</div>`;
  }

  const layersById = new Map();

  // Wzór kreskowania (SVG pattern) dla rejonów własnych — wstawiany do renderera SVG mapy.
  function ensureHatch(lyr) {
    const svg = map.getRenderer(lyr)?._container;
    if (!svg || svg.tagName.toLowerCase() !== 'svg' || svg.querySelector('#ks-hatch-blue')) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = ['blue', 'black']
      .map(
        (k) => `<pattern id="ks-hatch-${k}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="${COLORS[k]}" fill-opacity=".08"/>
          <line x1="0" y1="0" x2="0" y2="8" stroke="${COLORS[k]}" stroke-width="1.6" stroke-opacity=".55"/></pattern>`,
      )
      .join('');
    svg.prepend(defs);
  }

  // Znak taktyczny: warstwa główna (edytowalna) + dekoracje i etykiety w osobnych warstwach.
  function decorate(note, main, getLatLngs) {
    const color = COLORS[note.color] || COLORS.black;
    const group = L.featureGroup([main]);
    const out = {};
    let extra = [];
    const rebuild = () => {
      for (const l of extra) group.removeLayer(l);
      extra = [];
      const built = buildGraphic(note.kind, note.graphic, toPx(getLatLngs()), { enemy: note.color === 'red', flip: !!note.flip, echelon: note.echelon, name: note.name });
      out.tip = built.tip;
      const add = (l) => {
        group.addLayer(l);
        extra.push(l);
      };
      for (const s of built.shapes) {
        if (!s.parts.length) continue;
        const base = { interactive: false, color, weight: s.weight, dashArray: s.dash, lineJoin: 'round' };
        if (s.role === 'fill') add(L.polygon(s.parts[0].map(toLL), { interactive: false, stroke: false, fillColor: color, fillOpacity: s.fillOpacity }));
        else if (s.closed) add(L.polygon(s.parts.map((p) => [p.map(toLL)]), { ...base, fill: !!s.solid, fillColor: color, fillOpacity: 1 }));
        else add(L.polyline(s.parts.map((p) => p.map(toLL)), { ...base, fill: false }));
      }
      for (const lb of built.labels) {
        const html = `<span class="tac-label tac-label--${lb.cls} tac-label--${lb.anchor}" style="color:${color};--a:${lb.angle}deg">${escapeHtml(lb.text).replace(/\n/g, '<br>')}</span>`;
        add(L.marker(toLL(lb), { icon: L.divIcon({ className: 'tac-lbl', html, iconSize: [0, 0] }), interactive: false, keyboard: false }));
      }
    };
    decors.add(rebuild);
    main.on('pm:markerdrag pm:drag pm:edit pm:vertexadded pm:vertexremoved pm:dragend', rebuild);
    rebuild();
    if (note.kind === 'arrow') tips.push({ line: main, out });
    return group;
  }

  function noteLayer(note) {
    const color = COLORS[note.color] || COLORS.black;
    const enemy = note.color === 'red';
    const g = note.geometry;
    const label = (lyr, dir = 'center') =>
      lyr.bindTooltip(escapeHtml(note.name), { permanent: true, direction: dir, className: `note-label note-label--${note.color || 'black'}` });
    if (note.kind === 'arrow' || note.kind === 'line') {
      if (note.graphic) {
        const st = mainStyle(note.kind, note.graphic, enemy);
        const line = L.polyline(g.coordinates.map(toLatLng), st.hidden ? { color, weight: st.weight, opacity: 0 } : { color, weight: st.weight, dashArray: st.dash });
        line.hiddenMain = !!st.hidden;
        return decorate(note, line, () => line.getLatLngs());
      }
      const line = L.polyline(g.coordinates.map(toLatLng), { color, weight: 3.5 });
      label(line);
      if (note.kind === 'arrow') {
        const head = L.polygon(headLatLngs(line.getLatLngs()), { color, weight: 1, fillColor: color, fillOpacity: 1, interactive: false });
        arrowHeads.push({ line, head });
        // Grot podąża za linią podczas edycji wierzchołków i przeciągania całości.
        const follow = () => head.setLatLngs(headLatLngs(line.getLatLngs()));
        line.on('pm:markerdrag pm:drag pm:edit pm:vertexadded pm:vertexremoved pm:dragend', follow);
        return L.featureGroup([line, head]);
      }
      return line;
    }
    if (note.kind === 'area') {
      const rings = g.coordinates.map((ring) => ring.slice(0, -1).map(toLatLng));
      if (!note.graphic) {
        const poly = L.polygon(rings, { color, weight: 2.5, fillOpacity: 0.12 });
        label(poly);
        return poly;
      }
      const st = mainStyle('area', note.graphic, enemy);
      const poly = L.polygon(rings, { color, weight: st.weight, dashArray: st.dash, fillColor: color, fillOpacity: enemy ? 0.06 : 0.12 });
      if (!enemy) {
        ensureHatch(poly);
        poly.setStyle({ fillColor: `url(#ks-hatch-${note.color === 'blue' ? 'blue' : 'black'})`, fillOpacity: 1 });
      }
      return decorate(note, poly, () => poly.getLatLngs()[0]);
    }
    if (note.kind === 'point') {
      if (note.graphic && note.graphic !== 'point') {
        const m = L.marker(toLatLng(g.coordinates), {
          icon: L.divIcon({ className: 'tac-icon', html: pointIconSvg(note.graphic, color), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }),
        });
        label(m, 'right');
        m.getTooltip().options.offset = [14, 0];
        return m;
      }
      const m = L.circleMarker(toLatLng(g.coordinates), { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
      label(m, 'right');
      return m;
    }
    return L.marker(toLatLng(g.coordinates), {
      icon: symbolIcon(note.sidc, { size: 26, uniqueDesignation: note.name, additionalInformation: 'hipoteza' }),
    });
  }

  function render() {
    layer.clearLayers();
    layersById.clear();
    arrowHeads.length = 0;
    tips.length = 0;
    decors.clear();
    for (const note of items) {
      const lyr = noteLayer(note);
      editableOf(lyr).bindPopup(() => popupHtml(note), { maxWidth: 300 });
      lyr.addTo(layer);
      layersById.set(note.id, lyr);
    }
    updateToolbar();
  }

  // Przyciski w oknie popupu. Usuwanie dwuetapowe — bez natywnego confirm() (bywa wyciszony w osadzonej przeglądarce).
  function wirePopup(popup) {
    const root = popup.getElement();
    if (!root) return;
    const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);
    on('[data-note-edit]', (ev) => {
      map.closePopup();
      const note = items.find((i) => i.id === ev.currentTarget.dataset.noteEdit);
      if (note) openEditor(note, false);
    });
    on('[data-note-shape]', (ev) => {
      map.closePopup();
      startShapeEdit(ev.currentTarget.dataset.noteShape);
    });
    // Przełączanie ukrywa/pokazuje bloki (nie usuwa klikniętego przycisku — Leaflet zamknąłby popup).
    const actions = root.querySelector('.card__actions:not(.card__confirm)');
    const confirmBox = root.querySelector('.card__confirm');
    on('[data-note-del]', () => {
      actions.hidden = true;
      confirmBox.hidden = false;
    });
    on('[data-note-del-no]', () => {
      confirmBox.hidden = true;
      actions.hidden = false;
    });
    on('[data-note-del-yes]', async (ev) => {
      const id = ev.currentTarget.dataset.noteDelYes;
      map.closePopup();
      await persist(items.filter((i) => i.id !== id));
    });
  }
  map.on('popupopen', (e) => wirePopup(e.popup));

  // ---------- Edycja kształtu / przesuwanie ----------
  function editableOf(lyr) {
    return lyr instanceof L.FeatureGroup ? lyr.getLayers()[0] : lyr;
  }

  function startShapeEdit(id) {
    if (readOnly) return;
    finishShapeEdit(false);
    stopTool();
    const lyr = editableOf(layersById.get(id));
    if (!lyr) return;
    const cleanup = [];
    // Edycja trwa, dopóki gracz nie kliknie ✓ (lub Enter) — przesuwać można dowolnie wiele razy.
    if (lyr instanceof L.Marker) {
      lyr.dragging.enable();
      toast('Przesuwaj dowolnie. ✓ przy rysunku lub Enter — zapisz; ✕ lub Esc — anuluj.');
    } else if (lyr instanceof L.CircleMarker) {
      lyr.pm.enableLayerDrag?.();
      toast('Przesuwaj dowolnie. ✓ przy rysunku lub Enter — zapisz; ✕ lub Esc — anuluj.');
    } else {
      lyr.pm.enable({ allowSelfIntersection: true, draggable: true });
      // Znaki z ukrytą linią główną: na czas edycji pokaż jej ścieżkę.
      if (lyr.hiddenMain) lyr.setStyle({ opacity: 0.6, weight: 1.5, dashArray: '3 5' });
      toast('Przeciągaj wierzchołki lub cały rysunek. ✓ przy rysunku lub Enter — zapisz; ✕ lub Esc — anuluj.');
    }
    // Pływające ✓ / ✕ przy edytowanym rysunku, podążające za nim.
    const anchorOf = () => (lyr.getLatLng ? lyr.getLatLng() : lyr.getBounds().getNorthEast());
    const ctl = L.marker(anchorOf(), {
      icon: L.divIcon({
        className: 'edit-ctl',
        html: '<button type="button" data-act="ok" title="Zakończ i zapisz (Enter)">✓</button><button type="button" data-act="cancel" title="Anuluj (Esc)">✕</button>',
        iconSize: [70, 30],
        iconAnchor: [-14, 40],
      }),
      zIndexOffset: 5000,
      keyboard: false,
    }).addTo(map);
    const ctlEl = ctl.getElement();
    L.DomEvent.disableClickPropagation(ctlEl);
    ctlEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') finishShapeEdit();
      if (act === 'cancel') finishShapeEdit(false);
    });
    const follow = () => {
      ctl.setLatLng(anchorOf());
      if (lyr.getTooltip?.()) {
        lyr.closeTooltip();
        lyr.openTooltip();
      }
    };
    lyr.on('drag pm:drag pm:markerdrag pm:edit', follow);
    cleanup.push(() => {
      lyr.off('drag pm:drag pm:markerdrag pm:edit', follow);
      ctl.remove();
    });

    const onKey = (e) => {
      if (e.key === 'Enter') finishShapeEdit();
      if (e.key === 'Escape') finishShapeEdit(false);
    };
    document.addEventListener('keydown', onKey);
    cleanup.push(() => document.removeEventListener('keydown', onKey));
    editing = { id, layer: lyr, cleanup };
    updateToolbar();
  }

  async function finishShapeEdit(save = true) {
    if (!editing) return;
    const { id, layer: lyr, cleanup } = editing;
    editing = null;
    for (const fn of cleanup || []) fn();
    if (lyr instanceof L.Marker) lyr.dragging.disable();
    lyr.pm?.disable?.();
    lyr.pm?.disableLayerDrag?.();
    updateToolbar();
    if (!save) return render();
    const geometry = lyr.toGeoJSON().geometry;
    await persist(items.map((i) => (i.id === id ? { ...i, geometry } : i)));
  }

  // ---------- Miarka ----------
  const MeasureBox = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const el = L.DomUtil.create('div', 'measure-box');
      el.hidden = true;
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  const measureCtl = new MeasureBox().addTo(map);
  const measureBox = {
    el: measureCtl.getContainer(),
    show(coords, segmentKm) {
      const km = pathLengthKm(coords);
      const rows = marchTable(km)
        .map((r) => `<tr><td>${r.name}</td><td>${formatMarch(r.roadMin)}</td><td>${formatMarch(r.offroadMin)}</td></tr>`)
        .join('');
      this.el.innerHTML = `<div class="measure-box__total">${formatKm(km)}</div>
        ${segmentKm !== undefined ? `<div class="measure-box__seg">odcinek: ${formatKm(segmentKm)}</div>` : ''}
        <table><thead><tr><th>marsz</th><th>droga</th><th>teren</th></tr></thead><tbody>${rows}</tbody></table>`;
      this.el.hidden = km === 0;
    },
    hide() {
      this.el.hidden = true;
    },
  };

  let mPoints = [];
  let mLine = null;
  let mPreview = null;

  // Czarna linia z białym obrysem — czytelna na ciemnej i jasnej mapie.
  function casedLine({ weight, dashArray }) {
    const casing = L.polyline([], { color: '#fff', weight: weight + 3, opacity: 0.9, interactive: false }).addTo(measureLayer);
    const top = L.polyline([], { color: '#111', weight, dashArray, interactive: false }).addTo(measureLayer);
    return {
      setLatLngs(ll) {
        casing.setLatLngs(ll);
        top.setLatLngs(ll);
      },
    };
  }

  function startMeasure() {
    tool = 'measure';
    toast(HINTS.measure);
    measureLayer.clearLayers();
    mPoints = [];
    mLine = casedLine({ weight: 3 });
    mPreview = casedLine({ weight: 2.5, dashArray: '6 6' });
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('is-measuring');
    map.on('click', onMeasureClick);
    map.on('mousemove', onMeasureMove);
    map.on('dblclick', onMeasureEnd);
    document.addEventListener('keydown', onMeasureKey);
    measureBox.hide();
    updateToolbar();
  }

  const coordsOf = (latlngs) => latlngs.map((ll) => [ll.lng, ll.lat]);

  function onMeasureClick(e) {
    mPoints.push(e.latlng);
    mLine.setLatLngs(mPoints);
    L.circleMarker(e.latlng, { radius: 4.5, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(measureLayer);
    measureBox.show(coordsOf(mPoints));
  }

  function onMeasureMove(e) {
    if (mPoints.length === 0) return;
    const last = mPoints.at(-1);
    mPreview.setLatLngs([last, e.latlng]);
    const seg = pathLengthKm(coordsOf([last, e.latlng]));
    measureBox.show(coordsOf([...mPoints, e.latlng]), seg);
  }

  function onMeasureEnd() {
    if (tool === 'measure') stopTool();
  }

  function onMeasureKey(e) {
    if (e.key === 'Escape') onMeasureEnd();
  }

  function endMeasure() {
    map.off('click', onMeasureClick);
    map.off('mousemove', onMeasureMove);
    map.off('dblclick', onMeasureEnd);
    document.removeEventListener('keydown', onMeasureKey);
    map.getContainer().classList.remove('is-measuring');
    setTimeout(() => map.doubleClickZoom.enable(), 0);
    mPreview?.setLatLngs([]);
    if (mPoints.length) measureBox.show(coordsOf(mPoints));
    else measureLayer.clearLayers();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flyoutOpen) setFlyout(false);
    else if (e.key === 'Escape' && tool && tool !== 'measure') stopTool();
  });

  // ---------- Podświetlenie (np. z załącznika rozkazu) ----------
  function showGeometry(note) {
    tempHighlight?.remove();
    const g = note.geometry;
    let lyr;
    if (g.type === 'Point') lyr = L.circleMarker(toLatLng(g.coordinates), { radius: 18, color: '#ffd54a', weight: 3, fill: false });
    else if (g.type === 'LineString') lyr = L.polyline(g.coordinates.map(toLatLng), { color: '#ffd54a', weight: 8, opacity: 0.6 });
    else lyr = L.polygon(g.coordinates.map((r) => r.map(toLatLng)), { color: '#ffd54a', weight: 4, fillOpacity: 0.2 });
    tempHighlight = lyr.addTo(map);
    if (g.type === 'Point') map.panTo(lyr.getLatLng());
    else map.fitBounds(lyr.getBounds().pad(0.4), { maxZoom: 13 });
    setTimeout(() => {
      if (tempHighlight === lyr) {
        lyr.remove();
        tempHighlight = null;
      }
    }, 4000);
  }

  // Synchronizacja ze store: zmiana tury, trybu archiwum albo listy szkiców.
  // Trwająca edycja kształtu w tej samej turze nie jest przerywana przez odświeżenie.
  function sync({ notes, viewTurn, archive }) {
    if (editing && !archive && viewTurn === turn) return;
    const changed = viewTurn !== turn || archive !== readOnly || notes !== items;
    turn = viewTurn;
    readOnly = archive;
    if (archive && tool && tool !== 'measure') stopTool();
    if (changed) {
      finishShapeEdit(false);
      items = notes;
      render();
    }
    updateToolbar();
  }
  store.subscribe(['notes', 'viewTurn', 'archive'], sync, { immediate: true });
  store.subscribe('focus', ({ focus }) => {
    if (focus?.kind === 'geometry') showGeometry(focus.note);
  });
  // Skróty V A L R P Y G M i polecenia z omniboksu docierają jako jednorazowe polecenie „tool”.
  store.subscribe('command', ({ command }) => {
    if (command?.name === 'tool') onTool(command.arg);
  });
  // Warstwa „Moje szkice” z popovera Warstwy.
  store.subscribe(
    'layers',
    ({ layers }) => {
      if (layers.notes === false && map.hasLayer(layer)) map.removeLayer(layer);
      else if (layers.notes !== false && !map.hasLayer(layer)) layer.addTo(map);
    },
    { immediate: true },
  );

  return {
    startShapeEdit,
    finishShapeEdit,
    // Diagnostyka (?debug): koniec linii i czubek grotu każdej strzałki, w pikselach.
    debugArrows: () => [
      ...arrowHeads.map(({ line, head }) => ({
        end: map.latLngToContainerPoint(line.getLatLngs().at(-1)),
        tip: map.latLngToContainerPoint(head.getLatLngs()[0][1]),
      })),
      ...tips.map(({ line, out }) => ({
        end: map.latLngToContainerPoint(line.getLatLngs().at(-1)),
        tip: out.tip ? map.layerPointToContainerPoint(L.point(out.tip.x, out.tip.y)) : null,
      })),
    ],
  };
}
