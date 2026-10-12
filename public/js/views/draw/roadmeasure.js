// Miarka po drogach (T15): panel nad miarką z przełącznikiem „Po drogach”, typem marszu, dzień/noc i ostrzeżeniami o mostach.
// Trasę liczy serwer (controller.measureRoute → OSRM); przy błędzie widok pokazuje oznaczony szacunek.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng, formatKm, formatMarch } from '../../domain/geo.js';
import { findEntity } from '../../domain/entities.js';
import { MARCH_PROFILES, profileById, profileFromSidc, isNightAt, estimateRoute, roadRoute, routeSummary } from '../../domain/roadmarch.js';

const e = escapeHtml;

export function createRoadMeasure({ map, store, controller }) {
  const layer = L.layerGroup().addTo(map);
  let points = [];
  let enabled = false;
  let profileId = null; // null = z zaznaczonej jednostki (SIDC), przy braku — kołowa
  let timeMode = 'auto'; // auto | day | night
  let route = null; // ostatni wynik trasy (bez profilu)
  let status = ''; // „liczę trasę…” albo powód szacunku
  let epoch = 0; // odrzuca spóźnione odpowiedzi

  const Box = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const el = L.DomUtil.create('div', 'road-box');
      el.hidden = true;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  const ctl = new Box().addTo(map);
  const el = ctl.getContainer();

  function currentProfile() {
    if (profileId) return profileById(profileId);
    const sel = store.get().selection;
    const sidc = sel ? findEntity(store.get().turn, sel.id)?.item?.sidc : null;
    return sidc ? profileFromSidc(sidc) : profileById('wheeled');
  }

  function isNight() {
    if (timeMode !== 'auto') return timeMode === 'night';
    const s = store.get();
    return isNightAt(s.turn?.time, s.scenario?.timezone, s.scenario?.map?.center);
  }

  function render() {
    if (points.length < 2) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const profile = currentProfile();
    const night = isNight();
    let body = '';
    if (enabled && status && !route) body = `<div class="road-box__note">${e(status)}</div>`;
    else if (enabled && route) {
      const sum = routeSummary(route, profile, { night, bridges: store.get().turn?.logistics?.bridges || [], weather: store.get().turn?.weather });
      const warn = sum.warnings.map((w) => `<li class="road-box__lvl-${w.level}">${e(w.text)}</li>`).join('');
      body = `<div class="road-box__km" data-road-km>${e(formatKm(sum.km))}</div>
        <div class="road-box__note${sum.estimate ? ' road-box__est' : ''}">${e(sum.note)}${status ? ' — ' + e(status) : ''}</div>
        <div class="road-box__time" data-road-time>${e(formatMarch(sum.minutes))} <span>marsz ${e(profile.name)}, ${night ? 'noc' : 'dzień'}, ${sum.speedKmh} km/h</span></div>
        ${sum.bridgesChecked ? (warn ? `<ul class="road-box__warn">${warn}</ul>` : '<div class="road-box__note">mosty na trasie: bez uwag</div>') : '<div class="road-box__note">mosty niesprawdzone (brak trasy drogowej)</div>'}`;
    }
    const profOpts = MARCH_PROFILES.map((p) => `<option value="${p.id}"${p.id === profile.id ? ' selected' : ''}>${e(p.name)} (${e(p.example)})</option>`).join('');
    const timeOpts = [['auto', 'dzień/noc: wg tury'], ['day', 'dzień'], ['night', 'noc']].map(([v, t]) => `<option value="${v}"${v === timeMode ? ' selected' : ''}>${t}</option>`).join('');
    el.innerHTML = `<label class="road-box__toggle"><input type="checkbox" data-road-toggle${enabled ? ' checked' : ''}> Po drogach</label>
      ${enabled ? `<div class="road-box__row"><select data-road-profile aria-label="Typ marszu">${profOpts}</select><select data-road-time-mode aria-label="Pora dnia">${timeOpts}</select></div>` : ''}
      ${body}`;
  }

  function drawLine() {
    layer.clearLayers();
    if (!enabled || !route?.path) return;
    const ll = route.path.map(toLatLng);
    L.polyline(ll, { color: '#fff', weight: 7, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(ll, { color: '#2f81f7', weight: 4, interactive: false }).addTo(layer);
  }

  async function compute() {
    const mine = ++epoch;
    route = null;
    status = '';
    layer.clearLayers();
    if (!enabled || points.length < 2) return render();
    status = 'liczę trasę po drogach…';
    render();
    const snapshot = points.slice();
    let res = null;
    let reason = '';
    try {
      res = roadRoute(snapshot, await controller.measureRoute(snapshot));
      if (!res) reason = 'nieczytelna odpowiedź routera';
    } catch (err) {
      reason = 'router niedostępny: ' + (err?.message || 'błąd');
    }
    if (mine !== epoch) return;
    route = res || estimateRoute(snapshot);
    status = reason;
    drawLine();
    render();
  }

  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('[data-road-toggle]')) {
      enabled = t.checked;
      compute();
    } else if (t.matches('[data-road-profile]')) {
      profileId = t.value;
      render();
    } else if (t.matches('[data-road-time-mode]')) {
      timeMode = t.value;
      render();
    }
  });
  el.addEventListener('dblclick', (ev) => ev.stopPropagation());

  return {
    // Wołane przez miarkę po dodaniu punktu i po zakończeniu pomiaru (punkty = [[lon, lat], …]).
    update(next) {
      points = next.slice();
      if (enabled) compute();
      else render();
    },
    clear() {
      points = [];
      epoch++;
      route = null;
      status = '';
      layer.clearLayers();
      render();
    },
  };
}
