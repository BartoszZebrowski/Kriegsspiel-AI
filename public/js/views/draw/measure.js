// Miarka: odległość po klikanych punktach i tabela czasu marszu (droga / teren). Działa też w archiwum.
/* global L */
import { pathLengthKm, marchTable, formatKm, formatMarch } from '../../domain/geo.js';
import { HINTS } from './graphics.js';
import { createRoadMeasure } from './roadmeasure.js';

// `isActive()` — czy narzędzie miarki jest wybrane; `onStop()` — prośba o zakończenie (Esc, dwuklik).
export function createMeasure({ map, toast, isActive, onStop, store, controller }) {
  const measureLayer = L.layerGroup().addTo(map);
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
  const road = store && controller ? createRoadMeasure({ map, store, controller }) : null; // T15: tryb „Po drogach”
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

  function start() {
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
    road?.clear();
  }

  const coordsOf = (latlngs) => latlngs.map((ll) => [ll.lng, ll.lat]);

  function onMeasureClick(e) {
    mPoints.push(e.latlng);
    mLine.setLatLngs(mPoints);
    L.circleMarker(e.latlng, { radius: 4.5, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(measureLayer);
    measureBox.show(coordsOf(mPoints));
    road?.update(coordsOf(mPoints));
  }

  function onMeasureMove(e) {
    if (mPoints.length === 0) return;
    if (e.originalEvent?.target?.closest?.('.leaflet-control')) return; // nad panelami miarki nie aktualizuj odcinka (box by skakał)
    const last = mPoints.at(-1);
    mPreview.setLatLngs([last, e.latlng]);
    const seg = pathLengthKm(coordsOf([last, e.latlng]));
    measureBox.show(coordsOf([...mPoints, e.latlng]), seg);
  }

  function onMeasureEnd() {
    if (isActive()) onStop();
  }

  function onMeasureKey(e) {
    if (e.key === 'Escape') onMeasureEnd();
  }

  function end() {
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

  const clear = () => {
    measureLayer.clearLayers();
    measureBox.hide();
    road?.clear();
  };
  return { start, end, clear, hasContent: () => measureLayer.getLayers().length > 0 };
}
