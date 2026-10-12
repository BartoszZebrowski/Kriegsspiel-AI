// Tryb „rozkaz graficzny” na mapie (T44, jak w RTS): zaznaczanie jednostek (klik / Shift+klik / Shift+ramka), wybór zadania,
// wskazanie punktu, trasy, rubieży albo rejonu. Wynik to załącznik do szkicu wiadomości (controller.orderCommit), nie wykonanie.
// Stan trybu (zaznaczenie, zadanie, rodzaj wskazania) leży w store.orderMode; tu tylko lokalne kliknięcia w toku
// (punkty geometrii, ramka). Podgląd niewysłanych rozkazów rysuje order-preview.js.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { ic } from '../../lib/icons.js';
import { ORDER_TASKS, ORDER_KINDS, taskInfo, selectableUnits, unitsInBounds, geometryFromPoints } from '../../domain/order.js';

const DRAW_COLOR = '#ffd54a';
const CLOSE_PX = 12; // kliknięcie tak blisko pierwszego punktu zamyka rejon
const BOX_MIN_PX = 5; // krótszy ruch z Shiftem to zwykłe kliknięcie

const HINTS = {
  point: 'Kliknij miejsce docelowe na mapie.',
  route: 'Klikaj kolejne punkty trasy; dwuklik lub Enter zatwierdza.',
  line: 'Klikaj punkty rubieży; dwuklik lub Enter zatwierdza.',
  area: 'Klikaj wierzchołki rejonu; kliknięcie pierwszego punktu lub Enter zamyka.',
};

