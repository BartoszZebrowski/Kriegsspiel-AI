// Widok: mapa sztabowa — podkłady, nakładki i warstwa sytuacji (jednostki, kontakty, linie, podporządkowanie).
// Renderuje ze store (tura, zaznaczenie, szczegółowość, podkład, warstwy, polecenia `focus`/`command`); zgłasza
// kontrolerowi kliknięcia w symbole, zoom i najechanie. Pływające palety (zoom, warstwy, szczegółowość, pasek
// stanu) obsługuje `controls.js` z tego samego katalogu.
/* global L */
import { symbolIcon } from '../../lib/symbols.js';
import { describeSidc } from '../../domain/sidc.js';
import { escapeHtml } from '../../domain/markdown.js';
import { unitBrief, contactBrief } from '../../domain/strength.js';
import { findEntity, entityPos } from '../../domain/entities.js';
import { toLatLng } from '../../domain/geo.js';
import { ageMinutes } from '../../domain/format.js';
import { bftStatus, BFT_STALE_OPACITY } from '../../domain/bft.js';
import { commsInfo } from '../../domain/comms.js';
import { contactFreshness } from '../../domain/contactage.js';
import { indexById, isUnitVisible, echelonRank, BATTALION_RANK, COMPANY_RANK, splitUnits, parentIdOf, isNeighbourUnit } from '../../domain/orbat.js';
import { BASEMAPS, OVERLAYS, DARK_BASES } from './basemaps.js';
import { renderLines } from './lines.js';
import { createEwZonesLayer } from './ewzones.js';
import { createRangesLayer } from './ranges.js';
import { createHierarchyLayer } from './hierarchy.js';
import { createMapControls } from './controls.js';
import { createMotion } from './motion.js';
import { createLogisticsLayer } from './logistics.js';
import { createOrderMode } from './order.js';
import { createOrderPreview } from './order-preview.js';
import { createCcirLayer } from './ccir.js';
import { createOverlaysLayer } from './overlays.js';
import { createFiresLayer } from './fires.js';
import { createEngineeringLayer } from './engineering.js';
import { createTruthLayer } from './truth.js';

// Rozmiar symbolu zależy od szczebla: im mniejsza jednostka, tym mniejszy znak.
function unitSize(u) {
  const r = echelonRank(u);
  if (r < 0 || r >= BATTALION_RANK) return 30;
  return r >= COMPANY_RANK ? 26 : 22;
}

