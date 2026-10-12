// Pomijanie szczebli dowodzenia (T45): ile szczebli pominięto, wydając rozkaz podwładnemu niżej niż bezpośrednio.
// Czyste funkcje (klient i serwer). Tryb: scenario.commandRules.skipEchelon = "off" | "soft" | "hard" (domyślnie "soft";
// lista i walidacja trybów: shared/schema.js — domain/ nie importuje z shared/, więc tu tylko porównania tekstów).
import { channelUnitId, mergeChannels, indexById, formationRootId } from './orbat.js';

export const DEFAULT_SKIP_ECHELON = 'soft';

/** Tryb z scenariusza; nieznana albo brakująca wartość = domyślny. */
export function skipEchelonMode(scenario) {
  const m = scenario?.commandRules?.skipEchelon;
  return m === 'off' || m === 'soft' || m === 'hard' ? m : DEFAULT_SKIP_ECHELON;
}

/**
 * Pominięte szczeble dla rozkazu do jednostki `unitId` (z `parent`). Bezpośredni podwładny gracza (jednostka, której
 * przełożony nie ma własnego przełożonego, np. batalion pod `hq`) = 0; kompania pod batalionem = 1; pluton = 2.
 * Jednostki sąsiadów (`formation`), przełożony i sąsiedzi (bez `parent`) = 0.
 * Zwraca { count, skipped: [jednostki pominiętych dowódców, od najbliższego] }.
 */
export function skippedEchelons(units, unitId) {
  const byId = indexById(units || []);
  const unit = byId.get(unitId);
  const none = { count: 0, skipped: [] };
  if (!unit || formationRootId(unit, byId)) return none;
  const skipped = [];
  const seen = new Set([unit.id]);
  let cur = unit;
  for (;;) {
    const p = cur.parent ? byId.get(cur.parent) : null;
    if (!p || !p.parent || seen.has(p.id)) break; // p to dowództwo gracza (bez przełożonego) albo koniec łańcucha
    skipped.push(p);
    seen.add(p.id);
    cur = p;
  }
  return { count: skipped.length, skipped };
}

/**
 * Ocena wiadomości do kanału. `channels` = kanały (jak w store; gdy brak, budowane z scenariusza i jednostek).
 * Zwraca { level: 'none' | 'warn' | 'block', count, skipped, text }:
 * - soft: `warn` przy count > 0 (nieblokujące ostrzeżenie),
 * - hard: `block` przy count > 0, a przy priority "urgent" `warn` (łączność alarmowa ma koszt jak w soft),
 * - off: zawsze `none`.
 */
export function assessSkip({ scenario, units, channels, channelId, priority } = {}) {
  const mode = skipEchelonMode(scenario);
  const none = { level: 'none', count: 0, skipped: [], text: '' };
  if (mode === 'off') return none;
  const chans = channels ?? mergeChannels(scenario?.channels, units || []);
  const channel = chans.find((c) => c.id === channelId);
  // Tylko kanały podwładnych (auto albo ze scenariusza) lub id jednostki bez kanału scenariuszowego.
  if (channel && channel.kind !== 'subordinate') return none;
  const unitId = channel ? channelUnitId(channel) : channelId;
  const { count, skipped } = skippedEchelons(units, unitId);
  if (!count) return none;
  const names = skipped.map((u) => u.name || u.id);
  const text = `pomijasz ${names.length > 1 ? 'dowódców' : 'dowódcę'} ${names.join(', ')}`;
  const level = mode === 'hard' && priority !== 'urgent' ? 'block' : 'warn';
  return { level, count, skipped, text };
}

/** Komunikat dla gracza: ostrzeżenie albo odmowa (hard). */
export function skipMessage(a) {
  if (!a || a.level === 'none') return '';
  return a.level === 'block'
    ? `Rozkaz poza łańcuchem dowodzenia — ${a.text}. Użyj kanału bezpośredniego podwładnego albo oznacz jako pilne (łączność alarmowa).`
    : `Uwaga: ${a.text}.`;
}
