// Starzenie się kontaktów (T16): symbol wroga blaknie wraz z wiekiem informacji (czas tury − `observed`).
// Progi zależą od typu z SIDC: pancerne starzeją się szybciej niż artyleria w stanowiskach. Czyste funkcje, bez DOM.
import { ageMinutes, formatAgeShort } from './format.js';
import { parseSidc } from './sidc.js';

export const CONTACT_MIN_OPACITY = 0.35;

// Klasy wieku: `fresh` (do tylu minut krycie pełne) i `old` (od tylu minut krycie minimalne).
export const AGE_CLASSES = {
  drone: { label: 'bezzałogowiec', fresh: 10, old: 30 },
  fast: { label: 'pancerne / rozpoznanie', fresh: 30, old: 120 },
  slow: { label: 'piechota / artyleria / OPL / REW', fresh: 60, old: 360 },
  static: { label: 'logistyka (obiekty stałe)', fresh: 180, old: 720 },
  other: { label: 'inne', fresh: 45, old: 180 },
};

const FAST = ['UCA', 'UCIZ', 'UCIM', 'UCR']; // pancerne, przeciwpancerne, zmechanizowana, zmotoryzowana, rozpoznanie
const SLOW = ['UCI', 'UCF', 'UCD', 'UCE', 'UUM', 'UUS'];

// Klasa wieku z SIDC (wymiar + funkcja).
export function contactAgeClassKey(sidc) {
  const { dimension, functionCode: f } = parseSidc(sidc);
  if (dimension === 'A') return 'drone';
  if (FAST.some((p) => f.startsWith(p))) return 'fast';
  if (SLOW.some((p) => f.startsWith(p))) return 'slow';
  if (f.startsWith('US')) return 'static';
  return 'other';
}

export const contactAgeClass = (sidc) => AGE_CLASSES[contactAgeClassKey(sidc)];

// Krycie dla wieku (min) i klasy: 1 do progu świeżego, liniowo do minimum przy progu starym.
export function opacityForAge(ageMin, cls) {
  if (ageMin === null || ageMin === undefined || ageMin <= cls.fresh) return 1;
  if (ageMin >= cls.old) return CONTACT_MIN_OPACITY;
  return 1 - ((1 - CONTACT_MIN_OPACITY) * (ageMin - cls.fresh)) / (cls.old - cls.fresh);
}

// → { ageMin|null, cls, opacity, old, text: 'informacja sprzed 2 h 10 min' | '' }
export function contactFreshness(contact, turnTime) {
  const cls = contactAgeClass(contact?.sidc);
  const ageMin = contact?.observed && turnTime ? ageMinutes(contact.observed, turnTime) : null;
  const old = ageMin !== null && ageMin >= cls.old;
  return { ageMin, cls, opacity: opacityForAge(ageMin, cls), old, text: old ? `informacja sprzed ${formatAgeShort(ageMin)}` : '' };
}
