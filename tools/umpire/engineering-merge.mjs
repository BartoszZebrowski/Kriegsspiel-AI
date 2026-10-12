// Obiekty inżynieryjne w turze (T27): dziedziczenie z tury N, łatki planu i widok gracza. Wołane z turn.mjs.
//
// Prawda (`umpire/turns`, pole `engineering`): pełny stan, strona w `owner` ('PL', 'RU'…), pola dodatkowe sędziego
// (`changed_at`, `changed_by`, `started`, `until`…). Plan: `plan.engineering = { set: [obiekty], patch: { id: {pola} }, remove: [id] }`.
// Widok gracza (`player/turns`, pole `engineering`): (a) obiekty strony gracza z prawdy (owner → 'own', same pola białej listy),
// (b) obiekty przeciwnika wyłącznie z rozpoznania: dziedziczone z tury N gracza i zmieniane `plan.player.engineering`
// (`set` z `owner: "enemy"`, `observed`, `source`; `remove`). Most stały, który jest już w `logistics.bridges`, nie dubluje się w widoku.
import { PLAYER_FIELDS } from '../../shared/schema.js';
import { checkEngineering, BRIDGE_STATES } from '../../shared/engineering.js';
import { clone, pickFields } from './turn-merge.mjs';

function applyList(list, ch, label, warnings) {
  const map = new Map(list.map((x) => [x.id, clone(x)]));
  for (const id of ch?.remove ?? []) if (!map.delete(id)) warnings.push(`plan: usuwany obiekt inżynieryjny "${id}" (${label}) nie istnieje`);
  for (const [id, p] of Object.entries(ch?.patch ?? {})) {
    if (!map.has(id)) warnings.push(`plan: łatka obiektu inżynieryjnego "${id}" (${label}) nie istnieje`);
    else map.set(id, { ...map.get(id), ...clone(p) });
  }
  for (const x of ch?.set ?? []) map.set(x.id, clone(x));
  return [...map.values()];
}

/**
 * @returns {{ umpire: object[]|undefined, player: object[]|undefined, bridgeStates: Record<string,string>, ownBridgeStates: Record<string,string>, warnings: string[] }}
 * `bridgeStates` — stan mostów stałych z prawdy (id → intact|damaged|destroyed), do synchronizacji z `logistics.bridges` sędziego;
 * `ownBridgeStates` — tylko mosty strony gracza (jego saperzy wiedzą od razu; resztę gracz poznaje z meldunków, planem `logistics`).
 */
export function applyEngineering({ prevUmpire, prevPlayer, plan = {}, playerSide = 'PL', time, logisticsBridgeIds = new Set() }) {
  const warnings = [];
  const truthPrev = prevUmpire?.engineering;
  const playerPrev = prevPlayer?.engineering;
  const hasPlan = plan.engineering !== undefined || plan.player?.engineering !== undefined;
  if (truthPrev === undefined && playerPrev === undefined && !hasPlan) return { umpire: undefined, player: undefined, bridgeStates: {}, ownBridgeStates: {}, warnings };

  const truth = applyList(truthPrev || [], plan.engineering, 'prawda', warnings);
  const t = checkEngineering(truth, { player: false, turnTime: time });
  warnings.push(...t.errors.map((e) => `sędzia ${e}`), ...t.warnings.map((w) => `sędzia ${w}`));

  const bridgeStates = {};
  const ownBridgeStates = {};
  for (const x of truth) {
    if (x.kind !== 'bridge' || !BRIDGE_STATES.includes(x.state)) continue;
    bridgeStates[x.id] = x.state;
    if (x.owner === playerSide) ownBridgeStates[x.id] = x.state;
  }

  const own = truth
    .filter((x) => x.owner === playerSide && !(x.kind === 'bridge' && logisticsBridgeIds.has(x.id)))
    .map((x) => ({ ...pickFields(x, PLAYER_FIELDS.engineering), owner: 'own' }));
  const enemyPrev = (playerPrev || []).filter((x) => x.owner === 'enemy');
  const enemy = applyList(enemyPrev, plan.player?.engineering, 'gracz', warnings);
  for (const x of enemy) if (x.owner !== 'enemy') warnings.push(`plan.player.engineering "${x.id}": obiekt strony gracza bierze się z prawdy (owner: "enemy" tylko dla przeciwnika)`);
  const player = [...own, ...enemy.filter((x) => x.owner === 'enemy').map((x) => pickFields(x, PLAYER_FIELDS.engineering))];
  const p = checkEngineering(player, { player: true, turnTime: time });
  warnings.push(...p.errors.map((e) => `gracz ${e}`), ...p.warnings.map((w) => `gracz ${w}`));

  return { umpire: truth, player, bridgeStates, ownBridgeStates, warnings };
}

/** Stan mostu → `status` w `logistics.bridges` (zmienia routing T15 / T17); mutuje `logistics`. */
export function syncBridgeStatus(logistics, bridgeStates, time) {
  if (!logistics?.bridges) return;
  for (const b of logistics.bridges) {
    const st = bridgeStates[b.id];
    if (st && b.status !== st) { b.status = st; b.as_of = time; }
  }
}
