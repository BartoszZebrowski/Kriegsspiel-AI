// Zgłoszenia ognia i ich status (T52). Czysta logika (bez DOM): cykl wysłane → przyjęte / odmowa → wykonane,
// zadania ogniowe z wiadomości (zgłoszenie = outbox z form.kind „fire”, status = inbox z polem `fire`).
// Status NIE zawiera skutku ognia — gracz poznaje go z obserwacji i meldunków. Format: shared/fire.js (lustro stałych).
import { mgrsOf } from './mgrs.js';
import { formatClock } from './format.js';

export const FIRE_STATUS = { SENT: 'sent', ACCEPTED: 'accepted', REFUSED: 'refused', DONE: 'done' };
export const FIRE_STATUS_LABELS = { sent: 'wysłane', accepted: 'przyjęte', refused: 'odmowa', done: 'wykonane' };
export const FIRE_STATUS_COLORS = { sent: '#9ca3af', accepted: '#facc15', refused: '#ef4444', done: '#43b581' };

// Dozwolone przejścia (wykonanie bez osobnego „przyjęto” jest możliwe); odmowa i wykonanie są końcowe.
const NEXT = { sent: ['accepted', 'refused', 'done'], accepted: ['done'], refused: [], done: [] };
export const canTransition = (from, to) => (NEXT[from] ?? []).includes(to);

const timeOf = (iso) => Date.parse(iso) || 0;

/** Zadania ogniowe z listy wiadomości klienta (`direction` in/out). Najwcześniejsze zgłoszenia najpierw. */
export function fireTasks(messages) {
  const tasks = new Map();
  for (const m of messages ?? []) {
    if (m.direction === 'out' && m.form?.kind === 'fire' && m.id) {
      const f = m.form.fields ?? {};
      tasks.set(m.id, {
        id: m.id,
        channel: m.channel,
        time: m.time,
        target: f.target ?? null,
        targetKind: f.targetKind ?? '',
        effect: f.effect ?? '',
        priority: f.priority ?? '',
        support: f.support ?? '',
        status: FIRE_STATUS.SENT,
        statusTime: m.time,
        rounds: null,
        reason: '',
      });
    }
  }
  const replies = (messages ?? []).filter((m) => m.direction === 'in' && m.fire && tasks.has(m.fire.request_id));
  replies.sort((a, b) => timeOf(a.fire.time) - timeOf(b.fire.time));
  for (const m of replies) {
    const t = tasks.get(m.fire.request_id);
    if (!canTransition(t.status, m.fire.status)) continue;
    t.status = m.fire.status;
    t.statusTime = m.fire.time;
    t.rounds = m.fire.rounds ?? null;
    t.reason = m.fire.reason ?? '';
  }
  return [...tasks.values()].sort((a, b) => timeOf(a.time) - timeOf(b.time));
}

/** Punkt znacznika: sam punkt albo środek rejonu ([długość, szerokość]); brak celu → null. */
export function fireAnchor(target) {
  if (!target || typeof target !== 'object') return null;
  if (target.type === 'Point') return target.coordinates;
  if (target.type === 'Polygon') {
    const ring = target.coordinates[0].slice(0, -1);
    if (!ring.length) return null;
    return [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  }
  return null;
}

const hhmm = formatClock;

/** Opis statusu: „przyjęte 08:12”, „odmowa 08:12 (powód)”, „wykonane 08:20, 12 pocisków, skutek nieznany”. */
export function fireStatusText(task, tz) {
  const at = hhmm(task.statusTime, tz);
  if (task.status === 'refused') return `odmowa ${at}${task.reason ? ` (${task.reason})` : ''}`;
  if (task.status === 'done') return `wykonane ${at}${task.rounds != null ? `, ${task.rounds} pocisków` : ''}, skutek nieznany`;
  return `${FIRE_STATUS_LABELS[task.status]} ${at}`;
}

/** Krótka etykieta znacznika: „08:05 · przyjęte”. */
export const fireLabel = (task, tz) => `${hhmm(task.time, tz)} · ${FIRE_STATUS_LABELS[task.status]}`;

/** Opis celu do podpowiedzi: „czołgi (zniszczenie), MGRS”. */
export function fireDescription(task) {
  const a = fireAnchor(task.target);
  const where = a ? mgrsOf(a, 4) ?? `${a[0].toFixed(4)}, ${a[1].toFixed(4)}` : '';
  return [task.targetKind, task.effect && `(${task.effect})`, where && `— ${where}`].filter(Boolean).join(' ');
}
