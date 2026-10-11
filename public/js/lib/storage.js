// localStorage z obsługą braku dostępu (tryb prywatny, zablokowane dane).

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // brak trwałości — aplikacja działa dalej
  }
}
