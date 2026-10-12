// Inspektor: sekcje jednostek, kontaktów i środków rozpoznania (HTML) — pokazywane w lewym doku.
// Czyste funkcje: symbol SVG dostarcza wołający (`ctx.symbolOf`), bo milsymbol to biblioteka przeglądarkowa.
import { describeSidc } from './sidc.js';
import { formatAge, formatClock } from './format.js';
import { escapeHtml } from './markdown.js';
import { formatDms, mgrsOf } from './mgrs.js';
import { dosIndicators, dosAgeMin, isDosStale, formatDosValue, dosBarPct } from './dos.js';
import { echelonRank, PLATOON_RANK } from './orbat.js';
import { groupEquipment, subordinateTotals, portableSummary, OTHER_CATEGORY } from './equipment.js';
import { bftStatus } from './bft.js';
import { fatigueBlock } from './fatigue.js';
import { contactFreshness } from './contactage.js';
import { formatStrength, readinessRatio, readinessLevel, formatEstimateEquipment, formatEstimatePersonnel } from './strength.js';

const e = escapeHtml;
const noSymbol = () => '';

export function row(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="kvr"><span>${e(label)}</span><span>${e(value)}</span></div>`;
}

// Klasa paska siły: '' (dobra), 'warn', 'bad' — progi z strength.js (≥ 80% / 50–79% / < 50%).
export function meterClass(ratio) {
  const level = readinessLevel(ratio);
  return level === 'warn' ? 'warn' : level === 'bad' ? 'bad' : '';
}

const pct = (r) => Math.max(0, Math.min(100, Math.round(r * 100)));

// Nagłówek inspektora: symbol 52×52, nazwa, pełna nazwa, SIDC, chip statusu.
export function inspectorHead({ symbol = '', title, sub = '', sidc = '', status = '', ratio = null }) {
  const dot = meterClass(ratio);
  const style = dot === 'warn' ? ' style="background:var(--warn)"' : dot === 'bad' ? ' style="background:var(--danger)"' : '';
  return `<div class="insp-top"><div class="insp-sym">${symbol}</div><div class="insp-info">
    <div class="insp-title">${e(title)}</div>${sub ? `<div class="insp-sub">${e(sub)}</div>` : ''}
    ${sidc ? `<div class="insp-sidc">${e(sidc)}</div>` : ''}${status ? `<div class="chip-st"><i${style}></i>${e(status)}</div>` : ''}</div></div>`;
}

// Chip jednostki (klik zaznacza): miniatura + nazwa.
export function unitChip(u, symbolOf = noSymbol) {
  return `<span class="uchip" role="button" tabindex="0" data-unit="${e(u.id)}">${symbolOf(u.sidc, 16)}${e(u.name || u.id)}</span>`;
}

function personnelBlock(u, ctx) {
  const stamp = ctx.turnTime ? `<span class="grow"></span><span class="mono stamp">stan na ${e(formatClock(ctx.turnTime, ctx.tz))}</span>` : '';
  let body;
  if (u.personnel) {
    const r = readinessRatio(u.personnel.current, u.personnel.authorized) ?? 0;
    body = `<div class="bignum">${e(u.personnel.current)}<small>/ ${e(u.personnel.authorized)} · ${pct(r)}%</small></div>
      <div class="meter ${meterClass(r)}" title="${e(formatStrength(u.personnel.current, u.personnel.authorized))}"><i style="width:${pct(r)}%"></i></div>`;
  } else if (typeof u.strength === 'number') {
    body = `<div class="bignum">${pct(u.strength)}<small>% ukompletowania</small></div><div class="meter ${meterClass(u.strength)}"><i style="width:${pct(u.strength)}%"></i></div>`;
  } else return '';
  return `<div class="kv"><div class="cap">Stan osobowy${stamp}</div>${body}</div>`;
}

function eqRow(q) {
  const r = readinessRatio(q.current, q.authorized) ?? 0;
  return `<div class="eqr"><span class="n" title="${e(q.name)}">${e(q.name)}</span><div class="meter ${meterClass(r)}"><i style="width:${pct(r)}%"></i></div><span class="v">${e(q.current)}/${e(q.authorized)}</span></div>`;
}

// Zasięgi broni pozycji katalogu: „armata 120 mm L/55 · 4 km · przeciwpancerna”. `approx` = szacunek wroga.
function weaponsLine(weapons, approx = false) {
  if (!weapons?.length) return '';
  const items = weapons.map((w) => `<span class="w-${e(w.kind)}">${e(w.name)} <b>${approx ? '~' : ''}${e(w.range)}</b> <i>${e(w.label)}</i></span>`).join('');
  return `<div class="eq-w${approx ? ' est' : ''}">${items}</div>`;
}

// Sprzęt jednostki: bez katalogu (albo bez `ref`) płaska lista „Główny sprzęt”; z `ref` grupy wg kategorii z zasięgami
// i sumą z podwładnych (ctx.catalog, ctx.units), a dla plutonu i niżej także uzbrojenie drużyn.
function equipmentBlock(u, ctx = {}) {
  const list = u.equipment;
  if (!list?.length) return '';
  const groups = groupEquipment(list, ctx.catalog);
  if (groups.every((g) => g.category === OTHER_CATEGORY)) return `<div class="kv"><div class="cap">Główny sprzęt</div>${list.map(eqRow).join('')}</div>`;
  const totals = subordinateTotals(ctx.units, u.id);
  const body = groups
    .map((g) => {
      const rows = g.rows
        .map((q) => {
          const t = totals.get(q.key);
          const sub = t ? `<div class="eq-sub" title="Suma z podwładnych">podwładni: ${e(t.current)}/${e(t.authorized)}</div>` : '';
          return eqRow(q) + sub + weaponsLine(q.weapons);
        })
        .join('');
      return `<div class="eq-cat" data-eq-cat="${e(g.category)}">${e(g.category)}</div>${rows}`;
    })
    .join('');
  const squads = echelonRank(u) >= 0 && echelonRank(u) <= PLATOON_RANK ? portableSummary(list, ctx.catalog) : '';
  const squadLine = squads ? `<div class="kvr eq-squads"><span>Uzbrojenie drużyn</span><span>${e(squads)}</span></div>` : '';
  return `<div class="kv" data-equipment><div class="cap">Wyposażenie</div>${body}${squadLine}</div>`;
}

// Sekcja DOS (T18): paski w kolorach progu + wiek meldunku. `view` = wynik resolveDos ({dos, derived}) albo null.
export function dosBlock(view, ctx = {}) {
  if (!view) return '';
  const { dos, derived } = view;
  const age = dosAgeMin(dos, ctx.turnTime);
  const stale = isDosStale(dos, ctx.turnTime);
  const stamp = dos.as_of ? `<span class="grow"></span><span class="mono stamp${stale ? ' age' : ''}" data-dos-age>meldunek ${e(formatClock(dos.as_of, ctx.tz))}${age !== null ? ` · ${e(formatAge(dos.as_of, ctx.turnTime))}` : ''}</span>` : '';
  const rows = dosIndicators(dos)
    .map((i) => `<div class="eqr dosb" data-dos="${i.kind}" data-level="${i.level}"><span class="n">${e(i.label)}</span><div class="meter ${i.level === 'ok' ? '' : i.level}"><i style="width:${dosBarPct(i.kind, i.value)}%"></i></div><span class="v">${e(formatDosValue(i.kind, i.value))}</span></div>`)
    .join('');
  const note = derived ? `<div class="muted dos-note">Wyliczone: minimum z podwładnych (jednostka nie meldowała własnego DOS).</div>` : '';
  return `<div class="kv" data-dos-block><div class="cap">Zaopatrzenie · DOS${derived ? '<span class="pill">WYLICZONE</span>' : ''}${stamp}</div>${rows}${note}</div>`;
}

function positionBlock(pos, extraRows) {
  const copy = (text) => `<button type="button" class="ibtn copy" data-copy="${e(text)}" title="Kopiuj" aria-label="Kopiuj">⧉</button>`;
  const dms = Array.isArray(pos) ? formatDms(pos) : '';
  const mgrs = mgrsOf(pos) || '';
  return `${extraRows}${dms ? `<div class="kvr"><span>Pozycja</span><span class="mono sm">${e(dms)} ${copy(dms)}</span></div>` : ''}${mgrs ? `<div class="kvr"><span>MGRS</span><span class="mono sm">${e(mgrs)} ${copy(mgrs)}</span></div>` : ''}`;
}

// Zakładka „Przegląd” jednostki.
export function unitCard(u, byId = new Map(), kids = [], ctx = {}) {
  const symbolOf = ctx.symbolOf || noSymbol;
  const parent = u.parent || u.formation ? byId.get(u.parent ?? u.formation) : null;
  const header = ctx.header === false ? '' : `<h4>${e(u.name || u.id)}</h4><div class="card__type">${e(describeSidc(u.sidc))}</div>`;
  const bft = bftStatus(u, ctx.turnTime, ctx.tz);
  const rows = row('Stan', u.status) + row('Zadanie', u.task) + (bft.stale ? row('Ostatni raport BFT', bft.text.replace(/^pozycja z /, '')) : '');
  const sub = parent || kids.length
    ? `<div class="kv"><div class="cap">Podporządkowanie</div>
        ${parent ? `<div class="kvr"><span>Przełożony</span><span>${unitChip(parent, symbolOf)}</span></div>` : ''}
        ${kids.length ? `<div class="kvr"><span>Podwładni</span><span class="chips">${kids.map((k) => unitChip(k, symbolOf)).join('')}</span></div>` : ''}</div>`
    : '';
  const note = ctx.neighbour ? `<div class="nb-note" role="note"><b>Sąsiad — brak dowodzenia</b><span>Jednostka sąsiada: dane tylko do odczytu, nie przyjmuje rozkazów od gracza.</span></div>` : '';
  return `<div class="card">${header}${note}${personnelBlock(u, ctx)}${fatigueBlock(u)}${equipmentBlock(u, ctx)}${dosBlock(ctx.dosView, ctx)}
    <div class="kv"><div class="cap">Zadanie i położenie</div>${positionBlock(u.pos, rows)}${row('Uwagi', u.notes)}</div>${sub}</div>`;
}

function estimateBlock(c, ctx = {}) {
  const p = c.estimate_personnel;
  const eq = c.estimate_equipment;
  if (!p && !eq?.length) return '';
  const src = [c.source, c.confidence && `pewność ${c.confidence}`].filter(Boolean).join(', ');
  const big = p ? `<div class="bignum">${e(formatEstimatePersonnel(p).replace(' żołn.', ''))}<small>żołnierzy</small></div>` : '';
  const groups = groupEquipment(eq || [], ctx.catalog);
  const row = (q) => `<div class="eqr eqr--est"><span class="n">${e(q.name)}</span><span class="v">${e(formatEstimateEquipment(q).split(' ')[0])}</span></div>${weaponsLine(q.weapons, true)}`;
  const items = groups.every((g) => g.category === OTHER_CATEGORY)
    ? (eq || []).map((q) => `<div class="eqr eqr--est"><span class="n">${e(q.name)}</span><span class="v">${e(formatEstimateEquipment(q).split(' ')[0])}</span></div>`).join('')
    : groups.map((g) => `<div class="eq-cat">${e(g.category)}</div>${g.rows.map(row).join('')}`).join('');
  return `<div class="kv estimate"><div class="cap">Szacunek sił<span class="grow"></span><span class="pill">NIE PRAWDA</span></div>${big}
    <div class="est-eq">${items}</div><div class="estimate__src">źródło: ${e(src)}</div></div>`;
}

// Kontakt przeciwnika: obserwacja (wiek bursztynem) i szacunek sił.
export function contactCard(c, turnTime, tz, ctx = {}) {
  const header = ctx.header === false ? '' : `<h4>${e(c.estimate || 'Kontakt ' + c.id)}</h4><div class="card__type">${e(describeSidc(c.sidc))}</div>`;
  const age = c.observed && turnTime ? formatAge(c.observed, turnTime) : '';
  const seen = c.observed ? `<div class="kvr"><span>Zaobserwowano</span><span class="mono">${e(formatClock(c.observed, tz))}${age ? ` <span class="age">· ${e(age)}</span>` : ''}</span></div>` : '';
  const fr = contactFreshness(c, turnTime);
  const stale = fr.old ? `<div class="kvr"><span>Aktualność</span><span><span class="tag rep warn">${e(fr.text)}</span></span></div>` : '';
  const conf = c.confidence ? `<div class="kvr"><span>Pewność</span><span><span class="tag rep${c.confidence === 'niska' ? ' warn' : ''}">${e(c.confidence)}</span></span></div>` : '';
  const unc = c.uncertainty_m ? `<div class="kvr"><span>Niepewność</span><span class="mono">± ${e((c.uncertainty_m / 1000).toFixed(1))} km</span></div>` : '';
  return `<div class="card">${header}<div class="kv"><div class="cap">Obserwacja</div>${seen}${stale}${row('Źródło', c.source)}${conf}${unc}${positionBlock(c.pos, '')}${row('Uwagi', c.notes)}</div>${estimateBlock(c, ctx)}</div>`;
}

export function assetCard(a, ctx = {}) {
  const header = ctx.header === false ? '' : `<h4>${e(a.name || a.id)}</h4><div class="card__type">${e(a.type || describeSidc(a.sidc))}</div>`;
  return `<div class="card">${header}<div class="kv"><div class="cap">Zadanie</div>${row('Stan', a.status)}${row('Zadanie', a.task)}${positionBlock(a.pos, '')}${row('Uwagi', a.notes)}</div></div>`;
}

// Zakładka „Zaopatrzenie”: dane logistyczne należą do sędziego — gracz ich nie widzi (warstwa logistyczna v0.2).
export function supplyCard() {
  return `<div class="kv"><div class="cap">Zaopatrzenie · doby (DOS)<span class="grow"></span><span class="pill">WARSTWA LOGISTYCZNA</span></div>
    <p class="muted">Paliwo, amunicja, żywność i części pojawią się w warstwie logistycznej (v0.2). Na razie stan zaopatrzenia zgłasza S4 w komunikatorze.</p></div>`;
}

// Zakładka „Historia”: dziennik rozmów z jednostką (wiadomości kanału, najnowsze u góry).
export function historyCard(messages, tz, limit = 12) {
  if (!messages.length) return `<div class="kv"><div class="cap">Dziennik jednostki</div><p class="muted">Brak wpisów — nie było jeszcze korespondencji z tą jednostką.</p></div>`;
  const items = [...messages]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, limit)
    .map((m) => {
      const who = m.direction === 'out' ? 'Wysłano' : 'Otrzymano';
      const text = m.text.length > 90 ? m.text.slice(0, 88) + '…' : m.text;
      return `<div><time>${e(formatClock(m.time, tz))}</time><span><b>${who}</b> ${e(text)}</span></div>`;
    })
    .join('');
  return `<div class="kv"><div class="cap">Dziennik jednostki</div><div class="log">${items}</div></div>`;
}
