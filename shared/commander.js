// Dowódcy jako osobni agenci (T14): format pliku wiedzy `umpire/commanders/<id>.md` i odpowiedzi agenta.
// Czysty JS (bez DOM i bez API Node) — używa go walidator, narzędzie sędziego (tools/umpire/commander.mjs) i testy.
// Opis: docs/SCHEMA.md (sekcja `umpire/commanders`), procedura: CLAUDE.md („Dowódcy-agenci”).

export const COMMANDER_ID_RE = /^[\w-]{1,40}$/;
/** Obowiązkowe nagłówki `##` pliku wiedzy, w tej kolejności. */
export const COMMANDER_SECTIONS = ['Kim jestem', 'Moje jednostki', 'Otrzymane rozkazy i szkice', 'Co wiem o sytuacji', 'Dziennik decyzji'];
export const RESULT_FIELDS = ['commander', 'turn', 'orders', 'report', 'knowledge'];
export const ORDER_RESULT_FIELDS = ['to', 'text', 'task', 'area'];
export const MAX_RESULT_TEXT = 1500;
export const MAX_KNOWLEDGE_TEXT = 2500;

/** Zwraca komunikat błędu albo null. Id pliku = nazwa bez rozszerzenia, bezpieczna jako element ścieżki. */
export function checkCommanderId(id) {
  if (typeof id !== 'string' || !COMMANDER_ID_RE.test(id)) return 'nieprawidłowe id dowódcy (litery, cyfry, _ i -, maks. 40 znaków)';
  return null;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;

/** Rozbija plik na wstęp (przed pierwszym `##`) i sekcje {title, body}. */
export function parseSections(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const intro = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      cur = { title: m[1], body: [] };
      sections.push(cur);
    } else (cur ? cur.body : intro).push(line);
  }
  return { intro: intro.join('\n').trim(), sections: sections.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })) };
}

export function joinSections({ intro, sections }) {
  const parts = [intro, ...sections.map((s) => `## ${s.title}\n\n${s.body}`.trimEnd())].filter((p) => p !== '');
  return parts.join('\n\n') + '\n';
}

export const getSection = (md, title) => parseSections(md).sections.find((s) => s.title === title)?.body ?? null;

/** Zamienia treść sekcji (tworzy ją na końcu, gdy brak). Zwraca nowy tekst. */
export function setSection(md, title, body) {
  const doc = parseSections(md);
  const s = doc.sections.find((x) => x.title === title);
  if (s) s.body = String(body).trim();
  else doc.sections.push({ title, body: String(body).trim() });
  return joinSections(doc);
}

/** Dopisuje akapit na końcu sekcji. */
export function appendToSection(md, title, text) {
  const cur = getSection(md, title);
  return setSection(md, title, cur ? `${cur}\n\n${String(text).trim()}` : String(text).trim());
}

