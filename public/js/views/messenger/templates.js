// Szablony wiadomości i podpowiedzi pól komponowania (dane, bez DOM).
// Szablony wiadomości wg rodzaju (wstawiane przy wyborze rodzaju lub z menu „Szablon”).
export const TEMPLATES = {
  rozkaz: 'ROZKAZ BOJOWY nr \n1. Sytuacja:\n2. Zadanie:\n3. Zamiar:\n4. Współdziałanie:\n5. Zabezpieczenie:\n6. Dowodzenie i łączność:',
  zarzadzenie: 'ZARZĄDZENIE \nPodstawa:\nPolecam:\nTermin wykonania:',
  meldunek: 'MELDUNEK \nSytuacja:\nStan jednostek:\nZamiary:\nProszę o:',
  wiadomosc: '',
};
export const PLACEHOLDERS = {
  rozkaz: 'Treść rozkazu… użyj @ aby wskazać jednostkę, # aby wskazać miejsce',
  zarzadzenie: 'Treść zarządzenia… (@ jednostka, # miejsce)',
  meldunek: 'Treść meldunku… (@ jednostka, # miejsce)',
  wiadomosc: 'Wiadomość… (@ jednostka, # miejsce)',
};
export const TEMPLATE_MENU = [
  ['rozkaz', 'Rozkaz bojowy (5 punktów)'],
  ['zarzadzenie', 'Zarządzenie'],
  ['meldunek', 'Meldunek sytuacyjny'],
];
export const isTemplate = (text) => Object.values(TEMPLATES).includes(text);
