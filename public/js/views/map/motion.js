// Warstwa animacji przemieszczeń na mapie: odtwarza plan z domain/motion.js (store.animation).
// Jednostki jadą po trasie (track) albo po prostej, wszystkie kończą razem; za symbolem ciągnie się
// cienki przerywany ślad, który po zakończeniu blaknie. Kontakty wroga NIE jadą (mgła wojny: to tylko meldunki):
// stara zameldowana pozycja zostaje „duchem” z przerywaną linią do nowej i gaśnie, a nowy symbol pulsuje raz.
// Widok niczego nie zapisuje w store; kliknięcie w mapę w trakcie animacji kończy ją natychmiast.
/* global L */
import { symbolIcon } from '../../lib/symbols.js';
import { toLatLng } from '../../domain/geo.js';
import { easeInOut, pointAt, slicePath, TRAIL_FADE_MS } from '../../domain/motion.js';

const TRAIL_STYLE = { color: '#d6dee9', weight: 2, opacity: 0.85, dashArray: '2 6', interactive: false, className: 'motion-trail' };
const GHOST_LINE_STYLE = { color: '#ff8080', weight: 1.75, opacity: 0.85, dashArray: '6 5', interactive: false, className: 'motion-trail' };
const GHOST_FADE_MS = 1400;
const PULSE_MS = 2400;

// markers: Map id → L.Marker (współdzielona z widokiem mapy); onFrame: linie hierarchii i linia komunikatora podążają za symbolami.
export function createMotion({ map, markers, onFrame, contactsShown = () => true }) {
  const layer = L.layerGroup().addTo(map);
  let run = null; // { raf, t0, ms, items: [{ marker, route, length, trail }] }
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  function frame(items, f) {
    for (const it of items) {
      it.marker.setLatLng(toLatLng(pointAt(it.route, f, it.length)));
      it.trail?.setLatLngs(slicePath(it.route, f, it.length).map(toLatLng));
    }
    onFrame();
  }

  function tick(now) {
    if (!run) return;
    const t = Math.min(1, (now - run.t0) / run.ms);
    frame(run.items, easeInOut(t));
    if (t < 1) run.raf = requestAnimationFrame(tick);
    else finish();
  }

  // Kończy animację od razu: symbole w pozycjach końcowych, ślady zaczynają blaknąć.
  function finish() {
    if (!run) return;
    const { items, raf } = run;
    cancelAnimationFrame(raf);
    run = null;
    frame(items, 1);
    for (const it of items) {
      if (!it.trail) continue;
      const el = it.trail.getElement?.();
      if (el) requestAnimationFrame(() => (el.style.opacity = '0'));
      later(() => layer.removeLayer(it.trail), TRAIL_FADE_MS + 150);
    }
  }

  // Zatrzymuje wszystko i sprząta (zmiana tury przerysowuje markery, więc stare ślady nie mają sensu).
  function stop() {
    finish();
    for (const id of timers) clearTimeout(id);
    timers.clear();
    layer.clearLayers();
  }

  function addGhost(g) {
    if (!contactsShown()) return;
    const from = toLatLng(g.from);
    const to = toLatLng(g.to);
    const line = L.polyline([from, to], GHOST_LINE_STYLE).addTo(layer);
    const ghost = L.marker(from, { icon: symbolIcon(g.sidc, { size: 26 }), interactive: false, keyboard: false, opacity: 0.6, zIndexOffset: 90 }).addTo(layer);
    const gel = ghost.getElement();
    if (gel) {
      gel.classList.add('motion-ghost');
      requestAnimationFrame(() => requestAnimationFrame(() => (gel.style.opacity = '0')));
    }
    const lel = line.getElement?.();
    if (lel) requestAnimationFrame(() => (lel.style.opacity = '0'));
    later(() => layer.removeLayer(ghost), GHOST_FADE_MS + 100);
    later(() => layer.removeLayer(line), TRAIL_FADE_MS + 150);
    // Nowy symbol (już narysowany na zameldowanej pozycji) pulsuje jednorazowo, gdy duch zgaśnie.
    const el = markers.get(g.id)?.getElement();
    if (el) {
      el.classList.remove('is-pulse');
      void el.offsetWidth;
      el.classList.add('is-pulse');
      later(() => el.classList.remove('is-pulse'), PULSE_MS);
    }
  }

  function start({ plan, ms }) {
    stop();
    const items = [];
    for (const m of plan.moves) {
      const marker = markers.get(m.id);
      if (!marker) continue;
      const trail = map.hasLayer(marker) ? L.polyline([toLatLng(m.route[0])], TRAIL_STYLE).addTo(layer) : null;
      items.push({ marker, route: m.route, length: m.lengthKm, trail });
    }
    for (const g of plan.ghosts) addGhost(g);
    if (!items.length) return;
    frame(items, 0);
    run = { items, ms, t0: performance.now(), raf: 0 };
    run.raf = requestAnimationFrame(tick);
  }

  // Kliknięcie gdziekolwiek (albo Esc) w trakcie animacji kończy ją od razu; zdarzenie idzie dalej, nic nie jest blokowane.
  document.addEventListener('pointerdown', finish, true);
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && finish(), true);

  return { start, stop, finish, isActive: () => run !== null };
}
