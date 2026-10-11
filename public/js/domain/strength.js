// Stan osobowy i sprzęt: formatowanie i poziomy ukompletowania (czyste funkcje).

// Ukompletowanie 0–1 albo null, gdy brak etatu.
export function readinessRatio(current, authorized) {
  if (!Number.isFinite(current) || !Number.isFinite(authorized) || authorized <= 0) return null;
  return current / authorized;
}

// ≥ 80% dobry, 50–79% uwaga, < 50% zły
export function readinessLevel(ratio) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return null;
  if (ratio >= 0.8) return 'good';
  if (ratio >= 0.5) return 'warn';
  return 'bad';
}

// „610 / 650 (94%)”
export function formatStrength(current, authorized) {
  const r = readinessRatio(current, authorized);
  if (r === null) return String(current);
  return `${current} / ${authorized} (${Math.round(r * 100)}%)`;
}

// Liczba szacunkowa: „~30” albo „30”, gdy dokładna (approx === false).
export function formatEstimate(count, approx = true) {
  return (approx === false ? '' : '~') + count;
}

// „~30 BTR-82A”
export function formatEstimateEquipment(e) {
  return `${formatEstimate(e.count, e.approx)} ${e.name}`;
}

// „~800 żołn.”
export function formatEstimatePersonnel(p) {
  return `${formatEstimate(p.count, p.approx)} żołn.`;
}

// Skrót do podpowiedzi jednostki: „~610 żołn. · Leopard 2PL 41”
export function unitBrief(u) {
  const parts = [];
  if (u?.personnel && Number.isFinite(u.personnel.current)) parts.push(`~${u.personnel.current} żołn.`);
  const main = u?.equipment?.[0];
  if (main && Number.isFinite(main.current)) parts.push(`${main.name} ${main.current}`);
  return parts.join(' · ');
}

// Skrót do podpowiedzi kontaktu: „~800 żołn. · ~30 BTR-82A (szacunek)”
export function contactBrief(c) {
  const parts = [];
  if (c?.estimate_personnel) parts.push(formatEstimatePersonnel(c.estimate_personnel));
  const main = c?.estimate_equipment?.[0];
  if (main) parts.push(formatEstimateEquipment(main));
  return parts.length ? parts.join(' · ') + ' (szacunek)' : '';
}
