// Widok: szkice gracza na mapie (strzałki, linie, rejony, punkty, własne symbole NATO) i miarka.
// Szkice czyta ze store.notes, zapisuje przez controller.saveNotes; stan edycji i narzędzi jest lokalny.
/* global L */
import { escapeHtml } from '../domain/markdown.js';
import { toLatLng } from '../domain/geo.js';
import { GRAPHICS, defaultGraphic, autoName } from '../domain/tactical.js';
import { ic } from '../lib/icons.js';
import { createNoteEditor } from './draw/editor.js';
import { createMeasure } from './draw/measure.js';
import { createShapes } from './draw/shapes.js';
import { TOOLS, HINTS, uid, hypothesisSidc, countOf } from './draw/graphics.js';

// Publiczne eksporty zachowane (kiedyś w tym pliku).
export { COLORS, hypothesisSidc, graphicPreviewSvg } from './draw/graphics.js';

export function createDrawView({ store, controller, surface, root = document }) {
  const map = surface.map;
  const toast = (text) => controller.notify(text);
  const byId = (id) => root.getElementById(id);
  const layer = L.layerGroup().addTo(map);
  let items = [];
  let turn = 0;
  let readOnly = true;
  let editing = null; // { id, layer }
  let tool = null;
  let tempHighlight = null;
  let presetGraphic = null; // znak wybrany z flyoutu (null = domyślny dla narzędzia)

  const shapes = createShapes({ map });
  const measure = createMeasure({ map, toast, isActive: () => tool === 'measure', onStop: () => stopTool(), store, controller });
  const editor = createNoteEditor({ byId, getItems: () => items, persist: (next) => persist(next) });
  const layersById = new Map();

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
      else if (id === 'clear-measure') b.hidden = !measure.hasContent();
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
    const head = shapes.headLatLngs([from, ev.latlng]);
    if (drawHead) drawHead.setLatLngs(head);
    else drawHead = L.polyline(head, { color: '#ffd54a', weight: 3, interactive: false }).addTo(map);
  });

  function stopTool() {
    if (tool && tool !== 'measure') {
      map.pm?.disableDraw();
      map.getContainer().classList.remove('is-drawing');
      setTimeout(() => map.doubleClickZoom.enable(), 0);
    }
    if (tool === 'measure') measure.end();
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
      measure.clear();
      return updateToolbar();
    }
    const was = tool;
    stopTool();
    if (was === id) return;
    if (id === 'measure') {
      tool = 'measure';
      measure.start();
      return updateToolbar();
    }
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
    const name = autoName(kind, graphic, color, countOf(items, kind, graphic) + 1);
    editor.open({ id: uid(), kind, graphic, name, color, geometry, sidc: kind === 'symbol' ? hypothesisSidc('H', 'G:UCAT', 'E') : undefined }, true);
  });

  // ---------- Zapis ----------
  // Zapis idzie przez kontroler; nowa lista wraca przez store.notes (subskrypcja `sync` poniżej).
  // Gdy zapis się nie uda, rysunek wraca do ostatniego zapisanego stanu.
  async function persist(next) {
    if (!(await controller.saveNotes(next))) render();
  }

  function render() {
    layer.clearLayers();
    layersById.clear();
    shapes.reset();
    for (const note of items) {
      const lyr = shapes.noteLayer(note);
      editableOf(lyr).bindPopup(() => shapes.popupHtml(note, readOnly), { maxWidth: 300 });
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
      if (note) editor.open(note, false);
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
    debugArrows: shapes.debugArrows,
  };
}