export function createOrderMode({ store, controller, map, markers, root = document }) {
  const S = () => store.get();
  const mode = () => S().orderMode;
  const wrap = map.getContainer().parentElement;

  // ---------- panel i przycisk wejścia ----------
  const panel = document.createElement('div');
  panel.className = 'float order-panel';
  panel.id = 'order-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Rozkaz graficzny');
  wrap.appendChild(panel);

  const toolBtn = document.createElement('button');
  toolBtn.type = 'button';
  toolBtn.className = 'tool';
  toolBtn.id = 'b-order';
  toolBtn.dataset.tip = 'Rozkaz graficzny — zaznacz jednostki i wskaż cel na mapie';
  toolBtn.dataset.k = 'O';
  toolBtn.dataset.pos = 'l';
  toolBtn.setAttribute('aria-label', 'Rozkaz graficzny');
  toolBtn.innerHTML = ic('flag');
  root.getElementById('mapctl')?.prepend(toolBtn);
  toolBtn.addEventListener('click', () => controller.toggleOrderMode());

  // ---------- lokalny stan wskazywania ----------
  let points = []; // [lon, lat] klikniętych punktów geometrii
  let cursor = null; // L.LatLng — ruchoma końcówka
  const layer = L.layerGroup().addTo(map);
  let boxEl = null;
  let boxStart = null; // { x, y, shift } w pikselach kontenera
  let savedBoxZoom = false;

  const drawing = () => Boolean(mode()?.task && mode()?.kind);
  const redrawGuide = () => {
    layer.clearLayers();
    const m = mode();
    if (!m || !points.length) return;
    const latlngs = points.map(toLatLng);
    const live = cursor && drawing() ? [...latlngs, cursor] : latlngs;
    if (m.kind === 'area' && live.length >= 3) layer.addLayer(L.polygon(live, { color: DRAW_COLOR, weight: 2, dashArray: '6 5', fillOpacity: 0.1, interactive: false }));
    else if (live.length >= 2) layer.addLayer(L.polyline(live, { color: DRAW_COLOR, weight: 2.5, dashArray: '6 5', interactive: false }));
    for (const [i, ll] of latlngs.entries()) layer.addLayer(L.circleMarker(ll, { radius: i === 0 && m.kind === 'area' ? 6 : 4, color: DRAW_COLOR, weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }));
  };
  const resetPoints = () => {
    points = [];
    cursor = null;
    redrawGuide();
  };

  // ---------- znaczniki zaznaczonych jednostek ----------
  function applyMarks() {
    const sel = new Set(mode()?.selected ?? []);
    for (const [id, m] of markers) m.getElement()?.classList.toggle('is-order', sel.has(id));
  }

  // ---------- panel ----------
  function renderPanel() {
    const m = mode();
    panel.hidden = !m;
    toolBtn.classList.toggle('on', Boolean(m));
    wrap.classList.toggle('is-ordering', Boolean(m));
    wrap.classList.toggle('is-order-drawing', drawing());
    if (!m) return;
    const byId = new Map((S().turn?.units ?? []).map((u) => [u.id, u]));
    const chips = m.selected.length
      ? m.selected.map((id) => `<span class="order-chip">${escapeHtml(byId.get(id)?.name || id)}<a role="button" tabindex="0" data-rm="${escapeHtml(id)}" aria-label="Zdejmij z zaznaczenia">${ic('x', 's')}</a></span>`).join('')
      : '<span class="order-hint">Zaznacz jednostki: klik, Shift+klik, Shift+przeciągnięcie (ramka).</span>';
    const tasks = ORDER_TASKS.map((t) => `<button type="button" data-task="${t.id}" class="${m.task === t.id ? 'on' : ''}">${escapeHtml(t.name)}</button>`).join('');
    const info = taskInfo(m.task);
    const kinds = info && info.kinds.length > 1
      ? `<div class="order-row"><span class="cap">Wskaż</span><div class="seg sm">${info.kinds.map((k) => `<button type="button" data-kind="${k}" class="${m.kind === k ? 'on' : ''}">${ORDER_KINDS[k].name}</button>`).join('')}</div></div>`
      : '';
    const hint = !m.selected.length ? 'Najpierw zaznacz jednostki.' : !m.task ? 'Wybierz zadanie.' : `${HINTS[m.kind]}${points.length ? ` (punktów: ${points.length})` : ''}`;
    const canOk = drawing() && m.kind !== 'point' && geometryFromPoints(m.kind, points).geometry;
    panel.innerHTML = `
      <div class="order-head"><strong>Rozkaz graficzny</strong><button type="button" class="btn ghost sm" data-act="close" aria-label="Zamknij tryb rozkazu">${ic('x', 's')}</button></div>
      <div class="order-row order-units"><span class="cap">Jednostki</span><div class="order-chips">${chips}</div></div>
      <div class="order-row"><span class="cap">Zadanie</span><div class="seg sm order-tasks">${tasks}</div></div>
      ${kinds}
      <label class="order-opt"><input type="checkbox" data-delivery${m.delivery === 'common' ? ' checked' : ''}> Jedno zlecenie przez wspólnego przełożonego</label>
      <div class="order-hint order-hint--now">${escapeHtml(hint)}</div>
      <div class="order-actions">
        <button type="button" class="btn sm pri" data-act="ok"${canOk ? '' : ' disabled'}>Zatwierdź</button>
        <button type="button" class="btn sm" data-act="undo"${points.length ? '' : ' disabled'}>Cofnij punkt</button>
        <button type="button" class="btn sm" data-act="cancel">Anuluj</button>
      </div>`;
  }
  panel.addEventListener('click', (ev) => {
    const t = ev.target;
    const task = t.closest('[data-task]');
    const kind = t.closest('[data-kind]');
    const rm = t.closest('[data-rm]');
    const act = t.closest('[data-act]')?.dataset.act;
    if (task) {
      controller.orderSetTask(task.dataset.task);
      resetPoints();
    } else if (kind) {
      controller.orderSetKind(kind.dataset.kind);
      resetPoints();
    } else if (rm) controller.orderRemoveUnit(rm.dataset.rm);
    else if (act === 'close') controller.stopOrderMode();
    else if (act === 'ok') finish();
    else if (act === 'undo') undoPoint();
    else if (act === 'cancel') cancelStep();
  });
  panel.addEventListener('change', (ev) => {
    if (ev.target.matches('[data-delivery]')) controller.orderSetDelivery(ev.target.checked ? 'common' : 'own');
  });
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  // ---------- wskazywanie na mapie ----------
  function finish() {
    const m = mode();
    if (!m || !drawing()) return;
    const r = geometryFromPoints(m.kind, points);
    if (r.error) return controller.notify(r.error, true);
    resetPoints();
    controller.orderCommit(r.geometry);
  }
  function undoPoint() {
    points = points.slice(0, -1);
    redrawGuide();
    renderPanel();
  }
  // Esc: najpierw cofa wskazywanie, potem wybór zadania, na końcu kończy tryb.
  function cancelStep() {
    if (points.length) {
      resetPoints();
      renderPanel();
    } else if (mode()?.task) controller.orderSetTask(null);
    else controller.stopOrderMode();
  }

  function addPoint(latlng) {
    const m = mode();
    if (!drawing()) return;
    const p = [latlng.lng, latlng.lat];
    if (m.kind === 'point') {
      points = [p];
      return finish();
    }
    if (m.kind === 'area' && points.length >= 3) {
      const first = map.latLngToContainerPoint(toLatLng(points[0]));
      if (first.distanceTo(map.latLngToContainerPoint(latlng)) <= CLOSE_PX) return finish();
    }
    points = [...points, p];
    redrawGuide();
    renderPanel();
  }

  map.on('click', (ev) => {
    if (!mode() || ev.originalEvent?.shiftKey) return;
    addPoint(ev.latlng);
  });
  map.on('dblclick', (ev) => {
    if (!mode() || !drawing() || mode().kind === 'point') return;
    L.DomEvent.stop(ev.originalEvent);
    finish();
  });
  map.on('mousemove', (ev) => {
    if (!drawing() || !points.length) return;
    cursor = ev.latlng;
    redrawGuide();
  });

  // Kliknięcie w symbol (wołane z mapy przed zwykłym zaznaczeniem). Zwraca true, gdy tryb przejął kliknięcie.
  function handleMarkerClick(id, ev) {
    if (!mode()) return false;
    const shift = Boolean(ev?.originalEvent?.shiftKey);
    const own = selectableUnits(S().turn?.units, S().channels, S().level).some((u) => u.id === id);
    if (shift || (!drawing() && own)) {
      if (own) controller.orderPick([id], { toggle: shift });
      return true;
    }
    if (drawing() && ev?.latlng) {
      addPoint(ev.latlng);
      return true;
    }
    return false;
  }

  // ---------- ramka (Shift+przeciągnięcie) ----------
  const container = map.getContainer();
  const pt = (e) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function endBox() {
    boxEl?.remove();
    boxEl = null;
    boxStart = null;
    if (mode()) map.dragging.enable();
    document.removeEventListener('mousemove', onBoxMove);
    document.removeEventListener('mouseup', onBoxUp);
  }
  function onBoxMove(e) {
    if (!boxStart) return;
    const p = pt(e);
    if (!boxEl) {
      boxEl = document.createElement('div');
      boxEl.className = 'order-box';
      container.appendChild(boxEl);
    }
    Object.assign(boxEl.style, { left: Math.min(boxStart.x, p.x) + 'px', top: Math.min(boxStart.y, p.y) + 'px', width: Math.abs(p.x - boxStart.x) + 'px', height: Math.abs(p.y - boxStart.y) + 'px' });
  }
  function onBoxUp(e) {
    const start = boxStart;
    const p = pt(e);
    endBox();
    if (!start || Math.hypot(p.x - start.x, p.y - start.y) < BOX_MIN_PX) return;
    const a = map.containerPointToLatLng(L.point(Math.min(start.x, p.x), Math.min(start.y, p.y)));
    const b = map.containerPointToLatLng(L.point(Math.max(start.x, p.x), Math.max(start.y, p.y)));
    const bounds = { west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng), south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat) };
    const ids = unitsInBounds(selectableUnits(S().turn?.units, S().channels, S().level), bounds);
    if (ids.length) controller.orderPick(ids, { add: true });
    // Mysz zwolniona po ramce nie ma wywołać kliknięcia mapy (punktu geometrii).
    suppressClickUntil = Date.now() + 50;
  }
  let suppressClickUntil = 0;
  container.addEventListener('mousedown', (e) => {
    if (!mode() || !e.shiftKey || e.button !== 0 || e.target.closest('.leaflet-marker-icon, .float')) return;
    boxStart = pt(e);
    map.dragging.disable();
    document.addEventListener('mousemove', onBoxMove);
    document.addEventListener('mouseup', onBoxUp);
  });
  // Kliknięcie tuż po ramce nie jest punktem.
  container.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) e.stopPropagation();
  }, true);

  // ---------- klawisze ----------
  document.addEventListener('keydown', (e) => {
    if (!mode() || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelStep();
    } else if (e.key === 'Enter' && drawing()) {
      e.preventDefault();
      finish();
    } else if (e.key === 'Backspace' && points.length) {
      e.preventDefault();
      undoPoint();
    }
  });

  // ---------- subskrypcje ----------
  let wasActive = false;
  store.subscribe('orderMode', () => {
    const active = Boolean(mode());
    if (active && !wasActive) {
      savedBoxZoom = map.boxZoom.enabled();
      map.boxZoom.disable(); // Shift+przeciągnięcie to ramka zaznaczenia, nie powiększenia
      controller.command('tool', 'select'); // zamyka narzędzie szkicu (rysowanie i rozkaz graficzny wzajemnie się wykluczają)
    } else if (!active && wasActive) {
      if (savedBoxZoom) map.boxZoom.enable();
      endBox();
    }
    if (active) map.doubleClickZoom[drawing() ? 'disable' : 'enable']();
    else map.doubleClickZoom.enable();
    wasActive = active;
    if (!active) resetPoints();
    applyMarks();
    renderPanel();
  }, { immediate: true });
  store.subscribe(['turn', 'channels', 'level'], () => {
    applyMarks();
    renderPanel();
  });
  // Uruchomienie narzędzia szkicu kończy tryb rozkazu (polecenie „select” to tylko zamknięcie narzędzia).
  store.subscribe('command', ({ command }) => {
    if (command?.name === 'tool' && command.arg !== 'select' && mode()) controller.stopOrderMode();
  });

  return { handleMarkerClick, applyMarks };
}
