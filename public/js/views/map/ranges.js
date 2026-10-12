// Warstwa zasięgów ognia na mapie (T47): pierścienie zaznaczonej jednostki / kontaktu wg rodzaju broni oraz tryb
// „wszystkie jednostki” dla wybranego rodzaju (warstwy `range:<rodzaj>` w panelu Warstwy). Własna L.layerGroup,
// subskrypcja store; kontakty wroga rysowane przerywaną linią z szacunku (+ obwódka niepewności położenia).
// Mały panel z przełącznikami rodzajów i legendą kolorów jest częścią tego widoku (DOM budowany tutaj).
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { formatRange } from '../../domain/equipment.js';
import { findEntity } from '../../domain/entities.js';
import { RANGE_KINDS, rangeColor, rangeKindLabel, allLayerKey, entityRanges, coverageRings } from '../../domain/ranges.js';

export function createRangesLayer({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();
  const off = new Set(); // wyłączone (lokalnie) rodzaje pierścieni zaznaczenia

  const panel = document.createElement('div');
  panel.className = 'float range-panel';
  panel.id = 'range-panel';
  panel.hidden = true;
  map.getContainer().parentElement.appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);

  function selectionRings() {
    const { turn, selection, equipment } = S();
    const entity = selection ? findEntity(turn, selection.id) : null;
    return { entity, rings: entityRanges(entity, turn, equipment) };
  }

  function drawSelection(entity, rings, catalog) {
    const center = toLatLng(entity.item.pos);
    const contact = entity.kind === 'contact';
    for (const r of rings) {
      if (off.has(r.kind)) continue;
      const color = rangeColor(r.kind);
      const label = `${rangeKindLabel(r.kind, catalog)}: ${formatRange(r.range_m)} (${r.weapon})${contact ? ' — szacunek' : ''}`;
      const circle = L.circle(center, { radius: r.range_m, color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.04, dashArray: contact ? '8 6' : null, interactive: false });
      circle.bindTooltip(escapeHtml(label), { sticky: true, className: 'sym-tip' });
      group.addLayer(circle);
      // Kontakt: zewnętrzna obwódka = zasięg + niepewność położenia (wróg może stać dalej, niż zameldowano).
      if (contact && r.uncertainty_m > 0) {
        group.addLayer(L.circle(center, { radius: r.range_m + r.uncertainty_m, color, weight: 1, opacity: 0.5, dashArray: '2 6', fill: false, interactive: false }));
      }
    }
  }

  function drawCoverage(kind, catalog) {
    const color = rangeColor(kind);
    for (const r of coverageRings(S().turn?.units, catalog, kind, S().level)) {
      const circle = L.circle(toLatLng(r.pos), { radius: r.range_m, color, weight: 1, opacity: 0.55, fillColor: color, fillOpacity: 0.07, interactive: false });
      circle.bindTooltip(escapeHtml(`${r.name}: ${rangeKindLabel(kind, catalog)} ${formatRange(r.range_m)} (${r.weapon})`), { sticky: true, className: 'sym-tip' });
      group.addLayer(circle);
    }
  }

  function renderPanel(rings, entity, coverageKinds, catalog) {
    const chip = (kind, extra, on) =>
      `<button type="button" class="rp-chip${on ? ' on' : ''}" data-kind="${escapeHtml(kind)}" style="--rc:${rangeColor(kind)}" title="${escapeHtml(rangeKindLabel(kind, catalog))}"><i></i>${escapeHtml(RANGE_KINDS.find((k) => k.kind === kind)?.short ?? kind)}${extra}</button>`;
    const contact = entity?.kind === 'contact';
    let html = '';
    if (rings.length) {
      html += `<div class="rp-h">Zasięg ognia${contact ? ' <span class="rp-est">szacunek, linia przerywana</span>' : ''}</div><div class="rp-row">`;
      html += rings.map((r) => chip(r.kind, ` <small>${escapeHtml(formatRange(r.range_m))}</small>`, !off.has(r.kind))).join('');
      html += '</div>';
    }
    if (coverageKinds.length) {
      html += `<div class="rp-h">Pokrycie wszystkich jednostek</div><div class="rp-row">${coverageKinds.map((k) => chip(k, '', true).replace('rp-chip', 'rp-chip rp-static')).join('')}</div>`;
    }
    panel.innerHTML = html;
    panel.hidden = !html;
  }

  function render() {
    group.clearLayers();
    const { layers, equipment: catalog } = S();
    if (!catalog) return renderPanel([], null, [], null);
    const { entity, rings } = selectionRings();
    if (entity && rings.length && Array.isArray(entity.item.pos)) drawSelection(entity, rings, catalog);
    const coverageKinds = RANGE_KINDS.map((k) => k.kind).filter((k) => layers[allLayerKey(k)]);
    for (const k of coverageKinds) drawCoverage(k, catalog);
    renderPanel(rings, entity, coverageKinds, catalog);
  }

  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('.rp-chip:not(.rp-static)');
    if (!b) return;
    const kind = b.dataset.kind;
    if (off.has(kind)) off.delete(kind);
    else off.add(kind);
    render();
  });

  store.subscribe(['turn', 'selection', 'equipment', 'layers', 'level'], render, { immediate: true });
  return { group, render };
}
