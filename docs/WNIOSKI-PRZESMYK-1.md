# Wnioski z rozgrywki „Przesmyk” nr 1

Rozgrywka testowa `00-test-przesmyk`: 18 tur, 14.05 06:00 – 15.05 18:00, zakończona 2026-10-12. Zapis gry: tag `przesmyk-rozgrywka-1`. Omówienie: [scenarios/00-test-przesmyk/umpire/aar.md](../scenarios/00-test-przesmyk/umpire/aar.md) oraz `aar.html` (mapa z suwakiem tur).

Ogólnie: gra wciąga i prototyp pokazuje, że koncept daje frajdę. Problemy dotyczą głównie UI/UX, bierności postaci i warsztatu sędziego. Zadania wynikające z wniosków: [TASKS.md](../TASKS.md), etap v0.1.3.

## Wnioski gracza (UI/UX)

- Interfejs jest toporny.
- Dwuklik na jednostkę powinien otwierać jej kanał w komunikatorze.
- Niewysłana wiadomość powinna zostawać przy adresacie (szkic na kanał), a nie przechodzić do innej osoby po przełączeniu kanału.
- Wybór adresata przez dropdown jest niewygodny. Lista osób powinna być na wierzchu.
- Postacie na komunikatorze odpowiadają chaotycznie i używają za dużo skrótów.
- Znaczniki jednostek czasem wprowadzają w błąd: nazwa „bcz (RU)” w wiadomości linkuje do własnego bcz.
- Podwładni są pasywni: działają dopiero po rozkazie, przełożony też niewiele inicjuje.
- Przepinanie podporządkowania nie działało: AI nie przepinało nowych i starych jednostek, a przepięcie starej jednostki nie było widać w hierarchii.

## Wnioski sędziego (Claude)

- **Wyniki starć były zbyt korzystne dla gracza.** Przeciwnik stracił ok. 100 wozów pancernych, gracz ok. 45, a w jednym natarciu padło 14 BMP-3 przy 2 Leopardach. To łamie zasadę „bez wyników filmowych”. Przy obronie przygotowanej rozsądny stosunek strat to raczej 2–3:1, a nie 7:1.
- **Postacie były reaktywne.** Brakowało meldunków z własnej inicjatywy, propozycji decyzji i samodzielnych reakcji w ramach zamiaru przełożonego.
- **Nazwy jednostek wroga** kolidowały z własnymi („bcz (RU)” a „bcz”).
- **Za dużo skrótów:** kppanc, DOS, krozp, BGT, PO.
- **Przydziały robione tylko w `status`.** krozp-1p „pod komendą bcz” i pluton 3k „w składzie 2k” nie miały zmienionego `parent`, więc hierarchia w aplikacji ich nie pokazywała. Przydział to zmiana `parent`, a nie opis.
- **Rozstawienie ręczne** w turach 5–12, bez terrain-view: plutony w sztywnych blokach, jednostki wroga w jeziorze Gieret. Od tury 13 z terrain-view + pick było wyraźnie lepiej.
- **Stany plutonów** nie sumowały się do stanu kompanii.
- **Plan przeciwnika rozbudowany w trakcie** (odwody RU, T-90M, drugi rzut, BM-21, park). Plan na to pozwalał, ale zmiany nie trafiły do `enemy-plan.md`. Uzupełnienia trzeba dopisywać do planu z godziną decyzji.
- **Wolne tury i cisza w czacie:** gracz musiał dopytywać.

## Wnioski techniczne

1. **Brakuje narzędzia do składania tury.** Każdą turę składał jednorazowy skrypt (kopia N→N+1, zmiany, widok gracza, trasy, wiadomości). Potrzebny jest `tools/umpire/turn.mjs`, który:
   - tworzy turę N+1,
   - wylicza `track` z różnicy pozycji,
   - kopiuje do pliku gracza tylko pola z białej listy,
   - sortuje wiadomości po czasie,
   - pilnuje kolejności zapisu.
2. **`pick.mjs --check-water` zawisa,** gdy Overpass zwraca 504 (ponad 2 minuty). Potrzebny jest limit czasu i tryb offline z ostrzeżeniem.
3. **Walidator powinien łapać:**
   - sumy plutonów niezgodne ze stanem kompanii,
   - jednostki w wodzie (z cache),
   - wiadomości poza kolejnością czasu,
   - nazwy wroga kolidujące z własnymi,
   - `status: finished` bez `aar.md`.
4. **Linkowanie nazw w komunikatorze:** dopasowanie najdłuższe pierwsze. Trafienie z dopiskiem „(RU)” lub „(BY)” nie może linkować do własnej jednostki.
5. **Komunikator:**
   - domyślny typ „rozkaz” dla kanałów podwładnych (gracz wysyłał rozkazy jako „meldunek”),
   - ostrzeżenie, gdy treść wymienia inną jednostkę niż adresat (rozkazy dla 2 bzmot trafiały do S2),
   - wskazanie miejsca na mapie, gdy nazwy nie ma w gazeterze („Blenda”, „Wiereśnie”).
6. **Strzałki w załącznikach:** kierunek bywa odwrotny do zamiaru. Pomoże podgląd grotu przy rysowaniu.
7. **Hierarchia:** sprawdzić, czy drzewo ORBAT przelicza się z bieżącej tury po zmianie `parent` i czy pokazuje nowe jednostki (np. `bopl-1p`) oraz przepięte plutony (np. `krozp-2p` → `1bzmot-3k`).
8. **Tryb po bitwie (T29)** nie istnieje. `aar.html` (mapa z suwakiem, prawda a kontakty) może posłużyć za wzór.
