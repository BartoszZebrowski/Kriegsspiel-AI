// Warstwa logistyczna (T17): elementy z `turn.logistics` (składy, trasy MSR/ASR, mosty, konwoje), model karty
// inspektora i wiek danych. Czyste funkcje bez DOM i Leaflet (testowane w Node). Format: docs/SCHEMA.md → `logistics`.
import { escapeHtml } from './markdown.js';
import { formatAge, formatClock } from './format.js';
import { pathLength, pointAt } from './motion.js';

const e = escapeHtml;

export const LOGISTICS_KINDS = ['depot', 'route', 'bridge', 'convoy'];
const LISTS = { depots: 'depot', routes: 'route', bridges: 'bridge', convoys: 'convoy' };
export const KIND_LABELS = { depot: 'Skład', route: 'Trasa zaopatrzenia', bridge: 'Most', convoy: 'Konwój' };

// Etykiety i poziom (ok / warn / bad / neutral) statusów — pokrywają enumy z shared/schema.js.
export const STATUS_INFO = {
  depot: { operational: ['czynny', 'ok'], limited: ['ograniczony', 'warn'], destroyed: ['zniszczony', 'bad'] },
  route: { open: ['przejezdna', 'ok'], threatened: ['zagrożona', 'warn'], closed: ['zamknięta', 'bad'] },
  bridge: { intact: ['cały', 'ok'], damaged: ['uszkodzony', 'warn'], destroyed: ['zburzony', 'bad'] },
  convoy: { planned: ['planowany', 'neutral'], moving: ['w marszu', 'ok'], halted: ['zatrzymany', 'warn'], delayed: ['opóźniony', 'warn'], destroyed: ['zniszczony', 'bad'], arrived: ['dotarł', 'ok'] },
};
export const ROUTE_COLORS = { open: '#43b581', threatened: '#e8b339', closed: '#ef4444' };
// Symbole NATO (SIDC) składu i konwoju: zaopatrzenie / transport. Jedyne źródło dla mapy i inspektora.
export const LG_SIDC = { depot: 'SFGPUSS--------', convoy: 'SFGPUST--------' };
export const ROUTE_FALLBACK_COLOR = '#9aa5b1';

export const statusInfo = (kind, status) => {
  const [label, level] = STATUS_INFO[kind]?.[status] || [status || '—', 'neutral'];
  return { label, level };
};
export const routeColor = (status) => ROUTE_COLORS[status] || ROUTE_FALLBACK_COLOR;

const isCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);

// Płaska lista elementów tury: [{ kind, item }] (kolejność: składy, trasy, mosty, konwoje).
export function logisticsElements(turn) {
  const l = turn?.logistics;
  if (!l || typeof l !== 'object') return [];
  const out = [];
  for (const [list, kind] of Object.entries(LISTS)) for (const item of Array.isArray(l[list]) ? l[list] : []) if (item && item.id) out.push({ kind, item });
  return out;
}

export function findLogisticsItem(turn, id) {
  if (!id) return null;
  return logisticsElements(turn).find((x) => x.item.id === id) || null;
}

// Punkt reprezentujący element: `pos`, a dla trasy środek jej długości (do centrowania mapy).
export function logisticsPos(kind, item) {
  if (kind === 'route') return Array.isArray(item.coords) && item.coords.every(isCoord) && item.coords.length >= 2 ? pointAt(item.coords, 0.5) : null;
  return isCoord(item.pos) ? item.pos : null;
}

// Wiek danych względem czasu tury: { ageMin, stale }. Dane starsze niż 1 turę (turnMinutes) są nieaktualne;
// brak `as_of` (np. trasa) → wiek nieznany, bez oznaczenia „nieaktualne”.
export function dataAge(asOf, turnTime, turnMinutes = 120) {
  const diff = asOf && turnTime ? (new Date(turnTime).getTime() - new Date(asOf).getTime()) / 60000 : NaN;
  if (Number.isNaN(diff)) return { ageMin: null, stale: false };
  const ageMin = Math.max(0, Math.floor(diff));
  return { ageMin, stale: ageMin > turnMinutes };
}

