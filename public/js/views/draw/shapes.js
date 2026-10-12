// Warstwy kształtów szkiców na mapie: linie, strzałki, rejony, punkty, symbole i dekoracje znaków taktycznych (w pikselach, przeliczane po zoomie).
/* global L */
import { symbolIcon } from '../../lib/symbols.js';
import { describeSidc } from '../../domain/sidc.js';
import { escapeHtml } from '../../domain/markdown.js';
import { arrowHead, pathLengthKm, formatKm, toLatLng } from '../../domain/geo.js';
import { graphicInfo, buildGraphic, mainStyle, pointIconSvg } from '../../domain/tactical.js';
import { builtLayers } from '../../lib/tactical-layers.js';
import { COLORS, COLOR_NAMES, KIND_NAMES } from './graphics.js';

export function createShapes({ map }) {
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

  function popupHtml(note, readOnly) {
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
      for (const l of builtLayers(built, color, toLL)) add(l);
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

  // Czyści rejestry strzałek i dekoracji przed ponownym narysowaniem wszystkich szkiców.
  function reset() {
    arrowHeads.length = 0;
    tips.length = 0;
    decors.clear();
  }

  // Diagnostyka (?debug): koniec linii i czubek grotu każdej strzałki, w pikselach.
  const debugArrows = () => [
    ...arrowHeads.map(({ line, head }) => ({
      end: map.latLngToContainerPoint(line.getLatLngs().at(-1)),
      tip: map.latLngToContainerPoint(head.getLatLngs()[0][1]),
    })),
    ...tips.map(({ line, out }) => ({
      end: map.latLngToContainerPoint(line.getLatLngs().at(-1)),
      tip: out.tip ? map.layerPointToContainerPoint(L.point(out.tip.x, out.tip.y)) : null,
    })),
  ];

  return { noteLayer, popupHtml, headLatLngs, reset, debugArrows };
}