export function createMapView({ store, controller, root = document }) {
  const el = root.getElementById('map');
  const scenario = store.get().scenario;
  const S = () => store.get();

  const center = scenario.map?.center ? toLatLng(scenario.map.center) : [52.0, 19.5];
  const map = L.map(el, { zoomControl: false, zoomSnap: 0.25, preferCanvas: false, attributionControl: true }).setView(center, scenario.map?.zoom ?? 9);
  map.attributionControl.setPrefix(false);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  const bases = Object.fromEntries(Object.entries(BASEMAPS).map(([k, f]) => [k, f()]));
  const overlays = Object.fromEntries(Object.entries(OVERLAYS).map(([k, f]) => [k, f()]));

  const situation = {
    lines: L.layerGroup().addTo(map),
    contacts: L.layerGroup().addTo(map),
    hierarchy: L.layerGroup().addTo(map),
    units: L.layerGroup().addTo(map),
    assets: L.layerGroup().addTo(map),
    logistics: L.layerGroup().addTo(map),
  };

  // ---------- podkład i nakładki (ze store) ----------
  let activeBase = null;
  function syncBasemap() {
    const name = bases[S().basemap] ? S().basemap : 'Ciemna (Esri)';
    if (name === activeBase) return;
    if (activeBase) map.removeLayer(bases[activeBase]);
    bases[name].addTo(map);
    bases[name].eachLayer?.((l) => l.bringToBack?.());
    activeBase = name;
    el.classList.toggle('is-dark-base', DARK_BASES.includes(name));
  }
  function syncLayers() {
    const { layers } = S();
    for (const [name, group] of Object.entries(situation)) {
      const on = layers[name] !== false;
      if (on && !map.hasLayer(group)) group.addTo(map);
      else if (!on && map.hasLayer(group)) map.removeLayer(group);
    }
    for (const [name, layer] of Object.entries(overlays)) {
      const on = Boolean(layers[name]);
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    }
    el.classList.toggle('no-labels', layers.labels === false);
  }

  // Układ strony zmienia rozmiar mapy (docki, splittery, zwijanie) — jedno miejsce, bez ręcznych wywołań z zewnątrz.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(el);

  // Zoom wpływa na automatyczną szczegółowość, więc trafia do store.
  controller.mapZoomChanged(map.getZoom());
  map.on('zoomend', () => controller.mapZoomChanged(map.getZoom()));
  // Rejon widoczny na mapie (wejście do widoku 3D, T43).
  const reportView = () => {
    const b = map.getBounds();
    const c = map.getCenter();
    controller.mapViewChanged({ center: [c.lng, c.lat], zoom: map.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  };
  reportView();
  map.on('moveend', reportView);

  // ---------- symbole ----------
  const markers = new Map(); // id -> L.Marker
  let unitList = [];
  let unitsById = new Map();
  const hierarchy = createHierarchyLayer(situation.hierarchy);
  // Animacja przemieszczeń między turami (store.animation): symbole jadą, linie podporządkowania i linia komunikatora podążają.
  const motion = createMotion({
    map,
    markers,
    onFrame: () => {
      hierarchy.follow(markers);
      map.fire('ks:motion');
    },
    contactsShown: () => S().layers.contacts !== false,
  });

  const logistics = createLogisticsLayer({ group: situation.logistics, markers, scenario, controller, onAdd: () => applySelection() });

  // Rozkaz graficzny (T44): tryb zaznaczania i wskazywania oraz podgląd niewysłanych rozkazów.
  const order = createOrderMode({ store, controller, map, markers, root });
  createOrderPreview({ store, map });
  createOverlaysLayer({ store, map }); // T51: nakładki od przełożonego (włączane w panelu warstw)
  createCcirLayer({ store, controller, map }); // T48: nakładka CCIR i wskazywanie geometrii dla edytora
  createFiresLayer({ store, map }); // T52: warstwa „Ogień” (zgłoszenia i ich status)
  createEngineeringLayer({ store, map }); // T27: zapory, przejścia i mosty
  createTruthLayer({ store, map }); // T29: prawda o przeciwniku po bitwie

  const markerEl = (id) => markers.get(id)?.getElement();

  function applySelection() {
    const id = S().selection?.id ?? null;
    for (const [mid, m] of markers) m.getElement()?.classList.toggle('is-selected', mid === id);
    logistics.applySelection(id);
    order.applyMarks();
  }

  // Najechanie na wiersz drzewa albo symbol: jasna ramka; przełożony podświetla podwładnych i wzmacnia linie.
  function applyHover() {
    const hovered = S().hoverUnit;
    for (const [mid, m] of markers) m.getElement()?.classList.toggle('is-hov', mid === hovered);
    for (const k of unitList) markerEl(k.id)?.classList.toggle('is-child-hl', Boolean(hovered) && parentIdOf(k) === hovered);
    hierarchy.style(S().selection?.id ?? null, hovered);
  }

  function addSymbol(group, item, options, brief = '', extra = {}) {
    if (!Array.isArray(item.pos)) return null;
    const marker = L.marker(toLatLng(item.pos), { icon: symbolIcon(item.sidc, options), keyboard: false, ...extra });
    markers.set(item.id, marker);
    marker.on('add', () => {
      applySelection();
      applyHover();
    });
    const briefHtml = brief ? `<br><span class="sym-tip__brief">${escapeHtml(brief)}</span>` : '';
    marker.bindTooltip(`<strong>${escapeHtml(item.name || item.estimate || item.id)}</strong><br>${escapeHtml(describeSidc(item.sidc))}${briefHtml}`, {
      className: 'sym-tip',
      direction: 'top',
      offset: [0, -12],
    });
    marker.on('click', (ev) => {
      if (!order.handleMarkerClick(item.id, ev)) controller.selectEntity(item.id, { pan: false });
    });
    // Dwuklik na jednostce własnej otwiera jej kanał w komunikatorze.
    marker.on('dblclick', () => {
      if (S().turn?.units?.some((u) => u.id === item.id)) controller.openUnitChannel(item.id);
    });
    marker.on('mouseover', () => controller.hoverUnit(item.id));
    marker.on('mouseout', () => controller.hoverUnit(null));
    group.addLayer(marker);
    return marker;
  }

  // Ukrywa/pokazuje symbole jednostek wg poziomu szczegółowości i przerysowuje linie podporządkowania.
  function applyLevel() {
    const level = S().level;
    for (const u of unitList) {
      const m = markers.get(u.id);
      if (!m) continue;
      const visible = isUnitVisible(u, unitsById, level);
      if (visible && !situation.units.hasLayer(m)) situation.units.addLayer(m);
      else if (!visible && situation.units.hasLayer(m)) situation.units.removeLayer(m);
    }
    hierarchy.draw(unitList, level, markers);
    hierarchy.style(S().selection?.id ?? null, S().hoverUnit);
  }

  function renderTurn(turn) {
    for (const g of Object.values(situation)) g.clearLayers();
    markers.clear();
    logistics.clear();

    renderLines(situation.lines, turn?.lines);
    if (!turn) return;

    for (const c of turn.contacts || []) {
      const fr = contactFreshness(c, turn.time); // krycie wg typu i wieku informacji (T16)
      const age = fr.ageMin;
      const fade = fr.opacity;
      if (c.uncertainty_m && Array.isArray(c.pos)) {
        situation.contacts.addLayer(
          L.circle(toLatLng(c.pos), {
            radius: c.uncertainty_m,
            color: '#ff8080',
            weight: 1,
            dashArray: '5 4',
            opacity: 0.65 * fade + 0.1,
            fillColor: '#ff8080',
            fillOpacity: 0.07 * fade,
            interactive: false,
          }),
        );
      }
      addSymbol(situation.contacts, c, { size: 26, uniqueDesignation: c.id, dtg: age == null ? undefined : `${age} min` }, [contactBrief(c), fr.text].filter(Boolean).join(' · '), { opacity: fade, zIndexOffset: 100 });
    }

    unitList = turn.units || [];
    unitsById = indexById(unitList);
    for (const u of unitList) {
      const bft = bftStatus(u, turn.time, scenario.timezone); // pozycja BFT starsza niż próg: symbol przygaszony (T49)
      const brief = [unitBrief(u), isNeighbourUnit(u, unitsById) ? 'Sąsiad — brak dowodzenia' : '', bft.text].filter(Boolean).join(' · ');
      const comms = commsInfo(u, turn.time, scenario.timezone); // brak łączności / łączność słaba (T19): znacznik przy symbolu
      const marker = addSymbol(situation.units, u, { size: unitSize(u), uniqueDesignation: u.name }, [brief, comms.text].filter(Boolean).join(' · '), bft.stale ? { opacity: BFT_STALE_OPACITY } : {});
      if (marker && comms.status !== 'ok') {
        const mark = () => marker.getElement()?.classList.add('nocomms', `nocomms--${comms.status}`);
        marker.on('add', mark);
        mark();
      }
    }
    applyLevel();

    for (const a of turn.assets || []) {
      if (a.sidc) addSymbol(situation.assets, a, { size: 22, uniqueDesignation: a.name });
    }
    logistics.render(turn);
    applySelection();
    applyHover();
  }

  // ---------- polecenia przelotu ----------
  // Przelot do miejsca z gazetera i krótko żyjący pulsujący znacznik z nazwą (znika po ~4 s).
  let placeFlash = null;
  function flyToPlace(place) {
    const latlng = toLatLng(place.pos);
    map.flyTo(latlng, place.zoom ?? 12, { duration: 0.8 });
    if (placeFlash) placeFlash.remove();
    const icon = L.divIcon({
      className: 'place-flash',
      html: `<span class="place-flash__ring"></span><span class="place-flash__label">${escapeHtml(place.name)}</span>`,
      iconSize: [0, 0],
    });
    const marker = L.marker(latlng, { icon, interactive: false, keyboard: false }).addTo(map);
    placeFlash = marker;
    setTimeout(() => {
      marker.remove();
      if (placeFlash === marker) placeFlash = null;
    }, 4000);
  }

  function onFocus({ focus, turn }) {
    if (focus?.kind === 'place') flyToPlace(focus.place);
    else if (focus?.kind === 'entity') {
      const e = findEntity(turn, focus.id);
      const at = entityPos(e);
      if (at) map.panTo(toLatLng(at), { animate: true, duration: 0.4 });
    }
  }

  // „Pokaż wszystkie siły własne”: dopasowanie widoku do jednostek własnych (bez przełożonego i sąsiadów).
  function fitAll() {
    const { turn, channels } = S();
    const { own } = splitUnits(turn?.units || [], channels);
    const pts = own.filter((u) => Array.isArray(u.pos)).map((u) => toLatLng(u.pos));
    if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 0.5 });
  }

  // ---------- subskrypcje ----------
  store.subscribe(
    ['turn', 'animation'],
    ({ turn, animation }, changed) => {
      if (changed.has('turn')) {
        motion.stop();
        renderTurn(turn);
      }
      if (changed.has('animation') && animation) motion.start(animation);
    },
    { immediate: true },
  );
  store.subscribe('level', applyLevel);
  store.subscribe('basemap', syncBasemap, { immediate: true });
  store.subscribe('layers', syncLayers, { immediate: true });
  createEwZonesLayer({ store, map });
  createRangesLayer({ store, map }); // zasięgi ognia (T47)
  store.subscribe('selection', () => {
    applySelection();
    hierarchy.style(S().selection?.id ?? null, S().hoverUnit);
  });
  store.subscribe('hoverUnit', applyHover);
  store.subscribe('focus', onFocus);
  store.subscribe('command', ({ command }) => {
    if (command?.name === 'fit') fitAll();
  });

  // Położenie symbolu w pikselach kontenera mapy (albo null, gdy brak lub ukryty).
  function pointOf(id) {
    const m = markers.get(id);
    if (!m || !map.hasLayer(m)) return null;
    return map.latLngToContainerPoint(m.getLatLng());
  }

  createMapControls({ store, controller, map, root });

  return {
    // Powierzchnia mapy: współdzielony zasób renderowania przekazywany przez bootstrap widokom nakładek.
    surface: { map, pointOf },
    map,
    motion,
    fitAll,
  };
}
