// Widok: linia od aktywnej karty kanału komunikatora do jednostki na mapie (nakładka SVG nad układem).
//
// Czyta store (kanał, tura, szczegółowość, układ). Położenie na ekranie bierze z `surface`
// (powierzchnia mapy przekazana przez bootstrap) i z elementu kotwicy w DOM: komunikator oznacza
// aktywną kartę kanału atrybutem `data-leader-anchor` — to jedyny kontrakt między tymi widokami.
import { clipToRect } from '../domain/geo.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createLeaderView({ store, surface, root = document }) {
  const container = root.getElementById('app');
  const mapEl = root.getElementById('map');
  const panelEl = root.getElementById('dock-r');
  const listEl = root.getElementById('chtabs');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('leader');
  svg.innerHTML = `<defs><marker id="leader-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="leader__arrow"/></marker></defs>
    <line class="leader__line"/><circle class="leader__dot" r="5"/>`;
  container.append(svg);
  const line = svg.querySelector('line');
  const dot = svg.querySelector('circle');

  function getAnchor() {
    const { ui } = store.get();
    if (!ui.leader || ui.rightCollapsed || ui.narrow) return null;
    const panel = panelEl.getBoundingClientRect();
    const item = root.querySelector('[data-leader-anchor]');
    if (!item || item.offsetParent === null || panel.width === 0) return null;
    const r = item.getBoundingClientRect();
    const list = listEl.getBoundingClientRect();
    const y = Math.min(Math.max(r.top + r.height / 2, list.top), list.bottom);
    return { x: panel.left, y };
  }

  function update() {
    const unitId = store.get().channelUnit;
    const target = unitId ? surface.pointOf(unitId) : null;
    const anchor = getAnchor();
    if (!target || !anchor) {
      svg.style.display = 'none';
      return;
    }
    const box = container.getBoundingClientRect();
    const m = mapEl.getBoundingClientRect();
    const from = { x: anchor.x - box.left, y: anchor.y - box.top };
    const to = { x: m.left - box.left + target.x, y: m.top - box.top + target.y };
    const inset = 6;
    const end = clipToRect(from, to, {
      left: m.left - box.left + inset,
      top: m.top - box.top + inset,
      right: m.right - box.left - inset,
      bottom: m.bottom - box.top - inset,
    });
    svg.style.display = '';
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y);
    line.toggleAttribute('marker-end', end.clipped);
    if (end.clipped) line.setAttribute('marker-end', 'url(#leader-arrow)');
    line.classList.toggle('is-offscreen', end.clipped);
    dot.style.display = end.clipped ? 'none' : '';
    dot.setAttribute('cx', end.x);
    dot.setAttribute('cy', end.y);
  }

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };

  // Każda zmiana stanu może przesunąć kotwicę albo cel; rysowanie i tak jest sklejane do jednej klatki.
  store.subscribe('*', schedule);
  surface.map.on('move zoom resize zoomend moveend ks:motion', schedule);
  window.addEventListener('resize', schedule);
  listEl.addEventListener('scroll', schedule);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(listEl);
  schedule();
  return { update: schedule };
}