const tons = (v) => (Number.isFinite(v) ? `${v} t` : '—');
const cargoText = (c) => (c ? `paliwo ${tons(c.fuel)} · amunicja ${tons(c.ammo)} · ogólne ${tons(c.general)}` : '');

// Model karty (czysta funkcja): { kind, kindLabel, id, title, status, statusLabel, level, asOf, ageMin, stale, ageLabel, rows:[[etykieta, wartość]], notes }.
// ctx: { turnTime, turnMinutes, tz }.
export function logisticsCard(kind, item, ctx = {}) {
  const { label, level } = statusInfo(kind, item.status);
  const { ageMin, stale } = dataAge(item.as_of, ctx.turnTime, ctx.turnMinutes);
  const rows = [];
  if (kind === 'depot') {
    rows.push(['Paliwo', tons(item.stock?.fuel)], ['Amunicja', tons(item.stock?.ammo)], ['Zaopatrzenie ogólne', tons(item.stock?.general)]);
  } else if (kind === 'route') {
    rows.push(['Rodzaj', item.kind === 'MSR' ? 'MSR (główna trasa zaopatrzenia)' : item.kind === 'ASR' ? 'ASR (zapasowa trasa zaopatrzenia)' : item.kind || '—']);
    if (Array.isArray(item.coords) && item.coords.every(isCoord)) rows.push(['Długość', `${pathLength(item.coords).toFixed(1)} km`]);
  } else if (kind === 'bridge') {
    if (Number.isFinite(item.mlc)) rows.push(['Nośność (MLC)', `${item.mlc} t`]);
  } else if (kind === 'convoy') {
    rows.push(['Z', item.from || '—'], ['Do', item.to || '—'], ['Ładunek', cargoText(item.cargo)]);
    if (item.eta) rows.push(['Przewidywane dotarcie', ctx.tz ? formatClock(item.eta, ctx.tz) : item.eta]);
  }
  return {
    kind,
    kindLabel: KIND_LABELS[kind] || kind,
    id: item.id,
    title: item.name || item.id,
    status: item.status,
    statusLabel: label,
    level,
    asOf: item.as_of || null,
    ageMin,
    stale,
    ageLabel: item.as_of && ctx.turnTime ? formatAge(item.as_of, ctx.turnTime) : '',
    rows: rows.filter(([, v]) => v !== '' && v !== undefined),
    notes: item.notes || '',
  };
}

// HTML karty z modelu (dla inspektora).
export function logisticsCardHtml(m, ctx = {}) {
  const kv = m.rows.map(([k, v]) => `<div class="kvr"><span>${e(k)}</span><span>${e(v)}</span></div>`).join('');
  const clock = m.asOf && ctx.tz ? formatClock(m.asOf, ctx.tz) : '';
  const asOf = m.asOf
    ? `<div class="kvr"><span>Stan na</span><span class="mono">${e(clock || m.asOf)}${m.ageLabel ? ` <span class="age">· ${e(m.ageLabel)}</span>` : ''}</span></div>`
    : `<div class="kvr"><span>Stan na</span><span class="muted">brak daty meldunku</span></div>`;
  const stale = m.stale ? `<div class="lg-stale" data-stale="1" role="note"><b>Dane nieaktualne</b> — starsze niż 1 tura. Stan faktyczny może być inny.</div>` : '';
  return `<div class="card lg-card" data-lg-kind="${e(m.kind)}"><div class="kv"><div class="cap">${e(m.kindLabel)}</div>
    <div class="kvr"><span>Stan</span><span><span class="lg-st lg-st--${e(m.level)}">${e(m.statusLabel)}</span></span></div>${kv}${asOf}${m.notes ? `<div class="kvr"><span>Uwagi</span><span>${e(m.notes)}</span></div>` : ''}</div>${stale}</div>`;
}
