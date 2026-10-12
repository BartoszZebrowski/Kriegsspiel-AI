// Walidacja statusu zgłoszenia ognia (T52): pole `fire` w wiadomościach inbox, odwołanie do zgłoszenia z outbox.
import { checkMessageFire } from '../shared/fire.js';

/** Zbiera zgłoszenia (outbox, form.kind „fire”) i sprawdza pole `fire` wiadomości; odwołania rozlicza `finishFireRefs`. */
export function createFireChecker(report) {
  const requests = new Set();
  const refs = [];
  return {
    check(kind, where, m) {
      if (kind === 'outbox' && m.form?.kind === 'fire' && m.id) requests.add(m.id);
      if (m.fire === undefined) return;
      if (kind !== 'inbox') return report.error(`${where}: pole fire jest tylko w wiadomościach sędziego (inbox)`);
      const err = checkMessageFire(m);
      if (err) report.error(`${where}: ${err}`);
      else refs.push([where, m.fire.request_id]);
    },
    finish() {
      for (const [where, id] of refs) if (!requests.has(id)) report.warn(`${where}: fire.request_id „${id}” nie wskazuje zgłoszenia ognia w outbox`);
    },
  };
}