/** Walidacja pliku wiedzy: zwraca tablicę komunikatów (pusta = poprawny). Bez treści pliku w komunikatach. */
export function checkCommanderFile(md) {
  const errors = [];
  if (typeof md !== 'string' || !md.trim()) return ['plik pusty'];
  const { intro, sections } = parseSections(md);
  if (!/^#\s+\S/m.test(intro)) errors.push('brak nagłówka # (imię i funkcja) na początku');
  const titles = sections.map((s) => s.title);
  for (const t of COMMANDER_SECTIONS) if (!titles.includes(t)) errors.push(`brak sekcji „${t}”`);
  for (const t of new Set(titles)) if (titles.filter((x) => x === t).length > 1) errors.push(`zduplikowana sekcja „${t}”`);
  for (const s of sections) if (COMMANDER_SECTIONS.includes(s.title) && !s.body) errors.push(`pusta sekcja „${s.title}”`);
  return errors;
}

/** Szablon pliku wiedzy (do `init` i dokumentacji). */
export function commanderTemplate({ id = 'dowodca', name = 'stopień nazwisko', role = 'dowódca', side = 'PL', units = [] } = {}) {
  const unitList = units.length ? units.map((u) => `- ${u}`).join('\n') : '- (id i nazwy jednostek pod moim dowództwem)';
  return joinSections({
    intro: `# ${name} — ${role}\n\nid: ${id} · strona: ${side}`,
    sections: [
      { title: 'Kim jestem', body: 'Osobowość, doświadczenie, styl dowodzenia, słabości (np. ostrożny/agresywny, jak melduje, jak reaguje na stratę i na niejasny rozkaz). Dla przeciwnika: doktryna i ograniczenia jego armii.' },
      { title: 'Moje jednostki', body: unitList },
      { title: 'Otrzymane rozkazy i szkice', body: '(brak) — sędzia dopisuje tu rozkazy wraz z szkicami (nazwa, zadanie, geometria) po turze, w której je otrzymałem.' },
      { title: 'Co wiem o sytuacji', body: 'Tylko to, co sam widzę i co mi zameldowano; mogę się mylić. Aktualizowane po każdej turze.' },
      { title: 'Dziennik decyzji', body: '(brak wpisów)' },
    ],
  });
}

/** Wyciąga obiekt JSON z odpowiedzi agenta: pierwszy blok kodu (json) albo cały tekst. Zwraca {result} albo {error}. */
export function parseCommanderResult(text) {
  const s = String(text ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const raw = (fence ? fence[1] : s).trim();
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? { result: v } : { error: 'wynik musi być obiektem JSON' };
  } catch (err) {
    return { error: `niepoprawny JSON w odpowiedzi agenta (${err.message})` };
  }
}

// Bez linii zaczynających się od `#`: tekst agenta trafia do pliku wiedzy i nie może dopisać własnych sekcji.
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/^\s*#/m.test(v);

/**
 * Walidacja odpowiedzi agenta. ctx: { commanderId, turn?, subordinateIds (tablica/zbiór: do kogo wolno wydać rozkaz) }.
 * Zwraca tablicę komunikatów (pusta = poprawny).
 */
export function checkCommanderResult(r, ctx = {}) {
  const errors = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['wynik musi być obiektem'];
  for (const k of Object.keys(r)) if (!RESULT_FIELDS.includes(k)) errors.push(`nieznane pole „${k}”`);
  if (ctx.commanderId && r.commander !== ctx.commanderId) errors.push(`commander „${r.commander}” różni się od oczekiwanego „${ctx.commanderId}”`);
  if (ctx.turn !== undefined && r.turn !== ctx.turn) errors.push(`turn ${r.turn} różni się od oczekiwanej ${ctx.turn}`);
  const subs = ctx.subordinateIds instanceof Set ? ctx.subordinateIds : new Set(ctx.subordinateIds ?? []);
  if (r.orders !== undefined) {
    if (!Array.isArray(r.orders)) errors.push('orders musi być tablicą');
    else
      r.orders.forEach((o, i) => {
        const at = `orders[${i}]`;
        if (!o || typeof o !== 'object') return errors.push(`${at}: nieprawidłowy obiekt`);
        for (const k of Object.keys(o)) if (!ORDER_RESULT_FIELDS.includes(k)) errors.push(`${at}: nieznane pole „${k}”`);
        if (!subs.has(o.to)) errors.push(`${at}: adresat „${o.to}” nie jest moim podwładnym`);
        if (!isText(o.text, MAX_RESULT_TEXT)) errors.push(`${at}: text wymagany (maks. ${MAX_RESULT_TEXT} znaków)`);
        for (const k of ['task', 'area']) if (o[k] !== undefined && !isText(o[k], 80)) errors.push(`${at}: ${k} musi być krótkim tekstem`);
      });
  }
  if (r.report !== undefined) {
    if (!r.report || typeof r.report !== 'object' || !isText(r.report.text, MAX_RESULT_TEXT)) errors.push(`report.text wymagany (maks. ${MAX_RESULT_TEXT} znaków)`);
    else for (const k of Object.keys(r.report)) if (k !== 'text') errors.push(`report: nieznane pole „${k}”`);
  }
  const k = r.knowledge;
  if (!k || typeof k !== 'object') errors.push('knowledge wymagane ({situation, decision})');
  else {
    for (const f of ['situation', 'decision']) if (!isText(k[f], MAX_KNOWLEDGE_TEXT)) errors.push(`knowledge.${f} wymagane (maks. ${MAX_KNOWLEDGE_TEXT} znaków)`);
    for (const f of Object.keys(k)) if (f !== 'situation' && f !== 'decision') errors.push(`knowledge: nieznane pole „${f}”`);
  }
  return errors;
}
