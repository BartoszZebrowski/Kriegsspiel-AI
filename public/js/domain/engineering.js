// Wojska inżynieryjne (T27): czysta logika widoku obiektów inżynieryjnych (zapory, przejścia, mosty) z `turn.engineering`.
// Stałe lustrzane do shared/engineering.js (domain/ nie importuje z shared/). Bez DOM.
import { formatAge } from './format.js';

export const ENGINEERING_LAYER = 'engineering';
export const WORK_STATE_LABELS = { planned: 'planowane', building: 'wykonywane', done: 'gotowe' };
export const BRIDGE_STATE_LABELS = { intact: 'cały', damaged: 'uszkodzony', destroyed: 'zburzony' };
export const KIND_NAMES = {
  minefield: 'Pole minowe',
  obstacle: 'Linia zapór',
  lane: 'Przejście w zaporze',
  temp_bridge: 'Most składany / pontonowy',
  bridge: 'Most',
};
// Rodzaj → jak rysować: znak taktyczny z domain/tactical.js (area/line + graphic) albo znacznik punktowy.
export const KIND_GRAPHICS = {
  minefield: { kind: 'area', graphic: 'minefield' },
  obstacle: { kind: 'line', graphic: 'obstacle_line' },
  lane: { kind: 'line', graphic: 'line' },
  temp_bridge: { point: true },
  bridge: { point: true },
};
export const OWN_COLOR = '#2f7bff';
export const ENEMY_COLOR = '#ff2a2a';

/** Poprawne obiekty z tury: mają znany rodzaj i geometrię (punkt `pos` albo `coords`). */
export function engineeringItems(turn) {
  return (turn?.engineering || []).filter((x) => KIND_GRAPHICS[x?.kind] && (KIND_GRAPHICS[x.kind].point ? Array.isArray(x.pos) : Array.isArray(x.coords) && x.coords.length >= 2));
}

export const isEnemyWork = (x) => x?.owner === 'enemy';

/** Stan po polsku: „wykonywane 60%”, „gotowe”, „zburzony”. */
export function engineeringStateText(x) {
  const labels = x.kind === 'bridge' ? BRIDGE_STATE_LABELS : WORK_STATE_LABELS;
  const base = labels[x.state] || x.state || '';
  return x.state === 'building' && Number.isFinite(x.progress) ? `${base} ${Math.round(x.progress)}%` : base;
}

/** Nazwa obiektu: `label` albo nazwa rodzaju. */
export const engineeringName = (x) => x.label || KIND_NAMES[x.kind] || x.kind;

/** Etykieta na mapie: „ZAPORA-1: wykonywane 60%”. */
export const engineeringLabel = (x) => `${engineeringName(x)}: ${engineeringStateText(x)}`;

/** Ton stanu do kolorowania: ok / warn / bad / plan. */
export function engineeringTone(x) {
  if (x.kind === 'bridge') return { intact: 'ok', damaged: 'warn', destroyed: 'bad' }[x.state] || 'plan';
  return { planned: 'plan', building: 'warn', done: 'ok' }[x.state] || 'plan';
}

/** Wiersze podpowiedzi (tekst bez HTML): rodzaj, stan, jednostka, wiek meldunku dla obiektów przeciwnika. */
export function engineeringTip(x, turnTime) {
  const rows = [`${KIND_NAMES[x.kind] || x.kind} — ${engineeringStateText(x)}`];
  if (x.unit) rows.push(`Wykonuje: ${x.unit}`);
  if (isEnemyWork(x)) {
    const age = x.observed && turnTime ? formatAge(x.observed, turnTime) : '';
    rows.push(`Przeciwnika${x.confidence ? `, pewność ${x.confidence}` : ''}${age ? `, meldunek ${age}` : ''}${x.source ? ` (${x.source})` : ''}`);
  }
  return rows;
}
