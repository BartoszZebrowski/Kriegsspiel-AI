// Pływające palety na mapie: przybliżanie, „pokaż wszystko”, szczegółowość, popover „Warstwy i podkład”,
// pasek stanu (kursor, MGRS, zoom, podkład). Stan podkładu/warstw/szczegółowości leży w store; zdarzenia
// idą do kontrolera. Paleta narzędzi szkicu i legenda mają własne widoki (draw, legend).
import { ic } from '../../lib/icons.js';
import { formatLatLon, toMgrs } from '../../domain/mgrs.js';
import { BASEMAP_ORDER } from './basemaps.js';

const OVERLAY_ROWS = [
  ['lines', 'Granice pasów i linie'],
  ['hierarchy', 'Linie podporządkowania'],
  ['units', 'Jednostki własne'],
  ['contacts', 'Kontakty i okręgi niepewności'],
  ['assets', 'Środki rozpoznania'],
  ['logistics', 'Logistyka: składy, trasy, mosty, konwoje'],
  ['notes', 'Moje szkice'],
  ['Koleje', 'Koleje (OpenRailwayMap)'],
  ['Rzeźba terenu', 'Rzeźba terenu (cieniowanie)'],
  ['Nazwy i granice', 'Nazwy i granice (Esri)'],
];

export function createMapControls({ store, controller, map, root = document }) {
  const $ = (id) => root.getElementById(id);
  const S = () => store.get();

  // ---------- zoom, dopasowanie ----------
  $('z-in').addEventListener('click', () => map.zoomIn());
  $('z-out').addEventListener('click', () => map.zoomOut());
  $('z-fit').addEventListener('click', () => controller.command('fit'));
  $('b-layers').addEventListener('click', () => controller.togglePopover('layers'));
  $('b-legend').addEventListener('click', () => controller.togglePopover('legend'));

  // ---------- szczegółowość ----------
  $('seg-detail').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-d]');
    if (b) controller.setDetail(b.dataset.d === 'auto' ? null : b.dataset.d);
  });
  function renderDetail({ detail, level }) {
    for (const b of $('seg-detail').querySelectorAll('button')) {
      const mode = b.dataset.d;
      b.classList.toggle('on', mode === 'auto' ? !detail : detail === mode);
      b.classList.toggle('eff', mode !== 'auto' && !detail && level === mode);
    }
  }

  // ---------- popover „Warstwy i podkład” ----------
  function renderLayers({ basemap, layers, ui }) {
    $('lp-base').innerHTML = BASEMAP_ORDER.map(
      (k) => `<div class="lp-row${basemap === k ? ' on' : ''}" role="radio" aria-checked="${basemap === k}" tabindex="0" data-base="${k}"><span class="rd"></span><span class="grow">${k}</span></div>`,
    ).join('');
    const rows = OVERLAY_ROWS.map(
      ([k, name]) => `<div class="lp-row${layers[k] ? ' on' : ''}" role="checkbox" aria-checked="${Boolean(layers[k])}" tabindex="0" data-ov="${k}"><span class="cb">${ic('check')}</span><span class="grow">${name}</span></div>`,
    ).join('');
    $('lp-over').innerHTML =
      rows +
      `<div class="lp-div"></div>` +
      `<div class="lp-row${layers.labels ? ' on' : ''}" role="checkbox" aria-checked="${Boolean(layers.labels)}" tabindex="0" data-ov="labels"><span class="cb">${ic('check')}</span><span class="grow">Etykiety symboli</span></div>` +
      // Animacja przemieszczeń między turami: przełącznik zapamiętany; systemowe „ogranicz ruch” wyłącza ją zawsze.
      `<div class="lp-row${ui.animations && !ui.reducedMotion ? ' on' : ''}" role="checkbox" aria-checked="${ui.animations && !ui.reducedMotion}" tabindex="0" data-anim title="${ui.reducedMotion ? 'Wyłączone przez ustawienie systemu (ogranicz ruch)' : 'Animacja przemieszczeń po zmianie tury'}"><span class="cb">${ic('check')}</span><span class="grow">Animacje</span>${ui.reducedMotion ? '<span class="pill">SYSTEM</span>' : ''}</div>`;
  }
  $('layers').addEventListener('click', (ev) => {
    const base = ev.target.closest('[data-base]');
    if (base) return controller.setBasemap(base.dataset.base);
    if (ev.target.closest('[data-anim]')) return controller.setAnimations(!S().ui.animations);
    const ov = ev.target.closest('[data-ov]');
    if (ov) controller.setLayerVisible(ov.dataset.ov, !S().layers[ov.dataset.ov]);
  });
  $('layers').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ev.target.closest('.lp-row')?.click();
    }
  });

  // Popovery otwierane przyciskami palety (legendę rysuje osobny widok, ale otwarcie to wspólny stan).
  function renderPopover({ popover }) {
    $('layers').classList.toggle('open', popover === 'layers');
    $('b-layers').classList.toggle('on', popover === 'layers');
    $('legend').classList.toggle('open', popover === 'legend');
    $('b-legend').classList.toggle('on', popover === 'legend');
    $('tb-help').classList.toggle('on', popover === 'legend');
  }
  document.addEventListener('mousedown', (ev) => {
    const p = S().popover;
    if (p !== 'layers' && p !== 'legend') return;
    if (ev.target.closest('#layers, #legend, #b-layers, #b-legend, #tb-help, #omni')) return;
    controller.setPopover(null);
  });
  map.on('mousedown', () => {
    if (S().popover === 'layers' || S().popover === 'legend') controller.setPopover(null);
  });

  // ---------- pasek stanu ----------
  const mapPos = () => map.getCenter();
  function setCursor(latlng) {
    $('st-c').textContent = formatLatLon(latlng.lat, latlng.lng);
    $('st-m').textContent = toMgrs(latlng.lat, latlng.lng, 4) || '—';
  }
  setCursor(mapPos());
  map.on('mousemove', (ev) => setCursor(ev.latlng));
  const showZoom = () => ($('st-z').textContent = String(Math.round(map.getZoom() * 4) / 4).replace(/\.0+$/, ''));
  map.on('zoomend', showZoom);
  showZoom();

  store.subscribe(['detail', 'level'], renderDetail, { immediate: true });
  store.subscribe(['basemap', 'layers', 'ui'], renderLayers, { immediate: true });
  store.subscribe('basemap', ({ basemap }) => ($('st-b').textContent = basemap), { immediate: true });
  store.subscribe('popover', renderPopover, { immediate: true });
}
