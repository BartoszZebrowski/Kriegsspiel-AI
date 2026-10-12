// Pogoda (T30). Czysty JS (serwer, walidator, sędzia). Opis pól: docs/SCHEMA.md.
// `weather` jest jawna dla gracza (prognoza + obserwacje): ten sam obiekt w player/turns i umpire/turns.
// Dzień i noc nie są polem pliku: liczy je klient (public/js/domain/daylight.js) z czasu tury i położenia.

export const WEATHER_PRECIP = ['brak', 'mżawka', 'deszcz', 'ulewa', 'śnieg'];
export const WEATHER_FOG = ['brak', 'lekka', 'gęsta'];
export const WEATHER_WIND = ['słaby', 'umiarkowany', 'silny'];
export const WEATHER_FIELDS = ['text', 'precip', 'fog', 'wind', 'temp_c', 'visibility_km', 'forecast'];

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Błąd (tekst) albo null. `text` wymagany; kategorie z list; liczby w rozsądnym zakresie; brak pól spoza listy. */
export function checkWeather(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return 'weather musi być obiektem';
  const extra = Object.keys(w).filter((k) => !WEATHER_FIELDS.includes(k));
  if (extra.length) return `weather: pola spoza schematu: ${extra.join(', ')}`;
  if (typeof w.text !== 'string' || !w.text.trim() || w.text.length > 400) return 'weather.text wymagany (tekst, maks. 400 znaków)';
  for (const [key, list] of [['precip', WEATHER_PRECIP], ['fog', WEATHER_FOG], ['wind', WEATHER_WIND]]) {
    if (w[key] !== undefined && !list.includes(w[key])) return `weather.${key} „${w[key]}” (dozwolone: ${list.join(', ')})`;
  }
  if (w.temp_c !== undefined && !(isNum(w.temp_c) && w.temp_c >= -60 && w.temp_c <= 60)) return 'weather.temp_c musi być liczbą −60…60 (°C)';
  if (w.visibility_km !== undefined && !(isNum(w.visibility_km) && w.visibility_km >= 0 && w.visibility_km <= 50)) return 'weather.visibility_km musi być liczbą 0–50 (km)';
  if (w.forecast !== undefined && (typeof w.forecast !== 'string' || w.forecast.length > 400)) return 'weather.forecast musi być tekstem (maks. 400 znaków)';
  return null;
}
