// Opis symboli NATO (MIL-STD-2525C, 15-znakowy SIDC) po polsku.
// Pozycje: 1 schemat, 2 przynależność, 3 wymiar, 4 status, 5–10 funkcja,
// 11 wskaźnik (dowództwo/zgrupowanie/makieta), 12 wielkość, 13–14 kraj, 15 porządek bitwy.

export const AFFILIATIONS = {
  F: 'swój',
  A: 'przypuszczalnie swój',
  H: 'wróg',
  S: 'podejrzany',
  U: 'nieznany',
  N: 'neutralny',
  P: 'nieustalony',
};

export const STATUSES = {
  P: null,
  A: 'przewidywany',
};

export const ECHELONS = {
  A: 'załoga',
  B: 'drużyna',
  C: 'sekcja',
  D: 'pluton',
  E: 'kompania',
  F: 'batalion',
  G: 'pułk',
  H: 'brygada',
  I: 'dywizja',
  J: 'korpus',
  K: 'armia',
  L: 'front',
  M: 'okręg',
};

export const MODIFIERS = {
  A: 'dowództwo',
  B: 'dowództwo zgrupowania',
  C: 'makieta dowództwa',
  D: 'makieta dowództwa zgrupowania',
  E: 'zgrupowanie',
  F: 'makieta',
  G: 'makieta zgrupowania',
};

// Kody funkcji (pozycje 5–10, bez końcowych kresek), klucz: wymiar + kod.
export const FUNCTIONS = {
  'G:UCI': 'piechota',
  'G:UCIZ': 'piechota zmechanizowana',
  'G:UCIM': 'piechota zmotoryzowana',
  'G:UCIL': 'piechota lekka',
  'G:UCA': 'pancerne',
  'G:UCAT': 'pancerne (gąsienicowe)',
  'G:UCAA': 'przeciwpancerne',
  'G:UCR': 'rozpoznanie',
  'G:UCF': 'artyleria',
  'G:UCFH': 'artyleria haubic',
  'G:UCFM': 'moździerze',
  'G:UCFHE': 'artyleria samobieżna',
  'G:UCFR': 'artyleria rakietowa',
  'G:UCFRMS': 'wyrzutnie rakiet (samobieżne)',
  'G:UCD': 'obrona przeciwlotnicza',
  'G:UCDM': 'obrona przeciwlotnicza rakietowa',
  'G:UCE': 'saperzy',
  'G:UUS': 'łączność',
  'G:UUM': 'wywiad wojskowy',
  'G:USS': 'zaopatrzenie',
  'G:UST': 'transport',
  'G:USX': 'remont i naprawy',
  'G:USM': 'zabezpieczenie medyczne',
  'G:US': 'logistyka',
  'A:MFQ': 'bezzałogowy statek powietrzny',
  'A:MHQ': 'bezzałogowy wiropłat',
};

export function normalizeSidc(sidc) {
  return String(sidc || '').toUpperCase().padEnd(15, '-').slice(0, 15);
}

export function parseSidc(raw) {
  const s = normalizeSidc(raw);
  const dimension = s[2];
  const fnCode = s.slice(4, 10).replace(/-+$/, '');
  return {
    sidc: s,
    affiliationCode: s[1],
    affiliation: AFFILIATIONS[s[1]] ?? null,
    dimension,
    statusCode: s[3],
    status: STATUSES[s[3]] ?? null,
    functionCode: fnCode,
    function: FUNCTIONS[`${dimension}:${fnCode}`] ?? null,
    modifier: MODIFIERS[s[10]] ?? null,
    echelonCode: s[11],
    echelon: ECHELONS[s[11]] ?? null,
  };
}

// „swój · piechota zmechanizowana · brygada”
export function describeSidc(raw) {
  const p = parseSidc(raw);
  return [p.affiliation, p.function ?? 'nieznany typ', p.modifier, p.echelon, p.status]
    .filter(Boolean)
    .join(' · ');
}

export function isDescribed(raw) {
  const p = parseSidc(raw);
  return Boolean(p.affiliation && p.function);
}

// Unikalne typy symboli (do legendy „Na mapie”): jeden wpis na SIDC, z liczbą wystąpień.
export function groupSymbolTypes(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.sidc) continue;
    const key = normalizeSidc(item.sidc);
    const entry = map.get(key) ?? { sidc: key, description: describeSidc(key), count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  const order = { F: 0, A: 1, U: 2, S: 3, H: 4 };
  return [...map.values()].sort(
    (a, b) =>
      (order[a.sidc[1]] ?? 9) - (order[b.sidc[1]] ?? 9) || a.description.localeCompare(b.description, 'pl'),
  );
}
