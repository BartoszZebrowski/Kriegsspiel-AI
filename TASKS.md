# Kriegsspiel AI — zadania

Opracowane na podstawie [DESIGN.md](DESIGN.md). Każde zadanie ma warunki akceptacji (WA) i scenariusze testowe:
- **[A]** test automatyczny (`npm test`),
- **[M]** test ręczny w przeglądarce.

Zadanie jest skończone, gdy spełnia wszystkie warunki akceptacji i przechodzi wszystkie scenariusze testowe.

**Konwencje:**
- współrzędne w plikach zapisujemy jako `[długość, szerokość]` (jak w GeoJSON),
- czas gry w ISO 8601 ze strefą (np. `2026-05-14T06:00:00+02:00`),
- symbole NATO kodowane SIDC w formacie MIL-STD-2525C (15 znaków, np. `SFGPUCIZ---H---`).

**Etapy wykonania zadania (w tej kolejności):**
1. **Plan architektoniczny (przed kodem):** jak zadanie wpływa na architekturę ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) i jak się w nią wpasować:
   - w której warstwie leży każda część (`domain/` czysta logika, `core/` stan i intencje, `views/` DOM, `shared/` wspólne z serwerem, `tools/`),
   - zależności tylko w dozwolonym kierunku i możliwie słabe (parametry, store, kontroler zamiast importów; widoki nie importują się nawzajem),
   - nowe odpowiedzialności w nowych, małych plikach (cel: ≤ ~300 linii), zamiast dopisywania do dużych; nowa warstwa mapy = nowy plik w `views/map/`,
   - stałe i reguły w jednym miejscu (bez duplikatów między plikami),
   - gdy zadanie wymaga zmiany architektury — najpierw aktualizacja ARCHITECTURE.md.
2. **Implementacja** zgodnie z planem.
3. **Przegląd kodu** (poprawność i zgodność z planem architektonicznym).
4. **Testy** [A] i scenariusze [M].

Legenda statusu: ⬜ do zrobienia · 🟨 w trakcie · ✅ zrobione

---

# Etap v0.1 — plansza i komunikator

## T01 — Szkielet projektu i lokalny serwer ✅
Serwer Node (bez frameworka) serwuje aplikację, biblioteki i dane wybranego scenariusza.

**WA**
1. `npm start` uruchamia serwer na `http://localhost:8080`, a w konsoli pojawia się adres i nazwa scenariusza.
2. Scenariusz wybieramy argumentem (`npm start -- <nazwa>`) albo w `config.json` (`{"scenario": "..."}`).
3. Serwer serwuje `public/` oraz biblioteki Leaflet i milsymbol pod `/vendor/`.
4. **Uczciwość:** żaden adres HTTP nie zwraca zawartości katalogu `umpire/`. Dotyczy to też prób obejścia przez `..` i kodowanie URL.
5. Nieznany adres zwraca 404, a błąd odczytu zwraca 500 z komunikatem JSON. Serwer się przy tym nie wyłącza.

**Scenariusze testowe**
- [A] GET `/` zwraca 200 i HTML.
- [A] GET `/vendor/leaflet/leaflet.js` i `/vendor/milsymbol.js` zwracają 200.
- [A] GET `/api/../umpire/turns/000.json`, `/%2e%2e/umpire/...` i `/scenario/umpire/...` nie zwracają zawartości prawdy (status ≠ 200 lub brak treści pliku).
- [A] GET `/nie-istnieje` zwraca 404.
- [M] `npm start` i otwarcie strony w przeglądarce pokazuje aplikację.

## T02 — API odczytu scenariusza i tur ✅
**WA**
1. `GET /api/scenario` zwraca metadane (`scenario.json`), listę numerów tur gracza i numer tury bieżącej (najwyższej).
2. `GET /api/turn/:n` zwraca `player/turns/NNN.json`. Dla nieistniejącej tury zwraca 404.
3. `GET /api/briefing` zwraca treść `briefing.md`.
4. Numer tury jest walidowany: tylko liczba całkowita ≥ 0, inaczej 400.

**Scenariusze testowe**
- [A] Scenariusz z turami 000 i 001 daje `turns: [0,1]` i `currentTurn: 1`.
- [A] `/api/turn/1` zwraca zawartość pliku 001.json.
- [A] `/api/turn/7` zwraca 404, a `/api/turn/abc` i `/api/turn/-1` zwracają 400.
- [A] `/api/briefing` zwraca tekst odprawy.

## T03 — Mapa z podkładami ✅
**WA**
1. Mapa pełnoekranowa (Leaflet), wycentrowana na obszarze z `scenario.json` (`map.center`, `map.zoom`).
2. Podkłady do przełączania: OpenStreetMap, OpenTopoMap (topografia), Esri World Imagery (satelita).
3. Nakładki do włączania: cieniowanie rzeźby (Esri Hillshade), linie kolejowe (OpenRailwayMap).
4. Wybór podkładu i nakładek pamiętany w przeglądarce (localStorage, z obsługą błędu).
5. Skala metryczna i atrybucje dostawców widoczne na mapie.

**Scenariusze testowe**
- [M] Przełączenie na każdy podkład ładuje kafelki bez błędów w konsoli.
- [M] Włączenie nakładki kolei pokazuje tory (np. Suwałki–Trakiszki).
- [M] Po odświeżeniu strony wybrany podkład pozostaje.

## T04 — Symbole NATO na mapie ✅
**WA**
1. Jednostki własne (`units`) i kontakty wroga (`contacts`) z bieżącej tury są rysowane jako symbole milsymbol, z oznaczeniem nazwy jednostki.
2. Kontakt ma okrąg niepewności (`uncertainty_m`) i przerywaną ramkę, gdy jest niepotwierdzony (status `A` w SIDC).
3. Po najechaniu na symbol pojawia się podpowiedź z polskim opisem typu i wielkości. Po kliknięciu otwiera się karta jednostki:
   - jednostka: nazwa, stan, siła, zadanie,
   - kontakt: czas obserwacji, źródło, pewność, szacunek, wiek informacji.
4. Linie z pola `lines` (granice pasa, linie styczności) są rysowane z podpisem i stylem zależnym od rodzaju.
5. Środki rozpoznania (`assets`) z pozycją są widoczne jako symbole.

**Scenariusze testowe**
- [A] Funkcja opisu SIDC: `SFGPUCIZ---H---` daje „swój · piechota zmechanizowana · brygada”, `SHGAUCAT---E---` daje „wróg · pancerne (gąsienicowe) · kompania · przewidywany”.
- [A] Wszystkie SIDC w scenariuszu testowym są poprawne według milsymbol i mają polski opis.
- [A] Wiek informacji: obserwacja 06:22 przy czasie tury 08:00 daje „1 h 38 min temu”.
- [M] Na mapie scenariusza testowego widać wszystkie jednostki, kontakty z okręgami i granice pasa.

## T05 — Legenda symboli ✅
**WA**
1. Panel boczny „Legenda” z dwiema zakładkami.
2. „Na mapie”: lista unikalnych typów symboli obecnych w bieżącej turze (miniatura i polski opis). Lista aktualizuje się po zmianie tury.
3. „Ściąga”: zasady budowy symbolu, czyli przynależność (ramki swój/wróg/nieznany/podejrzany), rodzaje wojsk (ikony), wielkości jednostek (znaczki), ramka przerywana.
4. Panel da się zwinąć.

**Scenariusze testowe**
- [A] Funkcja grupująca typy zwraca jedną pozycję dla dwóch jednostek tego samego typu i różnych nazw.
- [M] W legendzie „Na mapie” widać każdy typ obecny na mapie dokładnie raz.
- [M] Ściąga pokazuje poprawne miniatury (porównanie z symbolami na mapie).

## T06 — Zegar gry i przeglądanie tur ✅
**WA**
1. Nagłówek pokazuje: tytuł scenariusza, numer tury, czas gry (np. „czw. 14.05.2026, 08:00”), długość tury i godzinę następnej tury.
2. Przyciski ◀ ▶ pozwalają przejrzeć wcześniejsze tury. Wcześniejsza tura jest wyraźnie oznaczona jako „archiwum (tylko podgląd)”.
3. Przycisk „bieżąca” wraca do aktualnej tury.

**Scenariusze testowe**
- [A] Formatowanie czasu `2026-05-14T08:00:00+02:00` daje „czw. 14.05.2026, 08:00” (czas strefy scenariusza, niezależnie od strefy komputera).
- [A] Tura 120 min przy czasie 08:00 daje następną turę o 10:00.
- [M] Przejście do tury 0 pokazuje stan początkowy z oznaczeniem archiwum. „Bieżąca” wraca do najnowszej.

## T07 — Komunikator ✅
**WA**
1. Panel komunikatora z kanałami z `scenario.json` (`channels`): przełożony, sąsiedzi, podwładni, logistyka, rozpoznanie.
2. Każdy kanał pokazuje chronologicznie wiadomości przychodzące (`inbox`) i wysłane (`outbox`) ze wszystkich tur, z czasem gry i numerem tury.
3. Licznik nieprzeczytanych przy kanale (stan „przeczytane” pamiętany w przeglądarce).
4. Wysłanie wiadomości: `POST /api/outbox` z `{channel, text}`. Wiadomość trafia do `player/outbox/NNN.json` bieżącej tury i dostaje `id`, `turn`, `time` (czas gry) i `sent` (czas rzeczywisty).
5. Wiadomość z bieżącej tury można wycofać (`DELETE /api/outbox/:id`) do momentu rozstrzygnięcia tury. Wiadomości z wcześniejszych tur są zablokowane.
6. Walidacja: nieznany kanał lub pusta treść daje 400. Treść ma maksymalnie 4000 znaków.
7. W widoku archiwalnej tury nie można wysyłać.

**Scenariusze testowe**
- [A] POST dopisuje wiadomość do `outbox/001.json` (tworzy plik, gdy go nie ma), a kolejny POST dopisuje drugą.
- [A] POST z kanałem `xyz` daje 400, a pusty tekst daje 400.
- [A] DELETE wiadomości z bieżącej tury usuwa ją. DELETE wiadomości z tury 0, gdy bieżąca to 1, daje 409.
- [A] `GET /api/messages` łączy inbox i outbox ze wszystkich tur, posortowane po czasie.
- [M] Wysłanie rozkazu do „15 BZ” pokazuje go w kanale. Wycofanie usuwa go.
- [M] Nowa wiadomość w kanale przełożonego pokazuje licznik 1, a po otwarciu kanału licznik znika.

## T08 — Odświeżanie na żywo ✅
**WA**
1. `GET /api/events` (Server-Sent Events) wysyła zdarzenie `update`, gdy zmieni się cokolwiek w `player/` lub w `scenario.json`. Zdarzenia są grupowane (debounce ok. 300 ms).
2. Aplikacja po zdarzeniu pobiera dane ponownie. Gdy pojawi się nowa tura, przechodzi do niej i pokazuje powiadomienie „Tura N rozstrzygnięta”.
3. Zmiany w `umpire/` nie wywołują zdarzeń, żeby nie zdradzały aktywności sędziego.

**Scenariusze testowe**
- [A] Zapis pliku w `player/inbox/` powoduje zdarzenie `update` na strumieniu SSE w ciągu 2 s.
- [A] Zapis pliku w `umpire/` nie powoduje zdarzenia w ciągu 1 s.
- [M] Ręczne dodanie `player/turns/002.json` przełącza aplikację na turę 2 bez odświeżania strony.

## T09 — Odprawa ✅
**WA**
1. Przycisk „Odprawa” otwiera okno z treścią `briefing.md`, wyrenderowaną jako czytelny tekst (nagłówki, listy, pogrubienia).
2. Przy pierwszym uruchomieniu scenariusza odprawa otwiera się automatycznie.

**Scenariusze testowe**
- [A] Prosty renderer Markdown: `# Tytuł` daje `<h1>`, `- punkt` daje `<li>`, `**x**` daje `<strong>`, a znaczniki HTML są escapowane.
- [M] Odprawa scenariusza testowego wyświetla się czytelnie.

## T10 — Scenariusz testowy i procedura tury 🟨
**WA**
1. Scenariusz `00-test-przesmyk`: mały, fikcyjny skład sił na prawdziwym terenie Suwalszczyzny, tura 2 h. Zawiera:
   - odprawę,
   - turę 0 (jednostki, kontakty, rozpoznanie, granice pasa, wiadomość od przełożonego),
   - prawdę w `umpire/` i plan przeciwnika.
2. `CLAUDE.md` z procedurą sędziego: jak rozstrzygać „koniec tury”, jakie pliki zapisać, zasady nieujawniania prawdy, styl meldunków.
3. Walidator scenariusza (`npm run validate -- <nazwa>`) sprawdza:
   - poprawność JSON i wymagane pola,
   - poprawność SIDC,
   - istnienie kanałów użytych w wiadomościach,
   - unikalność `id`,
   - ciągłość numeracji tur.

**Scenariusze testowe**
- [A] Walidator przechodzi dla `00-test-przesmyk`.
- [A] Walidator zgłasza błąd dla tury z nieznanym kanałem i dla zduplikowanego `id` jednostki.
- [M] **Pełny obieg:** gracz wysyła rozkazy w aplikacji, wpisuje „koniec tury” w Claude Code, Claude zapisuje turę 1, a aplikacja pokazuje nowe pozycje, kontakty i odpowiedzi w kanałach.

---

# Etap v0.1.1 — uwagi gracza po pierwszym uruchomieniu

## T11 — Wygodny panel boczny ✅
Uwaga gracza: panel jest za wąski i nie da się zmieniać jego rozmiaru.

**WA**
1. Panel ma uchwyt na lewej krawędzi. Przeciąganie zmienia szerokość w zakresie 300 px – 70% okna, a mapa dopasowuje się na bieżąco.
2. Szerokość panelu jest pamiętana w przeglądarce. Podwójne kliknięcie uchwytu przywraca domyślną.
3. Lista kanałów da się zwinąć do wąskiego paska (same skróty i liczniki), żeby rozmowa miała więcej miejsca. Stan zwinięcia jest pamiętany.
4. Pole wpisywania rozkazu da się powiększyć (przeciąganiem) i ma wygodną domyślną wysokość.
5. **Linia do jednostki:** po wybraniu kanału jednostka, z którą rozmawiasz, jest podświetlona na mapie, a od nagłówka rozmowy do jej symbolu biegnie linia. Linia podąża za mapą przy przesuwaniu, przybliżaniu i zmianie szerokości panelu. Gdy jednostka jest poza widokiem, linia kończy się na krawędzi mapy strzałką w jej stronę, a kliknięcie nagłówka centruje mapę na jednostce. Powiązanie kanał → jednostka: pole `unit` w kanale (domyślnie jednostka o tym samym `id`).

**Scenariusze testowe**
- [A] Przycięcie końca linii do prostokąta mapy: punkt wewnątrz bez zmian; punkt poza mapą trafia na krawędź, na odcinku od początku linii.
- [M] Wybranie kanału „1 bzmot” rysuje linię do symbolu 1 bzmot. Przesunięcie mapy przesuwa koniec linii.
- [A] Funkcja ograniczająca szerokość: 200 daje 300, 5000 przy oknie 1440 daje 1008, a 500 zostaje 500.
- [M] Przeciągnięcie uchwytu zmienia szerokość. Po odświeżeniu szerokość zostaje.
- [M] Zwinięcie listy kanałów poszerza obszar wiadomości. Liczniki nieprzeczytanych są nadal widoczne.

## T12 — Rysowanie po mapie (szkice) i miarka ✅
**WA**
1. Pasek narzędzi rysowania na mapie:
   - strzałka (linia łamana z grotem na końcu),
   - linia,
   - rejon (wielokąt),
   - punkt z opisem,
   - własny symbol NATO.
2. Każdy rysunek ma **nazwę** (np. „Rejon A”), opcjonalny opis i kolor (niebieski = własne, czerwony = przeciwnik, czarny = ogólne). Nazwa jest wyświetlana na mapie.
3. **Własny symbol NATO:** wybór przynależności (swój / wróg / nieznany), rodzaju wojsk i wielkości z list, z podglądem symbolu. Symbol hipotezy ma ramkę przerywaną i oznaczenie „hipoteza”, odróżniające go od kontaktów z rozpoznania.
4. Rysunki można przesuwać, edytować (wierzchołki, nazwa, opis) i usuwać.
   - „Przesuń” (punkt, symbol) działa na jedno przeciągnięcie: po upuszczeniu zapis i koniec trybu.
   - „Kształt” (strzałka, linia, rejon): uchwyty wierzchołków i przeciąganie całości. Przy rysunku pływają przyciski ✓ (zapis) i ✕ (anuluj), podążające za nim. Zakończenie także kliknięciem w pustą mapę lub Enterem, anulowanie Esc.
5. Rysunki są zapisywane per tura w `player/notes/NNN.json` (`PUT /api/notes`). Na początku nowej tury rysunki z poprzedniej tury są przenoszone automatycznie, żeby nie trzeba było rysować od nowa.
6. W archiwum widać rysunki z danej tury (bez edycji).
7. **Szkic jako załącznik rozkazu:** przy pisaniu wiadomości można dołączyć rysunki (lista nazw do zaznaczenia). Wiadomość w outbox ma `attachments: [id…]`, a w wątku widać „📎 Rejon A”. Kliknięcie załącznika pokazuje rysunek na mapie.
8. Walidacja serwera: geometria w formacie GeoJSON, rodzaj z listy, nazwa ≤ 60 znaków, maksymalnie 500 rysunków.
9. **Miarka** (narzędzie na pasku):
   - kliknięcia wyznaczają kolejne punkty trasy,
   - na bieżąco widać długość odcinka i całości w km oraz szacowany czas przejścia: piesza 4 km/h, kolumna kołowa 30 km/h, gąsienicowa 20 km/h, w terenie połowa tych prędkości,
   - podwójne kliknięcie albo Esc kończy pomiar,
   - kolejne użycie narzędzia lub przycisk „Wyczyść” usuwa pomiar.
10. Wiadomość z załącznikami zapisuje w outbox **kopię** dołączonych rysunków (nazwa, opis, geometria), żeby późniejsza edycja szkicu nie zmieniała treści wysłanego rozkazu.

**Scenariusze testowe**
- [A] `PUT /api/notes` zapisuje rysunki do `player/notes/<bieżąca>.json`, a `GET /api/notes/:n` je zwraca.
- [A] Gdy brak notatek dla bieżącej tury, `GET /api/notes/<bieżąca>` zwraca notatki z ostatniej wcześniejszej tury (przeniesienie).
- [A] `PUT` w archiwalnej turze daje 409, a niepoprawna geometria albo nieznany rodzaj daje 400.
- [A] Wiadomość z `attachments` zawierającym nieistniejący rysunek daje 400. Z istniejącym rysunek jest zapisany w outbox.
- [A] Odległość: Suwałki–Augustów w linii prostej to ok. 30 km (±1 km). Czas: 30 km kolumną kołową po drodze daje „1 h”.
- [A] Grot strzałki: dla linii [[0,0],[0,1]] grot wskazuje „na północ” (wierzchołki symetryczne względem osi linii).
- [M] Narysowanie strzałki, rejonu, punktu i symbolu, odświeżenie strony: wszystko zostaje.
- [M] Rozkaz z załącznikiem „Rejon A” pokazuje 📎 w wątku, a kliknięcie podświetla rejon na mapie.
- [M] Miarka od Suwałk do Sejn pokazuje ok. 30 km i czasy przejścia.

## T12.1 — Stan osobowy i sprzęt jednostek ✅
**WA**
1. Jednostka własna może mieć:
   - `personnel: { current, authorized }`,
   - `equipment: [{ name, current, authorized }]` (główny sprzęt, np. czołgi, KTO, haubice).
2. Karta jednostki pokazuje:
   - stan osobowy „610 / 650 (94%)”,
   - tabelę sprzętu z liczbami obecnymi i etatowymi,
   - kolor wg ukompletowania: ≥ 80% zielony, 50–79% żółty, < 50% czerwony.
3. Podpowiedź po najechaniu pokazuje skrót, np. „~610 żołn. · Leopard 2PL 41”.
4. Kontakt wroga może mieć `estimate_equipment: [{ name, count }]` i `estimate_personnel`. Karta pokazuje je jako **szacunek** („~30 BTR-82A”) ze źródłem i pewnością kontaktu. Prawdziwe liczby wroga są tylko w `umpire/`.
5. Walidator sprawdza strukturę pól: liczby całkowite ≥ 0, `current ≤ authorized` (inaczej uwaga), nazwy niepuste.
6. Scenariusz testowy ma realistyczne stany dla wszystkich jednostek i szacunki dla kontaktów. W prawdzie są prawdziwe stany obu stron.
7. `CLAUDE.md`: straty przy rozstrzyganiu aktualizują `personnel`, `equipment` i `strength` spójnie, a meldunki podają liczby („utraciliśmy 3 KTO, 14 rannych”).

**Scenariusze testowe**
- [A] Formatowanie: (610, 650) daje „610 / 650 (94%)”, a poziom ukompletowania 0,94 daje „good”, 0,6 daje „warn”, 0,3 daje „bad”.
- [A] Walidator: ujemna liczba sprzętu daje błąd, `current > authorized` daje uwagę.
- [M] Karta bcz pokazuje stan osobowy i liczbę czołgów. Karta kontaktu c-001 pokazuje szacunek sprzętu.

## T12.2 — Znaki taktyczne NATO i poprawka usuwania ✅
**WA**
1. Rysunek ma pole `graphic` (rodzaj znaku, zależny od geometrii `kind`) i opcjonalne `echelon` (D–J, tylko granica) oraz `flip` (strona półkoli/trójkątów). Brak `graphic` = stary rysunek, rysowany jak dotąd.
   - Strzałka (`arrow`): `axis_main` (oś natarcia głównego: dwie równoległe linie wzdłuż ścieżki, grot, półprzezroczyste wypełnienie), `axis_support` (sam obrys), `axis_catk` (obrys przerywany, napis CATK), `direction` (linia z otwartym grotem).
   - Linia (`line`): `phase_line` („PL NAZWA” na obu końcach), `boundary` (oznaczenie szczebla pośrodku: ••• I II III X XX XXX), `flot` (ciągłe półkola ku przeciwnikowi, napis „FLOT” / „ENY FLOT” wzdłuż linii, powtarzany), `obstacle_line` (trójkąty), `line` (zwykła).
   - Rejon (`area`): `generic`, `assembly` (AA), `objective` (OBJ), `engagement` (EA), `battle_position` (BP), `minefield` (obrys + „M”). Własne i ogólne mają kreskowanie ukośne, przeciwnik lekkie wypełnienie.
   - Punkt (`point`): `checkpoint` (CP), `contact_point`, `target` (krzyż), `point` (zwykły). Symbol hipotezy bez zmian.
2. Kolory: własne niebieski, przeciwnik czerwony (linie i obrysy przerywane), ogólne czarny. Rozmiary dekoracji są stałe w pikselach i przeliczane po zoomie oraz podczas przeciągania.
3. Okno rysunku ma „Rodzaj znaku” z podglądem SVG, szczebel granicy i „Odwróć stronę znaku”. Domyślnie: oś = `axis_main`, linia = `phase_line`, rejon = `generic`, punkt = `checkpoint`. Nazwa jest podpowiadana (ALFA, BRAVO…, FLOT/ENY FLOT wg koloru), dopóki gracz jej nie zmieni.
4. Serwer: `graphic` z listy dla danego rodzaju, `echelon` ∈ D–J, `flip` boolean, inaczej 400.
5. Usuwanie: bez natywnego `confirm()` (w osadzonej przeglądarce nie działa). W popupie „Usuń” → „Na pewno usunąć? [Tak, usuń] [Anuluj]”, w oknie edycji „Usuń” → „Na pewno usunąć?”. Działa dla każdego rodzaju, także strzałek.
6. Miarka jest czarna z białym obrysem.

**Scenariusze testowe**
- [A] Przesunięcie odcinka o d daje dwie linie w odległości d; środek łamanej wg długości; półkola FLOT są ciągłe i po wybranej stronie; trójkąty mają zadaną wysokość; obrys osi ma grot na końcu ścieżki.
- [A] `PUT /api/notes` zachowuje `graphic`/`echelon`/`flip`; nieznany `graphic` dla danego rodzaju, `echelon` spoza D–J albo `flip` nie-boolean daje 400; rysunek bez `graphic` jest przyjmowany.
- [A] Lista znaków w UI zgadza się z whitelistą serwera.
- [M] Narysowanie każdego znaku, odświeżenie: wszystko zostaje. Kształt: przeciąganie wierzchołka i całości przesuwa dekoracje i napisy.
- [M] Usunięcie strzałki z popupu (dwa kliknięcia) i z okna edycji działa także w Electronie.

## T12.3 — Klikalne miejsca i jednostki w komunikatorze ✅
**WA**
1. Scenariusz może mieć jawny dla gracza plik `gazetteer.json`: `{ "places": [{ id, name, kind, pos: [lon, lat], zoom?, forms: [...], note? }] }`. `forms` to odmiany nazwy (mianownik, dopełniacz, miejscownik, narzędnik itd.) i musi zawierać `name`. Serwer wystawia go jako `GET /api/gazetteer` (brak pliku daje 404, a klient traktuje to jak pustą listę).
2. Scenariusz testowy ma gazeter z miejscami z odprawy, wiadomości i okolicy. Współrzędne pochodzą z OpenStreetMap Nominatim (punkty przybliżone są opisane w `note`).
3. Moduł `public/js/domain/linkify.js` zamienia w tekście wiadomości (przychodzącej i własnej) wystąpienia miejsc, jednostek własnych, kontaktów (`c-001`) i środków rozpoznania (z pozycją) na przyciski `.mention`. Reszta tekstu jest escapowana.
   - Nazwy jednostek i kontaktów są wrażliwe na wielkość liter. Miejsca są dopasowywane bez względu na wielkość liter, ale wymagają wielkiej litery w tekście.
   - Granice słów są Unicode, a najdłuższe dopasowanie wygrywa i dopasowania się nie nakładają („1k 1bzmot” przed „1bzmot”, „Rutka-Tartak” przed „Rutka”).
4. Kliknięcie miejsca przelatuje mapę do punktu (`zoom` z gazetera, domyślnie 12) i pokazuje pulsujący znacznik z nazwą na ok. 4 s. Kliknięcie jednostki odsłania ją (także ukrytą kompanię), centruje mapę i otwiera kartę. Kontakt i środek rozpoznania otwierają swoją kartę.
5. Styl: miejsce to kropkowane podkreślenie (📍 po najechaniu), jednostka własna jest niebieska, kontakt wroga czerwony. Podpowiedź (`title`) pokazuje rodzaj miejsca albo opis jednostki.
6. Walidator sprawdza `gazetteer.json`: unikalne id, poprawne `pos`, niepuste `forms` zawierające `name`.
7. `CLAUDE.md`: w wiadomościach używaj nazw z gazetera, a nowe miejsce dopisuj do `gazetteer.json` w tej samej turze (z pozycją i odmianami).

**Scenariusze testowe**
- [A] „Z Sejn i w Sejnach” daje dwa linki do tego samego miejsca, a „Sejnyx” i małe „sejny” nie dają żadnego.
- [A] „1k 1bzmot” daje jeden link do kompanii, „Rutka-Tartak” wygrywa z „Rutka”, a „dart” (małą literą) to jednostka, nie miejsce.
- [A] Tekst `<script>` jest escapowany także wokół linków.
- [A] `GET /api/gazetteer` daje 404 bez pliku i listę z plikiem. Walidator zgłasza duplikat id, złe `pos`, puste `forms` i brak `name` w `forms`.
- [M] W wiadomości od S2 „Żytkiejm” i „Wiżajn” są klikalne, a kliknięcie leci na mapie do miejsca i pokazuje pulsujący znacznik, który znika po kilku sekundach.
- [M] Kliknięcie „1k 1bzmot” w poziomie szczegółowości „batalion” odsłania kompanię i otwiera jej kartę. Kliknięcie „c-001” otwiera kartę kontaktu.
- [M] Wycofanie rozkazu i załączniki 📎 nadal działają.

## T12.4 — Panel szczegółów jednostki po lewej ✅
**WA**
1. Szczegóły jednostki, kontaktu i środka rozpoznania pokazuje panel po lewej stronie ekranu (`<aside id="details">`), a nie dymek Leaflet na mapie. Dymki na symbolach zostały usunięte (podpowiedź po najechaniu została). Dymki szkiców (`draw.js`) bez zmian.
2. Panel otwiera się po kliknięciu symbolu na mapie, jednostki w zakładce „Struktura”, linku do jednostki w karcie albo wzmianki w komunikatorze. Jest ukryty, gdy nic nie jest wybrane.
3. Nagłówek: symbol NATO (ok. 40 px), nazwa, opis (`describeSidc`) i przycisk ✕. Zamyka też klawisz Esc. Kliknięcie pustej mapy panelu **nie** zamyka.
4. Treść to wszystko, co miały dymki: stan, siła, stan osobowy z kolorem ukompletowania, tabela sprzętu, przełożony i podlegli jako linki, dla kontaktów blok „Szacunek sił”, czas i wiek obserwacji, źródło, pewność, niepewność. Budowniczowie kart są w `public/js/domain/cards.js`.
5. Kliknięcie symbolu zaznacza go (żółta poświata, magentowe podświetlenie linii podporządkowania). Kliknięcie innej jednostki podmienia treść. Zmiana tury odświeża treść albo zamyka panel, gdy obiektu już nie ma.
6. Panel ma szerokość ok. 320 px, zmienianą uchwytem (dwuklik przywraca domyślną), zapamiętaną w `ks:details-width`. Mapa przelicza rozmiar (`invalidateSize`) i linia kanału do jednostki aktualizuje się przy otwarciu, zamknięciu i zmianie szerokości.
7. Na wąskich ekranach (< 900 px) panel zasłania mapę na całą szerokość.

**Scenariusze testowe**
- [A] `unitCard` pokazuje „610 / 650 (94%)”, sprzęt i linki `data-unit` do przełożonego i podległych, escapuje nazwy; `header: false` pomija nagłówek.
- [A] `contactCard` zawiera blok „Szacunek sił” i niepewność położenia.
- [M] Kliknięcie symbolu bcz otwiera panel z jego danymi. Kliknięcie innej jednostki podmienia treść, a kliknięcie pustej mapy nic nie zamyka.
- [M] ✕ i Esc zamykają panel, a mapa wypełnia wolne miejsce.
- [M] Kliknięcie jednostki w „Struktura” i wzmianki „BSP-1” w komunikatorze otwiera panel. Kliknięcie linku „Przełożony” w karcie przechodzi do przełożonego.
- [M] Przeciągnięcie uchwytu zmienia szerokość, a po odświeżeniu strony szerokość zostaje.

## T13 — Hierarchia jednostek do poziomu kompanii ✅
**WA**
1. Jednostka może mieć pole `parent` (id jednostki nadrzędnej). Walidator sprawdza, że rodzic istnieje i nie ma cykli.
2. Przełącznik „Szczegółowość” na mapie: **batalion** (pokazuje jednostki do batalionu, a kompanie są ukryte) albo **kompania** (pokazuje wszystko). Domyślnie: kompania przy dużym przybliżeniu (zoom ≥ 11), batalion przy mniejszym. Wybór ręczny ma pierwszeństwo przed automatycznym.
3. Zakładka **„Struktura”** w panelu: drzewo jednostek (ZT → bataliony → kompanie) z siłą i stanem. Kliknięcie jednostki centruje mapę i otwiera jej kartę.
4. Karta jednostki pokazuje przełożonego i listę podległych.
5. Najechanie na batalion podświetla jego kompanie (gdy są widoczne).
6. **Linie podporządkowania na mapie:** cienkie, półprzezroczyste, niebieskie przerywane linie od symbolu przełożonego do każdego widocznego podwładnego (ZT → bataliony, batalion → kompanie). Linia tylko wtedy, gdy oba końce są widoczne (filtr szczegółowości). Linie są nieaktywne, leżą pod symbolami i mają przełącznik „— Podporządkowanie” w kontrolce warstw. Najechanie na batalion wzmacnia jego linie do kompanii.
7. **Komunikator zawiera całe drzewo jednostek:**
   - kanały jednostek własnych powstają automatycznie z jednostek bieżącej tury z `parent` (id kanału = id jednostki, nazwa = nazwa jednostki),
   - `scenario.json` `channels` dostarcza kanały dodatkowe (przełożony, sąsiedzi, S4, S2) i może nadpisać metadane kanału jednostki o tym samym id (`short`, `description`, `unit`),
   - grupy: Przełożony, Sąsiedzi, Struktura (drzewo), Logistyka, Rozpoznanie,
   - węzły drzewa zwijają się i rozwijają (stan w localStorage), a zwinięty węzeł pokazuje sumę nieprzeczytanych z poddrzewa,
   - tryb skróconych nazw działa (minimalne wcięcia), a linia od wybranego kanału do jednostki działa także dla kompanii.
8. Serwer przyjmuje rozkaz (`POST /api/outbox`) do kanału ze scenariusza albo do dowolnej jednostki z bieżącej tury gracza. Walidator uznaje wiadomość do jednostki za poprawną, gdy jednostka istnieje w danej turze.

**Scenariusze testowe**
- [A] Budowa drzewa: kompanie trafiają pod właściwe bataliony, a jednostki bez rodzica są na górze.
- [A] Filtr szczegółowości: przy poziomie „batalion” kompania (`E`) z rodzicem jest ukryta, a kompania bez rodzica (np. samodzielna krozp) zostaje.
- [A] Walidator: nieistniejący `parent` i cykl A→B→A dają błąd.
- [M] Zbliżenie mapy pokazuje kompanie 1 bzmot. Oddalenie zostawia tylko bataliony.
- [A] Linie podporządkowania: pary (przełożony, podwładny) tylko wtedy, gdy oba końce są widoczne; przy poziomie „batalion” brak linii do kompanii.
- [A] Kanały: jednostka z `parent` dostaje automatyczny kanał, kanał ze scenariusza nadpisuje jego metadane, a suma nieprzeczytanych poddrzewa jest liczona poprawnie.
- [A] Serwer: `POST /api/outbox` do kanału kompanii (jednostka z bieżącej tury) daje 201, a nieznane id daje 400. Walidator akceptuje wiadomość do kompanii.
- [M] Rozkaz wysłany z komunikatora do „1k 1bzmot” trafia do outbox z `channel: "1bzmot-1k"`. Zwinięcie 1 bzmot w drzewie kanałów pokazuje sumę nieprzeczytanych.

## T14 — Dowódcy jako osobni agenci ⬜
Każdy dowódca (podwładny gracza i przeciwnika) ma własny kontekst i nie widzi kontekstu innych.

**WA**
1. Pliki wiedzy dowódców: `umpire/commanders/<id>.md`. Każdy zawiera:
   - kim jest dowódca (osobowość, doświadczenie, styl),
   - jego jednostki,
   - otrzymane rozkazy i szkice,
   - to, co sam wie o sytuacji,
   - dziennik własnych decyzji.
2. Procedura „koniec tury” w `CLAUDE.md`:
   1. sędzia (główny Claude) przygotowuje każdemu dowódcy **tylko** jego wiadomość wejściową (rozkazy od gracza z załączonymi szkicami, meldunki od własnych kompanii, to, co widzi),
   2. uruchamia osobnego agenta na dowódcę, który zna wyłącznie swój plik i tę wiadomość,
   3. agent zwraca decyzję: rozkazy dla kompanii, meldunek do przełożonego i aktualizację swojego pliku wiedzy,
   4. sędzia rozstrzyga skutki wszystkich decyzji naraz, wobec prawdy,
   5. sędzia zapisuje turę.
3. Przeciwnik też działa przez agentów-dowódców, więc nie zna prawdy o graczu, a jedynie wyniki swojego rozpoznania.
4. Agent nigdy nie dostaje `umpire/turns/`, planów innych stron ani plików innych dowódców.
5. Gracz widzi ruchy kompanii (pozycje prawdziwe) i meldunki dowódców w ich kanałach.
6. Scenariusz testowy dostaje kompanie w 1 bzmot i 2 bzmot oraz pliki wiedzy dowódców (2 własnych i 1 przeciwnika).

**Scenariusze testowe**
- [A] Walidator: każdy kanał `subordinate` z `commander` wskazuje istniejący plik `umpire/commanders/<id>.md`.
- [M] Rozkaz do 1 bzmot: „zająć rejon wg szkicu Rejon A”. Po turze kompanie 1 bzmot są w Rejonie A albo dowódca melduje, dlaczego nie. Meldunek pasuje do jego osobowości.
- [M] Dowódca 2 bzmot nie wie o rozkazie wydanym 1 bzmot (sprawdzenie w jego pliku wiedzy po turze).

---

# Etap v0.1.2 — porządki z audytu

Zadania wynikające z [docs/ARCHITECTURE-AUDIT.md](docs/ARCHITECTURE-AUDIT.md).

## T12.5 — Serwer: zapis, bezpieczeństwo, schemat ✅
**WA**
1. **Zapis bez utraty danych:** `writeJson` używa unikalnej nazwy pliku tymczasowego (pid + licznik + losowy sufiks), a operacje „odczyt → zmiana → zapis” (`sendMessage`, `withdrawMessage`, `writeNotes`) idą przez kolejkę per scenariusz (`withLock` w `server/store.js`).
2. **CSRF i DNS rebinding:** `/api/*` wymaga `Host` = `localhost:<port>` lub `127.0.0.1:<port>` (także GET). POST/PUT wymagają `Content-Type: application/json`; jeśli jest `Origin`, musi być `http://localhost:<port>` lub `http://127.0.0.1:<port>` (także DELETE). Inaczej 403.
3. **Schemat:** `docs/SCHEMA.md` opisuje każdy plik scenariusza (pola, typy, wymagalność, co wolno w plikach gracza, a co tylko sędziemu). `scenario.json` ma `schemaVersion: 1`.
4. **Moduł wspólny:** `shared/schema.js` (czysty JS) trzyma stałe i walidatory (współrzędne, rodzaje szkiców i znaków, linie, kanały, `checkNote`, biała lista pól gracza). Używają go `server/store.js` i `tools/validate.js`. Serwer udostępnia go tylko do odczytu pod `/shared/schema.js` (jawna lista plików).
5. **Strażnik wycieku:** walidator zgłasza **błąd**, gdy plik gracza (`player/turns`, `inbox`, `outbox`) zawiera pole spoza białej listy (np. `side`, `supply`, `events`), i waliduje `player/notes/*.json` przez wspólne `checkNote`.

**Scenariusze testowe**
- [A] 20 równoległych `POST /api/outbox` → 20× 201 i 20 wiadomości na dysku, bez plików `.tmp`; mieszanka równoległych wycofań i wysyłek zostaje spójna (`test/store-concurrency.test.js`).
- [A] POST z `text/plain`, z obcym `Origin` albo obcym `Host` → 403; GET `/api/*` z obcym `Host` → 403; prawidłowe żądanie klienta przechodzi (`test/security.test.js`).
- [A] Kopia scenariusza z `supply` w jednostce gracza → błąd walidatora; niepoprawny szkic w `player/notes` → błąd; brak/obca `schemaVersion` (`test/schema.test.js`).
- [A] `GET /shared/schema.js` → 200, inne pliki w `/shared/` → 404.

## T12.6 — Klient: jednokierunkowy MVC ✅
Refaktor `public/js/` bez zmiany wyglądu i zachowania. Opis: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**WA**
1. **Model:** jeden obserwowalny store (`core/store.js`) z plastrami: scenariusz, tury, tura oglądana, wiadomości, szkice, gazeter, zaznaczenie, szczegółowość, preferencje UI. Flaga archiwum jest wartością pochodną (`archive`) — jedna kopia zamiast trzech.
2. **Kontroler:** `core/controller.js` przyjmuje intencje widoków (`selectEntity`, `showTurn`, `sendMessage`, `withdrawMessage`, `saveNotes`, `setDetail`, `openBriefing`, `mentionClick`…), woła `api.js` i aktualizuje store. Odpowiedzi na starsze żądania są odrzucane (token sekwencji).
3. **Widoki** (`views/`): mapa, komunikator, panel szczegółów, struktura, legenda, szkice, linia do jednostki, pasek górny, odprawa, panele, toasty. Subskrybują plastry store i zgłaszają intencje; **nie importują się nawzajem**. `main.js` to bootstrap.
4. **Domena** (`domain/`): czysta logika bez DOM (sidc, orbat, strength, geo, tactical, linkify, format, cards, markdown, messages, entities).
5. **Odświeżenie SSE jest różnicowe:** zmiana w `inbox` odświeża tylko wiadomości; nie przebudowuje mapy, nie zamyka panelu szczegółów ani edytora szkicu, nie resetuje zaznaczenia i przewijania.
6. **Poprawki:** w archiwum komunikator pokazuje tylko wiadomości do oglądanej tury (nieprzeczytane też); zamknięty panel szczegółów nie otwiera się sam po zmianie tury; `api.js` zawsze wysyła `Content-Type: application/json`; komunikaty błędów są escapowane.
7. `docs/ARCHITECTURE.md` opisuje warstwy, regułę zależności, przepływ akcji i SSE oraz jak dodać widok.
8. `npm run smoke` (`tools/smoke.mjs`) uruchamia własny serwer na kopii scenariusza i przechodzi trasę po funkcjach w headless Chrome; kończy z kodem ≠ 0 przy błędzie JS lub nieudanym kroku.

**Scenariusze testowe**
- [A] Store: powiadomienia tylko dla zmienionych plastrów, jedno powiadomienie na `set`, wartość pochodna `archive` (`test/store.test.js`).
- [A] Kontroler z fałszywym API: spóźniona odpowiedź odrzucona, filtr wiadomości w archiwum, odświeżenie bez zmian nie powiadamia nikogo, ręczna nawigacja nie jest nadpisana przez odświeżenie (`test/controller.test.js`).
- [A] Testy logiki importują z `public/js/domain/` i przechodzą bez zmian zachowania.
- [M/A] `npm run smoke`: tury i archiwum, komunikator (nieprzeczytane, wysyłka, wycofanie, 📎, wzmianki), panel szczegółów (klik, Esc, ✕, szerokość), struktura, szczegółowość i linie magenta, legenda, szkice (wszystkie znaki NATO, ✓/✕, usuwanie), miarka, podkład ciemny Esri, odprawa, żywa aktualizacja po nowym pliku tury.

## T12.7 — Nowy interfejs (styl Palantir) ✅
Przebudowa wyglądu i układu wg [docs/UI-DESIGN.md](docs/UI-DESIGN.md) (makieta: `public/mockup.html`) bez utraty funkcji.

**WA**
1. **Układ:** pasek górny (logo, omnibox, zegar z numerem tury i DTG, pigułka „SKRZYNKA · N”, odprawa, powiadomienia, pomoc, przełączniki docków), lewy dok (Struktura nad Inspektorem), mapa z pływającymi paletami, prawy dok (Komunikator), dolna oś czasu tur. Tokeny CSS 1:1 z §4 (`css/tokens.css`), CSS podzielony na pliki per obszar, jawna skala z-index.
2. **Wszystkie panele zmienialne** (splittery §3.4): szerokość lewego i prawego docka, podział Struktura/Inspektor, wysokość osi czasu i pola wiadomości. Linia 1 px z szerokim polem chwytu, akcent przy hover/drag, dwuklik i Home = domyślna, strzałki (Shift = 48 px), zapis w `localStorage` (`ks.split.*`), min/max wg specyfikacji, mapa ≥ 320 px. Dok zwija się do szyny 40 px z ikonami i licznikiem nieprzeczytanych (przeciągnięcie poniżej 160 px, przycisk, Alt 1 / Alt 2). Na ≤ 760 px splittery są wyłączone, a dolny pasek zakładek przełącza Mapa / Struktura / Szczegóły / Komunikator.
3. **Struktura:** własne siły jako drzewo z liniami `├─ └─ │`, zwijaniem, miniaturami NATO, paskami siły i plakietką nieprzeczytanych; poniżej lepkie sekcje: Przełożony i sąsiedzi, Kontakty przeciwnika, Środki rozpoznania. Filtr (`/`), nawigacja strzałkami, dwuklik / ikona „kanał” otwiera rozmowę.
4. **Inspektor** (Przegląd · Zaopatrzenie · Historia; kontakt jako szacunek z plakietką „NIE PRAWDA”); jedno zaznaczenie `store.selection` we wszystkich widokach.
5. **Komunikator:** pasek przypiętych kanałów + popover „Wszystkie kanały” (zamiast drzewa kanałów), karty wiadomości (nadawca, rola, znaczniki, DTG i tura, chipy wzmianek, załączniki, stan doręczenia), komponowanie z rodzajem (Rozkaz / Zarządzenie / Meldunek / Wiadomość), przełącznikiem „Pilne”, szablonami i podpowiedziami `@` (jednostka) oraz `#` (miejsce). Linia do jednostki wychodzi z aktywnej karty kanału.
6. **Typ i priorytet są zapisywane:** wiadomości w `outbox` mają `type` (`rozkaz` | `zarzadzenie` | `meldunek` | `wiadomosc`) i `priority` (`normal` | `urgent`); inbox może je mieć (pisze sędzia). Schemat, serwer, walidator, `docs/SCHEMA.md` i `CLAUDE.md` zaktualizowane.
7. **Omnibox (Ctrl K):** jednostki, kontakty, środki rozpoznania, miejsca z gazetera, szkice i polecenia; filtry, ranking, Enter = zaznacz i leć, Shift+Enter = kanał / szczegóły.
8. **Oś czasu:** węzły tur, ścieżki wiadomości / rozkazów / kontaktów (wg `type`), klik w turę = archiwum (bursztyn), zablokowany przełącznik „Po bitwie” (aktywny tylko przy `status: "finished"`).
9. Odprawa jako dokument pełnoekranowy ze spisem treści; legenda jako popover mapy („Na mapie” / „Zasady”); toasty i historia powiadomień (dzwonek); pasek stanu z kursorem, MGRS, zoomem i podkładem; domyślny podkład „Ciemna (Esri)”.
10. Zachowane funkcje: tury i archiwum, szczegółowość i magentowe linie podporządkowania, podświetlenie, wszystkie znaki NATO z ✓/✕ i dwuetapowym usuwaniem, miarka (czarna), podpisy `is-dark-base`, odprawa przy pierwszym uruchomieniu, żywa aktualizacja, odporność na wyścigi.

**Scenariusze testowe**
- [A] MGRS (znane punkty), ranking omniboksu („1 bzmot” pierwszy), budowa osi czasu, ograniczanie splitterów (min/max/zwinięcie/klawiatura), wzmianki @ i #, rodzaje wiadomości, DTG, dokument odprawy (`test/ui-logic.test.js`); typ i priorytet w schemacie, API i walidatorze (`test/message-meta.test.js`); karty inspektora (`test/cards.test.js`).
- [A] Kontroler: domyślny podkład, preferencje, przypinanie kanałów, separator „NOWE”, toast pilnej wiadomości, licznik skrzynki (`test/controller.test.js`).
- [M/A] `npm run smoke`: układ, omnibox (Ctrl K → „1 bzmot” → Enter), klik w oś czasu → archiwum, przeciągnięcie splittera zmienia szerokość i zapisuje się, zwinięcie do szyny i rozwinięcie, rodzaj + „Pilne” zapisane w pliku outbox, legenda jako popover, telefon 390 px.

## T13.1 — Poziom plutonu ✅
Hierarchia jednostek rozszerzona o pluton (wielkość `D`).

**WA**
1. Scenariusz testowy: plutony pod kompaniami (3 × pluton zmechanizowany ~30 żołnierzy i 4 KTO/BWP, 3 × pluton czołgów po 4 Leopardy, 2 × pluton ogniowy po 4 Kraby, 3 × pluton rozpoznawczy w krozp); `player/turns/000.json` i `umpire/turns/000.json` zgodne (umpire z `side` i `supply`). Id `1bzmot-1k-1p`, nazwy `1p 1k 1bzmot`.
2. `domain/orbat.js`: trzy poziomy szczegółowości `battalion` | `company` | `platoon`; automat wg zoomu: kompania od 11, pluton od 13; `hierarchyLinks` respektuje poziom; `minLevelFor`.
3. Przełącznik „Auto / Batalion / Kompania / Pluton” (klawisze 1–4); pokazanie ukrytego plutonu ze struktury, omniboksu lub wzmianki przełącza poziom. Drzewo pokazuje plutony (zwinięte pod kompaniami); komunikator adresuje plutony jak każdą jednostkę.

**Scenariusze testowe**
- [A] Widoczność i linie na trzech poziomach, `minLevelFor`, zoom automatyczny (`test/logic.test.js`); odsłanianie plutonu (`test/controller.test.js`).
- [M/A] `npm run smoke`: poziom „Pluton” pokazuje plutony i magentowe linie kompania → plutony; `npm run validate -- 00-test-przesmyk` bez błędów.

## T13.4 — Rozstawianie ręczne na zrzucie mapy ✅
Sędzia (Claude) rozmieszcza plutony „jak dowódca czytający mapę”: ogląda zrzut terenu z siatką pikseli i wskazuje pozycje pikselami, zamiast polegać na samym algorytmie.

**WA**
1. `tools/umpire/terrain-view.mjs` (CLI + import `renderTerrainView`): własny serwer statyczny na losowym porcie + headless Chrome (CDP, losowy port debugowania, tymczasowy profil poza projektem), Leaflet z podkładem `topo` (OpenTopoMap) / `osm` / `satellite` / `dark`, opcjonalny hillshade; czeka na komplet kafelków (limit 20 s, z raportem brakujących); PNG dokładnie w żądanym rozmiarze. Nakładki: siatka pikseli co `--grid` (podpisy co 100 px), skala w metrach, strzałka północy, strzałka frontu `--facing`, symbole NATO z id, wyróżnienie `--highlight`/`--unit`, kontakty z zasięgiem niepewności (`--contacts`). Sidecar `<out>.json` (środek, zoom, rozmiar, `EPSG:3857`, `pixelOrigin`, `bounds`, `tileSize`, jednostki z pikselami). Zabija wyłącznie własny Chrome (po PID).
2. `tools/umpire/pick.mjs`: `pixelToLonLat` / `lonLatToPixel` (Web Mercator zgodny z Leaflet); CLI `--meta --turn --set "id=x,y" [--track "id=x,y;x,y"] [--check-water] [--write]` zmienia wyłącznie `pos` (i `track`) wskazanych jednostek.
3. Skrypty npm `terrain-view` i `pick`; sekcja „Rozstawianie na mapie (ręcznie, ze zrzutu)” w `docs/UMPIRE-TOOLS.md`; wzmianka w CLAUDE.md.

**Scenariusze testowe**
- [A] `test/umpire-pick.test.js`: rzutowanie (znany punkt Suwałki, środek widoku, round trip < 0,5 px), `snapCenter`/`fitZoom`, parsowanie `--set`/`--track`, CLI `--write` zachowuje resztę pliku (kopia tymczasowa), nieznana jednostka = błąd bez zapisu, klasyfikacja jednostek i filtr `--show`.
- [M] Zrzut na kopii scenariusza (`--unit 1bzmot --zoom 13 --hillshade --facing 330`): kafelki, siatka, symbole i podpisy czytelne; trzy wskazane piksele wracają przez `lonLatToPixel` na te same piksele.

## T13.3 — Narzędzie rozstawiania pododdziałów ✅
Narzędzie sędziego: dowódcy rozstawiają plutony i kompanie według zadania, a nie sztywnym blokiem ani zawsze tą samą „choinką”.

**WA**
1. `tools/umpire/deploy.mjs`: `deploy` i `deployTree` (czyste funkcje, losowość z ziarnem); formacje `obrona`, `natarcie`, `marsz`, `wyczekujace`, `artyleria`, `obserwacja` z parametrami z `docs/UMPIRE-TOOLS.md`; warianty zależne od szerokości odcinka i ziarna (w linii o nierównych odstępach, dwa i odwód za lewym/środkiem/prawym, rzut skośny, szyk); jitter ±10° i ±10–15%.
2. `tools/umpire/terrain.mjs`: woda i las z Overpass z cache na dysku (praca offline), `nudgeOutOfWater` (brzeg + 60 m w głąb lądu), `preferCover`.
3. CLI `tools/umpire/deploy-cli.mjs` (`--unit`, `--formation`, `--facing`, `--frontage`, `--terrain`, `--write` zmienia tylko `pos`); dokumentacja w `docs/UMPIRE-TOOLS.md`, wzmianka w CLAUDE.md.

**Scenariusze testowe**
- [A] `test/umpire-deploy.test.js`: rozstawy i orientacja, determinizm, jitter, marsz po trasie, artyleria poza prostą, woda (z wyspą) i korekta na sztucznym jeziorze, CLI `--write`, układy wyraźnie różne dla różnych zadań, azymutów i ziaren.
- [M] Rozstawienie batalionu w obronie na azymut 330 z `--terrain` na kopii scenariusza: sensowny front na NW, nic w jeziorach Hańcza i Wigry.

## T12.8 — Animacja przemieszczeń między turami ✅
Po przejściu z tury N do N+1 symbole przesuwają się z dawnej pozycji na nową, zamiast „skakać”.

**WA**
1. **Dane:** opcjonalne `track: [[lon,lat], …]` w jednostkach pliku gracza (`player/turns/NNN.json`) = trasa przejechana w turze kończącej się w `pos` (pierwszy punkt = poprzednia pozycja). `shared/schema.js` (biała lista, `checkTrack`), `tools/validate.js` (≥ 2 poprawne punkty — błąd; ostatni punkt ≠ `pos` w granicach 1e-6 albo pierwszy ≠ poprzednia pozycja — uwaga) i `docs/SCHEMA.md`.
2. **Zachowanie:** przy przejściu N → N+1 (żywa aktualizacja albo „następna tura” na osi czasu / klawisz `.`) jednostki (i środki rozpoznania z pozycją), które zmieniły pozycję, jadą po `track` albo po prostej; całość ~2,5 s, wszystkie kończą jednocześnie (prędkość zależy od długości trasy), płynny start i hamowanie. Linie podporządkowania, poświata zaznaczenia, linia komunikatora i etykiety podążają za symbolem. W trakcie ruchu cienki przerywany ślad, który po ~3 s blaknie i znika.
3. **Kontakty wroga** nie jadą (mgła wojny — to tylko meldunki): kontakt o tym samym `id` ze zmienioną pozycją pokazuje przerywaną linię „ducha” od starej do nowej zameldowanej pozycji i gasnący stary symbol, a nowy symbol pulsuje raz.
4. **Powtórka:** przycisk „▶ Odtwórz turę” na osi czasu i polecenie omniboksu odtwarzają przejście z poprzedniej tury do oglądanej. Skok o więcej niż jedną turę, cofanie i otwarcie archiwum nie animują (natychmiast); pierwsza tura nie ma powtórki.
5. **Ustawienia:** `prefers-reduced-motion: reduce` wyłącza animację (także po zmianie w trakcie pracy); przełącznik „Animacje” w panelu Warstwy (zapamiętany w `localStorage`: `ks:animations`) — wyłączone = natychmiast, także powtórka (z komunikatem).
6. Klik w mapę (lub Esc) w trakcie animacji kończy ją od razu; interakcje nie są blokowane.
7. **Architektura:** czysta matematyka i plan ruchu w `domain/motion.js` (długość i punkt na łamanej, wygładzenie, `buildPlan`); kontroler ustawia plaster `animation` (`{ nonce, from, to, plan, ms }`) tylko dla kolejnych tur; widok `views/map/motion.js` go odtwarza (zob. `docs/ARCHITECTURE.md`).

**Scenariusze testowe**
- [A] `test/motion.test.js`: wygładzenie, długość i punkt na łamanej, ślad, trasa domykana pozycjami tur, plan ruchu (kto jedzie, track vs prosta, duchy kontaktów, wspólny koniec), tury po kolei.
- [A] `test/animation.test.js`: kontroler zleca animację tylko dla N → N+1 (live i „następna”), nie dla skoku/cofnięcia/archiwum, nie przerywa jej odświeżenie bez zmiany tury, przełącznik i reduced-motion wyłączają, powtórka i polecenie omniboksu.
- [A] `test/neighbours.test.js`: `track` w schemacie i walidatorze (błąd / uwagi / poprawny).
- [M/A] `npm run smoke`: pozycja symbolu zmienia się w czasie po trasie (nie po prostej) i kończy na nowej pozycji w ~2,5 s; ślad, duch kontaktu, pulsowanie, poświata zaznaczenia i linia komunikatora podążają; klik w mapę kończy; „Odtwórz turę” i omnibox; skok T0 → T2 i cofnięcie natychmiast; przełącznik „Animacje” i emulowane reduced-motion = natychmiast.

## T13.2 — Formacje sąsiadów ✅
Sąsiednie brygady (np. `zt-mamry`, `zt-biebrza`) mają własne pododdziały w plikach gracza. Są przyjazne, ale gracz nimi nie dowodzi.

**WA**
1. **Dane:** jednostka sąsiada ma `formation: "<id jednostki sąsiada>"` zamiast `parent` (wskazywana jednostka istnieje w tej samej turze i sama nie ma `parent` ani `formation`; nie ma cykli; `parent` + `formation` naraz = błąd). Podwładni takiej jednostki mogą używać `parent` (należą do formacji pośrednio). Opcjonalne `lines[].formation` (np. FLOT sąsiada) wskazuje tę samą jednostkę. Schemat, biała lista, walidator, `docs/SCHEMA.md`.
2. **Struktura:** w sekcji „Przełożony i sąsiedzi” sąsiad z jednostkami to rozwijany węzeł z tym samym drzewem i łącznikami, przygaszony, oznaczony „sąsiad”; jednostki sąsiada nie mają przycisku kanału ani plakietek nieprzeczytanych, dwuklik ich nie otwiera jako kanałów; nie liczą się do „Sił własnych”.
3. **Komunikator:** jednostki z `formation` (i ich podwładni) nie mają kanałów (`mergeChannels`); serwer odrzuca `POST /api/outbox` do ich id (400). Kanał samego sąsiada ze `scenario.json` działa jak dotąd.
4. **Mapa:** jednostki sąsiada widoczne wg szczegółowości jak własne (batalion — dowództwo i batalion sąsiada, kompanie wyżej); linie dowództwo sąsiada → jego jednostki cienkie szare przerywane (nie magenta); podpowiedź „Sąsiad — brak dowodzenia”. „Pokaż wszystkie siły własne” pomija sąsiadów.
5. **Inspektor:** karta tylko do odczytu z adnotacją „Sąsiad — brak dowodzenia”, bez akcji „Wiadomość” i „Rozkaz…”, bez zakładek dziennika.
6. **Omnibox:** kategoria „Sąsiedzi” (jednostki formacji, dowództwa sąsiadów i kanały `neighbor`).

**Scenariusze testowe**
- [A] `test/neighbours.test.js`: `formationRootId`, `mergeChannels` bez kanałów sąsiada, `splitUnits` / `formationTree`, `buildTree` i `childrenOf`, widoczność wg poziomu, linie `neighbour`, omnibox „Sąsiedzi”, karta z adnotacją, walidator (formation: brak celu, cykl, parent+formation, linie, białą listę), serwer: POST do jednostek sąsiada → 400, do własnej kompanii i kanału sąsiada → 201.
- [M/A] `npm run smoke`: sąsiad w drzewie z rozwijanymi jednostkami (bez kanałów i plakietek), `store.channels` bez nich, POST → 400, szare przerywane linie na mapie, inspektor z adnotacją i bez akcji, omnibox „Sąsiedzi”, jednostka sąsiada jedzie w animacji (track).

---

# Etap v0.1.3 — uwagi po rozgrywce „Przesmyk” nr 1

Źródło: [docs/WNIOSKI-PRZESMYK-1.md](docs/WNIOSKI-PRZESMYK-1.md) (18 tur, 2026-10-12).

## T33 — Komunikator wygodniejszy ✅
**WA**
1. Dwuklik na jednostkę (mapa, hierarchia, karta) otwiera jej kanał w komunikatorze.
2. Szkic wiadomości jest osobny dla każdego kanału: po przełączeniu adresata niewysłany tekst zostaje przy poprzednim i wraca po powrocie.
3. Wybór adresata bez dropdownu: lista kanałów (przełożony, sąsiedzi, podwładni, sztab) stale na wierzchu, z wyszukiwaniem dla kompanii.
4. Domyślny typ wiadomości dla kanału podwładnego: „rozkaz”.
5. Ostrzeżenie (nieblokujące), gdy treść wymienia inną własną jednostkę niż adresat.
6. Nazwa spoza gazetera w treści: podpowiedź „wskaż na mapie” (pinezka trafia jako załącznik).
7. Strzałka w załączniku ma widoczny grot już przy rysowaniu.

**Scenariusze testowe**
- [M] Dwuklik na bcz otwiera kanał bcz; szkic wpisany do 1 bzmot nie przechodzi do 2 bzmot po przełączeniu.
- [A] Stan szkiców per kanał w store (test domeny).

## T34 — Linkowanie nazw bez kolizji ✅
**WA**
1. Dopasowanie nazw najdłuższe pierwsze.
2. Fraza z dopiskiem „(RU)”/„(BY)” albo nazwa kontaktu nie linkuje do własnej jednostki.

**Scenariusze testowe**
- [A] „bcz (RU) naciera” nie tworzy linku do jednostki `bcz`.

## T35 — Hierarchia po przepięciu podporządkowania ✅
**WA**
1. Drzewo ORBAT przelicza się z bieżącej tury: zmiana `parent` (np. `krozp-2p` → `1bzmot-3k`) i nowa jednostka (np. `bopl-1p`) są widoczne od tury, w której wystąpiły.
2. Karta jednostki pokazuje aktualnego przełożonego.

**Scenariusze testowe**
- [A] Test domeny orbat: dwie tury z różnym `parent` dają różne drzewa.
- [M] W rozgrywce „Przesmyk” nr 1 (tura 13+) 2p krozp jest pod 3k 1 bzmot.

## T36 — Narzędzie tury dla sędziego ✅
**WA**
1. `tools/umpire/turn.mjs`:
   - tworzy `umpire/turns/(N+1).json` z tury N (zmiany z pliku planu lub API),
   - wylicza `track` z różnicy pozycji,
   - generuje `player/turns/(N+1).json` tylko z pól z białej listy,
   - sortuje wiadomości `inbox` po czasie,
   - zapisuje w kolejności umpire → inbox → player/turns.
2. `pick.mjs`: limit czasu dla Overpass; po przekroczeniu tryb offline z ostrzeżeniem, bez zawieszenia.
3. Opis w docs/UMPIRE-TOOLS.md.

**Scenariusze testowe**
- [A] Tura bez ruchu nie ma `track`; tura z ruchem ma `track` od starej do nowej pozycji; pola sędziego nie trafiają do gracza.
- [A] `pick --check-water` przy niedostępnym Overpass kończy się w < 30 s z ostrzeżeniem.

## T37 — Walidator: spójność i realizm ✅
**WA** (uwagi, nie błędy):
1. Suma `personnel`/`equipment` plutonów różna od stanu kompanii.
2. Jednostka w wodzie (z cache `terrain.mjs`, bez sieci).
3. Wiadomości `inbox` poza kolejnością czasu.
4. Nazwa jednostki wroga zawiera nazwę własnej jednostki.
5. `status: finished` bez `umpire/aar.md` (z T29).

**Scenariusze testowe**
- [A] Każdy z pięciu przypadków daje uwagę; czysty scenariusz — 0 uwag.

## T38 — Plan wdrożenia na serwer dla dwóch graczy ⬜
Zadanie planistyczne: wynikiem jest dokument `docs/DEPLOYMENT.md`, a nie kod.

**WA**
1. Model gry dwóch graczy, z wyborem i uzasadnieniem jednego z wariantów:
   - gracz przeciw graczowi (każdy dowodzi jedną stroną, Claude jako sędzia),
   - współpraca (dwaj dowódcy po tej samej stronie, np. sąsiednie zgrupowania).
2. Rozdzielenie widoków:
   - każdy gracz widzi tylko swoje `player/` (własne tury, inbox, outbox, notatki),
   - `umpire/` nigdy nie jest serwowane,
   - zmiany w `store.js`, API i schemacie.
3. Tożsamość i dostęp: logowanie albo link z tokenem, sesje, HTTPS, ochrona przed podglądaniem cudzej strony.
4. Rytm tury: kto i kiedy zgłasza „koniec tury”, oczekiwanie na obu graczy, rozstrzyganie przez Claude (lokalnie albo agent na serwerze).
5. Hosting: wybór (VPS, kontener, PaaS), domena, kopie zapasowe scenariuszy, koszt, wdrażanie aktualizacji.
6. Lista zadań wykonawczych (T39+) z WA, dopisana do tego pliku.

**Scenariusze testowe**
- [M] Przegląd dokumentu z graczem: decyzje z punktów 1–5 zaakceptowane.

## T39 — Plan interakcji z AI (sędzia bez API) ⬜
Zadanie planistyczne, powiązane z T38: wynik w `docs/AI-INTERFACE.md`. Cel: sędzia (Claude) działa w ramach subskrypcji Claude, bez płatnego API, gdy gra stoi na serwerze.

**Warianty do porównania**
- **A. Pliki + lokalny Claude Code (stan obecny, zsynchronizowany):** serwer serwuje gre, a stan synchronizuje się z komputerem prowadzącego (git / rsync / folder synchronizowany). „Koniec tury” wyzwala prowadzący. Najprościej, ale wymaga obecności prowadzącego.
- **B. Zdalny serwer MCP gry:** serwer gry wystawia narzędzia MCP (`get_turn`, `get_orders`, `write_turn`, `validate`, `send_messages`), dodane jako własny konektor w claude.ai lub Claude Code. Narzędzia pilnują uczciwości: `umpire/` tylko przez MCP, walidacja przed zapisem. Działa z subskrypcją; trzeba uwierzytelnić konektor (OAuth/token).
- **C. Claude Code na serwerze (headless):** `claude -p` zalogowany subskrypcją, uruchamiany przez serwer, gdy obaj gracze zgłoszą koniec tury. W pełni automatycznie; sprawdzić warunki subskrypcji dla użycia automatycznego i limity.
- **D. Repozytorium git + chmurowa sesja / rutyna Claude Code:** rozkazy z aplikacji trafiają jako commit; rutyna lub sesja w chmurze rozstrzyga turę i wypycha wynik. Bez własnego procesu AI na serwerze; opóźnienie zależne od wyzwalacza.
- **E. (dla porównania) API Claude:** najpewniejsze i w pełni automatyczne, ale płatne za użycie.

**WA**
1. Każdy wariant opisany: przepływ tury, kto wyzwala, opóźnienie, koszt, ograniczenia subskrypcji, ryzyko wycieku `umpire/`.
2. Rekomendacja i plan przejścia (np. A teraz → B docelowo).
3. Dla wariantu wybranego: lista zadań wykonawczych z WA (np. serwer MCP: narzędzia, uwierzytelnienie, testy).

**Scenariusze testowe**
- [M] Przegląd dokumentu z graczem; wybrany wariant zaakceptowany.

## T40 — Porządki architektoniczne ✅
Wyrównanie kodu do etapu „plan architektoniczny” (nagłówek pliku).

**WA**
1. Warstwa logistyki mapy wydzielona z `views/map/index.js` do `views/map/logistics.js`; `LG_SIDC` w jednym miejscu (domain), bez duplikatu w `inspector.js`.
2. Pliki > ~300 linii przejrzane i rozbite wg odpowiedzialności, gdy ma to sens (`views/draw.js`, `core/controller.js`, `views/messenger.js`, `tools/validate.js`, `domain/tactical.js`, `views/structure.js`, `tools/umpire/turn.mjs`).
3. Test reguły zależności: `domain/` nie importuje spoza `domain/`, `views/` nie importują innych widoków, `core/` nie dotyka DOM (skan importów w `npm test`).
4. Zachowanie aplikacji bez zmian: `npm test` i `npm run smoke` zielone.

**Scenariusze testowe**
- [A] Test reguły zależności wykrywa celowo dodany zakazany import.

## T41 — Plan silnika rozstrzygania (obliczenia poza AI) ⬜
Zadanie planistyczne: wynik w `docs/ENGINE.md`. Cel: deterministyczny silnik (`engine/`, czysty JS, bez zależności) liczy to, co jest rachunkiem, a sędzia (Claude) zostaje przy decyzjach, intencjach, doktrynie przeciwnika i narracji. Spójniejsze wyniki, mniej tokenów, powtarzalność (ziarno losowania).

**Kandydaci do silnika**
- ruch: czas marszu po drogach i w terenie (prędkości wg typu jednostki, teren z `terrain.mjs`, pogoda, noc),
- logistyka: zużycie DOS wg działania (postój < obrona < marsz < natarcie), dowóz po MSR (czas, przepustowość, przerwanie),
- doręczenie rozkazów: czas wg odległości, środka, zagłuszenia, ciszy radiowej (T25/T26),
- wykrycie: prawdopodobieństwo wykrycia przez drony/obserwację (zasięg, czas lotu, pogoda, maskowanie, makiety),
- walka: straty z modelu (np. stosunek sił z modyfikatorami terenu i przygotowania obrony, kalibrowany do ok. 2–3:1 przy obronie przygotowanej), z losowością w rozsądnych granicach,
- rozdział strat na plutony → kompanie → batalion (spójne `personnel`/`equipment`/`strength`).

**WA**
1. Podział odpowiedzialności silnik ↔ sędzia AI: co silnik liczy, co AI decyduje, jak AI może nadpisać wynik (z uzasadnieniem w `umpire/log.md`).
2. Interfejs: wejście (tura N z `umpire/`, rozkazy, plan przeciwnika w formie danych) → wyjście (propozycja tury N+1 dla `tools/umpire/turn.mjs`); powtarzalność przez ziarno.
3. Modele i współczynniki dla każdego kandydata, ze źródłami (doktryna, dane historyczne) i kalibracją na rozgrywce „Przesmyk” nr 1.
4. Miejsce w architekturze (nowy katalog, kierunek zależności, małe moduły) zgodnie z etapem planu architektonicznego; związek z T39 (np. narzędzia silnika wystawione przez MCP).
5. Lista zadań wykonawczych z WA, w kolejności wartości (np. najpierw ruch i DOS, potem doręczenie, wykrycie, walka).

**Scenariusze testowe**
- [M] Przegląd dokumentu z graczem; podział silnik/AI zaakceptowany.

## T42 — Studium wykonalności: płynny upływ czasu w turze ⬜
Zadanie badawcze: wynik w `docs/STUDY-REALTIME.md`. Tury zostają (rozstrzyga je sędzia), ale gracz ma odczuć mijający czas: zegar płynie, meldunki przychodzą o swoich godzinach, jednostki przesuwają się w trakcie okresu, a nie skokiem na końcu.

**Warianty do zbadania**
- **A. Odtwarzanie tury:** po rozstrzygnięciu tura N→N+1 „odgrywa się” w przyspieszonym czasie (np. 2 h w 2–5 min): zegar, animacja ruchu po `track` z czasami punktów, wiadomości `inbox` pojawiają się o swoich `time`. Gracz może pauzować, przyspieszać, cofać. Najmniej zmian (dane już są: `track`, `time` wiadomości).
- **B. Krótsze tury z automatyzacją:** sędzia rozstrzyga co 15–30 min czasu gry, silnik (T41) liczy ruch i zużycie, AI tylko zdarzenia i meldunki. Wymaga T41 i T39.
- **C. Tura z przerwaniem:** czas płynie w odtwarzaniu, a ważne zdarzenie (kontakt, pilny meldunek) zatrzymuje zegar i pozwala graczowi wydać rozkaz od tego momentu; sędzia rozstrzyga resztę okresu od nowa.
- **D. Ciągły czas (pseudo real-time):** stały stosunek czasu gry do rzeczywistego, rozkazy w dowolnej chwili, rozstrzyganie w tle. Sprawdzić koszt AI, opóźnienia, zgodność z modelem dwóch graczy (T38).

**WA**
1. Dla każdego wariantu: wrażenia gracza, zmiany w danych (np. `track` z czasami punktów, `time` dla zdarzeń widocznych), w kliencie (zegar, odtwarzacz), w procedurze sędziego, koszt AI i ryzyko wycieku (żeby odtwarzanie nie zdradziło prawdy przed czasem meldunku).
2. Wpływ na tarcie: rozkaz wydany „w trakcie” obowiązuje od doręczenia (T25); brak informacji zwrotnej zostaje.
3. Prototyp najtańszego wariantu (A) na rozgrywce „Przesmyk” nr 1, jeśli da się go zrobić bez zmian schematu albo z małymi.
4. Rekomendacja i lista zadań wykonawczych z WA.

**Scenariusze testowe**
- [M] Przegląd studium i prototypu z graczem; wybór wariantu.

## T43 — Widok 3D terenu (hybryda) ⬜
Mapa sztabowa zostaje w Leaflet 2D; dochodzi **widok 3D wybranego rejonu** (wariant D z rozmowy 2026-10-12) na MapLibre GL JS.

**WA**
1. Przycisk / polecenie „Widok 3D” otwiera rejon bieżącego widoku mapy w 3D: rzeźba terenu z darmowych danych wysokościowych (np. Terrarium), pochylanie i obrót, budynki z OSM (gdy dostępne).
2. Na widoku 3D: jednostki własne i kontakty (milsymbol jako obrazki), linie (`flot`, `boundary`, `ew_zone`), warstwa logistyki — z tych samych danych tury, tylko do odczytu.
3. Architektura: nowy widok (`views/map3d/`), biblioteka z `/vendor/`, bez importów z `views/map/`; wspólne przekształcenia danych w `domain/`. Wejście do 3D przez store/kontroler.
4. Przed implementacją krótkie porównanie wariantów (MapLibre / Cesium / Google Photorealistic 3D Tiles — koszt, licencja, offline) w `docs/MAP3D.md`; wybór potwierdzony przez gracza.
5. Działa bez klucza API i bez płatności.

**Scenariusze testowe**
- [M] Rejon przesmyku w 3D: widać wzgórza i doliny, jednostki stoją na terenie, obrót i pochylenie płynne.
- [A] Domena: przekształcenie tury na obiekty widoku 3D (pozycje, symbole, linie).

## T44 — Rozkaz graficzny na mapie (jak w RTS) ✅
Gracz zaznacza jednostkę (jedną lub kilka) i wskazuje na mapie cel ruchu albo rubież; to **załącznik do rozkazu**, nie natychmiastowe wykonanie — tarcie (T25) i interpretacja przez podwładnego zostają.

**WA**
1. Tryb „rozkaz graficzny”: zaznaczenie jednostki (klik / ramka / Shift+klik), potem wskazanie: punkt docelowy, trasa (kilka punktów), rubież (linia), rejon (wielokąt). Rodzaje zadań do wyboru: marsz do, zajmij rejon, broń rubieży, natarcie na, rozpoznanie.
2. Wynik trafia do szkicu wiadomości w kanale tej jednostki (T33) jako załącznik strukturalny `{units:[id], task, geometry}` i jest widoczny na mapie jako znak taktyczny (strzałka, rubież) do czasu wysłania.
3. Zaznaczenie jednostek różnych dowódców tworzy osobne szkice w ich kanałach (albo w kanale wspólnego przełożonego — do decyzji w planie).
4. Schemat (`player/outbox`, SCHEMA.md, walidator) dla załącznika; sędzia czyta geometrię i treść razem — niejasność = interpretacja podwładnego.
5. Etap planu architektonicznego: logika zaznaczenia i budowy załącznika w `domain/`, tryb mapy jako osobny plik w `views/map/`.

**Scenariusze testowe**
- [A] Domena: zaznaczenie + punkt/rubież → poprawny załącznik; walidator przyjmuje go w outbox.
- [M] Zaznaczam 1 bzmot, wskazuję rubież, wysyłam rozkaz; w następnej turze batalion melduje zajęcie (lub problem).

## T45 — Pomijanie szczebli dowodzenia: koszt ✅
Rozkaz do jednostki niżej niż bezpośredni podwładny (np. kompania z pominięciem batalionu) ma realistyczny koszt. Tryb ustawiany w scenariuszu: `commandRules.skipEchelon: "off" | "soft" | "hard"`.

**WA**
1. **soft (domyślny):** rozkaz przechodzi, ale:
   - aplikacja pokazuje nieblokujące ostrzeżenie przy wyborze kanału („pomijasz dowódcę 1 bzmot”),
   - sędzia stosuje skutki (zasady w CLAUDE.md): dowódca pominiętego szczebla dowiaduje się z opóźnieniem, jego plan może kolidować (sprzeczne rozkazy, zamieszanie, strata czasu), powtarzane pomijanie obniża inicjatywę podwładnych (czekają na rozkazy z góry) i zaufanie (związek z T28 morale), dowódca może zgłosić zastrzeżenia.
2. **hard:** kanały poniżej bezpośrednich podwładnych są tylko do odczytu (meldunki), z wyjątkiem łączności alarmowej (`priority: urgent`) — ta ma koszt jak w soft.
3. **off:** bez ograniczeń i skutków (tryb treningowy).
4. Schemat: `commandRules` w `scenario.json` (SCHEMA.md, walidator). Logika „ile szczebli pominięto” jako czysta funkcja w `domain/` (z `parent`).
5. Licznik pominięć widoczny dla sędziego w `umpire/` (np. w log.md), nie dla gracza.

**Scenariusze testowe**
- [A] Domena: kanał bezpośredniego podwładnego = 0 pominiętych szczebli, kompania pod batalionem = 1, pluton = 2; tryb hard blokuje wysyłkę poza urgent.
- [M] W trybie soft rozkaz do kompanii działa, a batalion w następnej turze melduje zastrzeżenia lub kolizję planu.

## T46 — Szczegółowe wyposażenie ✅
Sprzęt i uzbrojenie z katalogu zamiast samych nazw: gracz widzi, czym naprawdę dysponuje pododdział.

**WA**
1. Katalog sprzętu (jawny, np. `data/equipment.json` + walidacja w `shared/`): `{id, name, category (pojazd, broń zespołowa, broń indywidualna, ppk, moździerz, BSP…), crew?, weapons?:[{name, range_m, kind: ppanc|plot|ogólny|pośredni}], note}` — np. KTO Rosomak (30 mm), Spike-LR, Piorun, moździerz 60/98 mm, UKM-2000, Grot, Pirat, FlyEye. Dane z jawnych źródeł.
2. `equipment[]` jednostki może wskazywać pozycję katalogu (`ref`) obok `name`; stare pliki bez `ref` działają jak dotąd.
3. Karta jednostki: sprzęt pogrupowany wg kategorii, z zasięgami i liczbami (bieżący / etatowy); dla plutonu także uzbrojenie drużyn (np. „3 × UKM, 2 × Pirat”).
4. Szacunki wroga (`estimate_equipment`) też mogą mieć `ref` do katalogu sprzętu RU/BY (osobna część katalogu).
5. Etap planu architektonicznego: katalog i jego walidacja w jednym miejscu, logika grupowania w `domain/`.

**Scenariusze testowe**
- [A] Walidator: `ref` do nieistniejącej pozycji → błąd; pozycja katalogu bez `range_m` przy broni → błąd.
- [A] Domena: grupowanie sprzętu jednostki wg kategorii, suma z podwładnych.
- [M] Karta plutonu pokazuje drużynowe uzbrojenie z zasięgami.

## T47 — Wizualizacja zasięgu ognia ✅
Na mapie widać, dokąd sięga ogień jednostki (wymaga T46: zasięgi z katalogu).

**WA**
1. Dla zaznaczonej jednostki własnej: okręgi (albo pierścienie) zasięgu wg rodzaju broni — ppanc, plot, broń ogólna, ogień pośredni — w kolorach z legendą; przełączniki rodzajów.
2. Tryb „wszystkie jednostki” dla wybranego rodzaju (np. pokrycie plot całego zgrupowania) jako warstwa.
3. Kontakty wroga: zasięg z szacunku (`estimate_equipment` z `ref`), oznaczony jako szacunkowy (przerywany), z niepewnością pozycji.
4. Wersja 2 (opcjonalnie, z T43): sektory ognia i martwe pola z uwzględnieniem terenu (linia widoczności z danych wysokościowych).
5. Etap planu architektonicznego: geometria zasięgów w `domain/`, warstwa jako osobny plik w `views/map/`.

**Scenariusze testowe**
- [A] Domena: jednostka ze Spike-LR i Piorunem → pierścienie ppanc i plot o właściwych promieniach; brak broni danego rodzaju → brak pierścienia.
- [M] Zaznaczam kompanię: widzę zasięgi; włączam pokrycie plot zgrupowania: widzę luki.

## T48 — CCIR i cykl meldunków ✅
Praca sztabu jak w realnym punkcie dowodzenia: gracz określa, o czym chce być alarmowany, a meldunki przychodzą w stałym rytmie i formacie.

**WA**
1. **CCIR (krytyczne potrzeby informacyjne dowódcy):** gracz definiuje listę (np. 3–7 pozycji) w podziale na PIR (o przeciwniku, np. „czołgi RU na wschód od linii Wiżajny–Rutka-Tartak”) i FFIR (o własnych siłach, np. „stan DOS paliwa batalionu < 1”, „utrata mostu w Szypliszkach”). Edycja w aplikacji, zapis w `player/` (np. `player/ccir.json`, schemat + walidator).
2. Opcjonalnie pozycja CCIR ma geometrię (rejon/linia z mapy) i jest widoczna jako nakładka.
3. **Sędzia (CLAUDE.md):** postacie meldują pilnie (`priority: urgent`) tylko to, co spełnia CCIR, a resztę w meldunkach cyklicznych; meldunek spełniający CCIR ma odwołanie do pozycji (np. `ccir: "PIR-2"` w wiadomości). Postacie mogą się mylić (fałszywy alarm, przeoczenie) — tarcie zostaje.
4. **Cykl meldunków:** w `scenario.json` rytm (np. `reportCycle: {sitrep: 240, logstat: 1440}` w minutach czasu gry, godziny odniesienia). Podwładni wysyłają meldunek sytuacyjny (SITREP) i logistyczny (LOGSTAT) w ustalonym formacie (szablon w CLAUDE.md: położenie, stan, działania, zamiar, potrzeby); spóźniony lub brakujący meldunek sam jest informacją (łączność, kłopoty).
5. Komunikator: wiadomości z `ccir` oznaczone znacznikiem pozycji CCIR; filtr „tylko CCIR”; meldunki cykliczne rozpoznawalne (`type: meldunek`, `report: sitrep|logstat`) i grupowane w osi czasu.
6. Etap planu architektonicznego: model CCIR i dopasowanie wiadomości w `domain/`, edytor jako osobny widok.

**Scenariusze testowe**
- [A] Walidator: `player/ccir.json` poprawny / zły; wiadomość z `ccir` wskazującym nieistniejącą pozycję → uwaga.
- [A] Domena: filtr „tylko CCIR”, grupowanie meldunków cyklicznych.
- [M] Gracz ustawia PIR na kolumnę pancerną; w turze z takim kontaktem przychodzi pilny meldunek z odwołaniem do PIR; drobne kontakty trafiają do SITREP.

## T49 — Pozycje własnych sił z BFT ✅
Jak w BMS: gracz widzi ostatnią pozycję z GPS (Blue Force Tracking), a nie prawdę. Wiąże się z T19 (utrata łączności) i T26 (REW).

**WA**
1. Jednostka własna w `player/turns` ma `pos` = ostatnia zameldowana pozycja i `pos_time` (czas raportu BFT); prawda tylko w `umpire/`. Schemat, SCHEMA.md, walidator (`pos_time` nie późniejszy niż czas tury).
2. Sędzia (CLAUDE.md, `turn.mjs`): pozycje BFT co kilka–kilkanaście minut; w strefie zagłuszenia, przy ciszy radiowej lub utracie łączności pozycja zamarza (luka), pojawia się po odzyskaniu łączności.
3. Mapa: pozycja starsza niż próg (np. 30 min) — symbol przygaszony z czasem ostatniego raportu; `track` animacji kończy się na pozycji BFT, nie prawdziwej.
4. Zmiana wymaga przeglądu reguł w CLAUDE.md („jednostki własne na prawdziwych pozycjach”) — zaktualizować spójnie.

**Scenariusze testowe**
- [A] Walidator: `pos_time` poza okresem tury → uwaga; brak `pos_time` → zgodność wstecz (traktowane jako czas tury).
- [A] Domena: wiek pozycji i próg przygaszenia.
- [M] Kompania w strefie zagłuszenia stoi na mapie w starej pozycji z czasem raportu; po wyjściu ze strefy „przeskakuje”.

## T50 — Formularze meldunków i rozkazów ✅
Obok wolnego tekstu szablony z polami, jak w BMS (wiąże się z T44 — punkt i rubież z mapy).

**WA**
1. Szablony: SPOTREP (co, ile, gdzie, kiedy, kierunek, pewność), LOGSTAT (paliwo, amunicja, ludzie, potrzeby), FRAGO (zadanie, rejon, czas, koordynacja), zapotrzebowanie na ogień (T52). Definicje w jednym module `domain/` (pola, wymagalność, etykiety PL).
2. Komunikator: wybór szablonu wypełnia formularz; pole „gdzie” wskazywane na mapie; wynik to wiadomość z czytelnym tekstem i strukturą `form: {kind, fields}` w `player/outbox` (schemat + walidator).
3. Postacie mogą odpowiadać meldunkami w tych samych formatach (`form` w `inbox`), komunikator renderuje je jako tabelkę.

**Scenariusze testowe**
- [A] Domena: walidacja wymaganych pól szablonu, generowanie tekstu.
- [A] Walidator: `form` w outbox/inbox poprawny / zły.
- [M] Gracz wysyła FRAGO z rubieżą z mapy; podwładny potwierdza w formacie.

## T51 — Nakładki od przełożonego ✅
Rozkaz przełożonego przychodzi z graficzną nakładką (granice, rubieże, osie, rejony), którą gracz włącza i wyłącza jak warstwę.

**WA**
1. Wiadomość `inbox` może mieć `overlay: {id, name, features:[…]}` (te same znaki taktyczne co szkice, `domain/tactical.js`); schemat + walidator.
2. Mapa: lista nakładek (z nazwą i DTG rozkazu) w panelu warstw; każda włączana osobno; nowsza nakładka tego samego rozkazu zastępuje starszą.
3. Gracz może skopiować nakładkę do własnych szkiców i dołączyć ją do rozkazu dla podwładnych.

**Scenariusze testowe**
- [A] Walidator: `overlay` z nieznanym znakiem → błąd.
- [M] Rozkaz brygady z nową granicą: nakładka pojawia się w warstwach, włączam / wyłączam, kopiuję do szkicu.

## T52 — Zgłoszenie ognia i jego status ✅
Gracz zamawia ogień (artyleria, moździerze, ewentualnie lotnictwo) i dostaje status bez prawdy o skutku.

**WA**
1. Formularz zgłoszenia (T50): cel (punkt/rejon z mapy), rodzaj celu, efekt (obezwładnienie, zniszczenie, dymy, oświetlenie), czas, priorytet, kanał do środka wsparcia (np. dart).
2. Sędzia: wykonanie zależy od dostępności środka, amunicji (DOS), doręczenia (T25), zasięgu (T46/T47) i priorytetów przełożonego; odpowiedź w formacie: „przyjęto / odmowa (powód) / wykonano HH:MM, X pocisków, skutek nieznany”. Skutek gracz poznaje tylko z obserwacji (BSP, meldunki).
3. Mapa: zgłoszone i wykonane zadania ogniowe jako znaczniki z czasem (warstwa „Ogień”), bez prawdziwego skutku.

**Scenariusze testowe**
- [A] Domena: model statusu zgłoszenia (cykl: wysłane → przyjęte/odmowa → wykonane).
- [M] Zgłoszenie ognia na kontakt: odpowiedź „wykonano, skutek nieznany”, a skutek widać dopiero w meldunku BSP.

---

# Etap v0.2 — głębia: tarcie, logistyka, nowe wojska (krok 1)

Cel etapu (ustalone w dialogu 2026-10-11): **gra, nie dowód architektury** — decyzje pod presją realnych ograniczeń. Zasady tarcia: **żadnej informacji zwrotnej o doręczeniu** — gracz nie widzi ani „w drodze", ani potwierdzenia; o skutkach rozkazu dowiaduje się wyłącznie z meldunków podwładnych albo z ich milczenia. Mechaniki wprowadzamy **na żywo**, dokańczając bieżącą bitwę w `00-test-przesmyk` jako poligon.

Zalecana kolejność: **T17 + T18** (logistyka jako system) → **T25 + T26** (doręczenie + REW — to jedna mechanika) → **T19** (utrata łączności na tych samych zasadach) → **T27** (saperzy) → **T28** (zmęczenie i morale) → **T15 + T16** (szlif).

- **T15 Pomiar po drogach:** odległość drogowa (routing) i czas marszu dla wybranego typu jednostki. Prosta miarka jest w T12.
- **T16 Starzenie się kontaktów:** symbol blaknie wraz z wiekiem informacji. Próg zależy od typu (pancerne starzeją się szybciej niż artyleria w stanowiskach).
- **T17 Warstwa logistyczna:** patrz sekcja T17 niżej.
- **T18 Panel DOS:** patrz sekcja T18 niżej.
- **T19 Utrata łączności:** jednostka bez łączności jest pokazana na ostatniej znanej pozycji, z czasem ostatniego kontaktu.

## T17 — Warstwa logistyczna ✅
Gracz widzi logistykę tak, jak ją zna jego S4: stan może być nieaktualny, prawda jest tylko w `umpire/`.

**WA**
1. Schemat (shared/schema.js, docs/SCHEMA.md): pole najwyższego poziomu `logistics` w `player/turns` i `umpire/turns`:
   - `depots[]`: `{id, name, pos, stock:{fuel, ammo, general} (t), status, as_of}`,
   - `routes[]`: `{id, name, kind: MSR|ASR, coords, status: open|threatened|closed}`,
   - `bridges[]`: `{id, name, pos, mlc?, status: intact|damaged|destroyed}`,
   - `convoys[]`: `{id, name, pos, from, to, cargo:{fuel, ammo, general}, eta, status, track?}`.
   Walidator sprawdza typy, enumy i unikalność id.
2. Mapa: osobna warstwa „Logistyka” (włącz/wyłącz w legendzie lub warstwach). Trasy MSR/ASR w kolorze statusu, składy, mosty, konwoje jako symbole. Konwoje animowane po `track` jak jednostki.
3. Każdy element ma kartę ze stanem (klik → inspektor), z czasem `as_of` i oznaczeniem, gdy dane są starsze niż 1 turę.
4. `tools/umpire/turn.mjs`: plan może zmieniać `logistics` (umpire i player osobno).

**Scenariusze testowe**
- [A] Walidator: poprawne `logistics` — 0 błędów; zły status / duplikat id — błąd.
- [A] Domena: model karty elementu logistycznego (status, wiek danych).
- [M] Na scenariuszu testowym warstwa pokazuje trasę, skład, most i konwój; klik otwiera kartę.

## T18 — Panel DOS ✅
**WA**
1. Schemat: jednostka własna w `player/turns` może mieć `dos: {fuel, ammo, general, readiness, as_of}` — meldowany stan (dni zaopatrzenia, `readiness` 0–1 = sprawność sprzętu). To meldunek, nie prawda (`supply` zostaje tylko w `umpire/`).
2. Karta jednostki pokazuje DOS z paskami i progami kolorów: ≥ 2 dni zielony, 1–2 żółty, < 1 czerwony (sprawność: ≥ 0,8 / 0,5–0,8 / < 0,5), z wiekiem meldunku.
3. Zbiorczy panel DOS (tabela jednostek własnych, sortowanie po najgorszym wskaźniku); wiersz klikalny → karta jednostki.
4. Jednostka nadrzędna bez własnego `dos` pokazuje minimum z podwładnych (oznaczone jako wyliczone).

**Scenariusze testowe**
- [A] Domena: progi kolorów, agregacja minimum, sortowanie.
- [A] Walidator: `dos` z wartością ujemną lub `readiness` > 1 — błąd; `supply` w pliku gracza nadal błąd.
- [M] Panel DOS na scenariuszu testowym, klik w wiersz otwiera kartę.

## T15 — Pomiar po drogach ✅
**WA**
1. Miarka (T12) ma przełącznik „Po drogach”: punkty A→…→B klikane jak dotąd, a trasa jest prowadzona po drogach między kolejnymi punktami. Linia drogowa jest rysowana na mapie (osobno od linii prostej), a okno pokazuje długość drogową obok prostej.
2. Trasę liczy publiczny router OSRM (`router.project-osrm.org`, profil `driving`) przez serwer gry jako pośrednika: `POST /api/route` z samymi współrzędnymi `[długość, szerokość]` (2–25 punktów, zakres geograficzny, zaokrąglenie do 5 miejsc). Serwer ma limit czasu (4 s), pamięć podręczną (te same punkty = jedna odpowiedź) i wyłącznik (`KS_ROUTER=off`). Przeglądarka nie łączy się z routerem bezpośrednio, serwer nie wysyła nic poza współrzędnymi. Serwer nadal bez zależności.
3. Brak odpowiedzi routera (offline, błąd, limit czasu, brak drogi) nie blokuje miarki: wynik to odległość w linii prostej × współczynnik krętości 1,3, wyraźnie oznaczona „szacunek (linia prosta × 1,3)”, bez linii drogowej.
4. Czas marszu liczony dla wybranego typu jednostki: kołowa, gąsienicowa, piesza; osobne prędkości marszowe dzień i noc (stałe w `domain/`). Typ domyślny wynika z SIDC zaznaczonej jednostki (pancerna → gąsienicowa, zmechanizowana → kołowa, piechota → piesza), gracz może go zmienić; dzień/noc wynika z godziny oglądanej tury (strefa scenariusza) i też można go przełączyć.
5. Mosty z `turn.logistics.bridges` leżące na trasie (do 150 m od linii drogowej) są sprawdzane z masą sprzętu wybranego typu (tabela w `domain/`: kołowa ~26 t Rosomak, gąsienicowa ~60 t Leopard 2, piesza 0): nośność `mlc` mniejsza od masy, most uszkodzony albo zburzony daje ostrzeżenie z nazwą mostu. Przy szacunku (bez trasy) mosty nie są sprawdzane i okno o tym mówi.
6. Logika (typy, prędkości, czas, szacunek, mosty na trasie, odczyt odpowiedzi routera) w czystych modułach `domain/` i `server/route.js`; wywołanie sieci w `core/api.js` + kontrolerze; widok w nowym module `views/draw/roadmeasure.js`. Archiwum: miarka po drogach działa.

**Scenariusze testowe**
- [A] Domena: prędkości dzień/noc dla każdego typu; typ z SIDC; czas marszu = km / prędkość; szacunek = prosta × 1,3 z oznaczeniem.
- [A] Domena: most w tolerancji i poza nią; `mlc` < masa → ostrzeżenie, `mlc` ≥ masa → brak; most zburzony / uszkodzony; pusta lista mostów.
- [A] Domena: odczyt odpowiedzi OSRM (poprawna, `NoRoute`, uszkodzona).
- [A] Serwer: `POST /api/route` z atrapą routera — poprawna trasa; zła liczba punktów / współrzędne spoza zakresu → 400; błąd i przekroczenie czasu → 502; cache (drugie zapytanie bez ponownego wywołania); `KS_ROUTER=off` → 503; wymagany Content-Type JSON.
- [A] Smoke (offline): miarka po drogach z atrapą routera pokazuje „szacunek” albo trasę drogową, czas marszu dla typu i ostrzeżenie o moście.
- [M] Z internetem: trasa wzdłuż drogi, czas dla Leoparda dłuższy niż dla Rosomaka, ostrzeżenie przy moście o niskim `mlc`.

## T16 — Starzenie się kontaktów ✅
**WA**
1. Wiek kontaktu = czas oglądanej tury − `observed` (minuty); kontakt bez `observed` nie starzeje się (krycie 1, brak napisu).
2. Progi zależą od typu z SIDC (funkcja, wymiar): każda klasa ma próg „świeży” (do niego krycie 1) i „stary” (od niego krycie minimalne). Klasy: drony (wymiar `A`) 10 min / 30 min; pancerne, przeciwpancerne, zmechanizowane, zmotoryzowane, rozpoznanie 30 min / 2 h; piechota inna, artyleria, OPL, saperzy, wywiad i REW 1 h / 6 h; logistyka (stałe obiekty, `US…`) 3 h / 12 h; inne i nieznane 45 min / 3 h.
3. Krycie symbolu i koła niepewności maleje liniowo od 1 (wiek ≤ świeży) do minimum 0,35 (wiek ≥ stary).
4. Od progu „stary” podpowiedź nad symbolem i karta kontaktu pokazują napis „informacja sprzed X” (np. „sprzed 2 h 10 min”); karta dodatkowo klasę („stare dane”).
5. Dotyczy wszystkich kontaktów, także z samym `estimate`; nie zmienia danych ani schematu. Nie zmienia logiki BFT własnych jednostek (T49).
6. Logika w czystym module `domain/contactage.js`; widoki tylko go wywołują.

**Scenariusze testowe**
- [A] Domena: klasa z SIDC (dron, czołg, haubica, logistyka, nieznany); wiek 0, na progu świeżym, w połowie, na progu starym i dalej → krycie 1, 0,675, 0,35; brak `observed` → 1.
- [A] Domena: napis „sprzed …” tylko od progu starego; wiek ujemny traktowany jak 0.
- [M] Na scenariuszu testowym stary kontakt czołgów jest wyraźnie bledszy niż ten sam wiek artylerii; karta pokazuje „informacja sprzed …”.

## T19 — Utrata łączności ✅
Jednostka bez łączności jest pokazana na ostatniej znanej pozycji, z czasem ostatniego kontaktu. Pozycja zamrożona i przygaszenie symbolu już są (T49: `pos_time`, `domain/bft.js`, `turn.mjs`); zgubione rozkazy opisuje T25. Brakuje jawnego **stanu łączności** jako wiedzy sztabu i jego pokazania w UI.

**WA**
1. Pole `comms: {status: "ok"|"degraded"|"lost", last_contact: <ISO>}` jednostki własnej w `player/turns` (opcjonalne; brak = `ok`). To wiedza sztabu (co wie SD), nie prawda; prawda łączności jest tylko w `umpire/turns` (`comms_true: {status, since, cause}`, poza białą listą). `last_contact` nie późniejszy niż czas tury; wymagany przy `degraded` i `lost`. Schemat (`shared/comms.js`), SCHEMA.md, walidator (inna wartość statusu, brak `last_contact`, czas z przyszłości = błąd; `comms_true` w pliku gracza = błąd strażnika).
2. Mapa: jednostka `lost` ma wyraźny znacznik „brak łączności” (znak przy symbolu) oraz podpowiedź „brak łączności od HH:MM”; `degraded` — łagodniejszy znacznik („łączność słaba”). Pozycja i przygaszenie z BFT bez zmian.
3. Karta jednostki: wiersz „Łączność” ze statusem, czasem ostatniego kontaktu i wiekiem („brak łączności od 06:12, 48 min”).
4. Komunikator: kanał jednostki bez łączności oznaczony na liście i w nagłówku; wysyłka dozwolona, ale ostrzeżenie pod polem: „brak łączności od HH:MM — doręczenie niepewne”. Bez zmian w statusach doręczenia (zgodnie z T25).
5. `turn.mjs`: `plan.player.units.<id>.comms` (łatka); domyślnie `comms` wyliczane z `comms_true` jednostki (`since` → `last_contact`), `comms` nie jest dziedziczone z tury N (sędzia podtrzymuje stan co turę, odzyskanie = brak `comms_true` lub `ok`). Ostrzeżenia: `last_contact` z przyszłości, `lost` bez zamrożonej pozycji (`pos_time` świeższe niż `last_contact` + próg BFT).
6. Zasady sędziego (CLAUDE.md): kiedy jednostka traci łączność (REW/zagłuszenie T26, ruch w terenie zasłoniętym, zniszczenie wozu dowodzenia lub węzła łączności, odległość poza zasięg UKF bez retransmisji, cisza radiowa) i kiedy ją odzyskuje (wyjście ze strefy, retransmisja, kurier, odtworzenie węzła). Rozkazy do jednostki bez łączności: zgubione wg T25 albo dostarczone kurierem z opóźnieniem. Podwładny bez łączności działa wg ostatniego znanego zamiaru przełożonego i nie melduje; sztab opisuje ciszę w meldunku („brak łączności z 1k od 06:12”), bez prawdy.

**Scenariusze testowe**
- [A] `shared/comms.js`: `checkComms` — poprawny, brak `last_contact` przy `lost`, status spoza listy, czas po turze; `checkUmpireComms`.
- [A] Walidator: `comms_true` w `player/turns` → błąd; `comms` w poprawnej formie → czysto.
- [A] Domena (`domain/comms.js`): `commsInfo` — status, wiek, tekst „brak łączności od HH:MM”; brak pola = `ok`, bez tekstu.
- [A] `turn.mjs`: `comms_true` w prawdzie daje `comms` w widoku gracza bez `comms_true`; łatka nadpisuje; brak dziedziczenia z tury N.
- [A] Ostrzeżenie komunikatora (`warnHtml`) dla kanału jednostki `lost`; brak dla `ok`.
- [S] Smoke: tura z jednostką `lost` → znacznik na mapie, wiersz w karcie, ostrzeżenie w komunikatorze; jednostka `ok` bez znaczników.
- [M] Kompania w strefie zagłuszenia stoi na starej pozycji ze znacznikiem „brak łączności od 06:12”; rozkaz do niej wysłany z ostrzeżeniem; po wyjściu ze strefy znacznik znika.

## T25 — Czas doręczenia rozkazów ✅
Rozkaz zaczyna obowiązywać w chwili **doręczenia**, nie wysłania. Czas przejścia zależy od odległości, środka łączności (radio UKF w zasięgu / retransmisja / kurier), stref zagłuszenia (T26) i ciszy radiowej.

**WA**
1. **Brak jakichkolwiek zmian w UI komunikatora** — żadnych stanów doręczenia ani potwierdzeń (decyzja gracza: nie musi być informacji zwrotnej).
2. Sędzia rozstrzyga doręczenie w procedurze tury (CLAUDE.md): godzinę i sposób doręczenia zapisuje w `umpire/turns/` i stosuje rozkaz od tej godziny.
3. Zgubiony rozkaz: podwładny działa wg ostatniego znanego zamiaru; gracz dowiaduje się dopiero z jego meldunku (np. „rozkazu nie otrzymaliśmy, działaliśmy wg poprzedniego zadania") albo z milczenia.
4. Cisza radiowa jako rozkaz gracza: poprawia ukrycie (trudniejsze namierzenie, T26), wydłuża doręczenie (kurier).
5. Schema/SCHEMA.md: dane doręczenia wyłącznie po stronie sędziego (`umpire/`); biała lista plików gracza bez zmian.

**Scenariusze testowe**
- [A] Walidator: pole doręczenia w pliku gracza → błąd (strażnik wycieku); `npm run validate` czysto po turze z doręczeniami.
- [M] Rozkaz w warunkach zagłuszenia przychodzi z opóźnieniem: podwładny melduje wykonanie poprzedniego zadania, dopiero potem otrzymanie nowego rozkazu.

## T26 — Walka radioelektroniczna ✅
Spektrum jako broń obu stron: zagłuszenie, namierzanie nadajników, wabiki.

**WA**
1. Strefy zagłuszenia jako **wiedza gracza** na mapie: nowy rodzaj `lines` `ew_zone` (zamknięty wielokąt, `label`, wiek meldunku — jak kontakty: to meldunki, nie prawda). Prawdziwy obraz REW tylko w `umpire/`.
2. Własne środki REW (np. grupa radioelektroniczna) jako jednostka z zadaniami tekstowymi: namierzanie (DF → kontakty typu „nadajnik"), zagłuszanie wyznaczonych rejonów, stawianie wabików.
3. Wróg namierza po radiu gracza: intensywna łączność = wykrywalność (skutki: ostrzał rejonu sztabu/SD). Wabiki gracza mogą przyciągać ogień wroga.
4. Efekty REW przeciwnika są widoczne wyłącznie jako skutki: opóźnione/zgubione rozkazy (T25), przerwane meldunki, nieudane zestrzelenia dronów.
5. SIDC dla REW i nadajników dodane do `public/js/domain/sidc.js` (FUNCTIONS) z polskim opisem; schema/SCHEMA.md/walidator: `ew_zone`, kontakty-nadajniki, biała lista.
6. CLAUDE.md: doktryna REW przeciwnika (rozpoznanie radioelektroniczne przed uderzeniem, namierzanie, zagłuszanie SD) i zasady skutków.

**Scenariusze testowe**
- [A] Walidator: `ew_zone` przyjmowany (zamknięty wielokąt), zła geometria → błąd.
- [A] Kontakt-nadajnik ma status `A` i źródło z REW/DF.
- [M] Zameldowana strefa zagłuszenia rysuje się na mapie z wiekiem informacji; rozkaz do jednostki w tej strefie idzie kurierem (opóźnienie widać w rozstrzygnięciu, nie w UI).

## T27 — Wojska inżynieryjne ✅
Saperzy jako jednostki z zadaniami; zapory i mosty jako rzeczywistość na mapie, nie tylko szkic.

**WA**
1. Jednostki saperskie w ORBAT (batalion saperów dywizji, plutony pionierów w batalionach) — dowodzone tekstowo jak każda jednostka.
2. Kalkulator zadań `tools/umpire/engineer.mjs` (czyste funkcje + CLI, deterministyczne): czas postawienia pola min o zadanej długości, wykonania przejścia, mostu składanego/pontonowego, zniszczenia mostu — wg sił, rodzaju zadania i terenu; dokumentacja w `docs/UMPIRE-TOOLS.md`.
3. Postęp zadania w prawdzie i w meldunkach („ZAPORA-1: 60%"); zadanie można przerwać ogniem lub rozkazem.
4. Własne zapory widoczne na mapie gracza jako obiekty z stanem (`planowane` / `wykonywane` / `gotowe`) i geometrią — z prawdy, nie z notatek gracza.
5. Zapory przeciwnika: wykrywane rozpoznaniem jako kontakty albo odkrywane przy wejściu (straty).
6. Mosty jako obiekty ze stanem w `umpire/` (cały / uszkodzony / zburzony — kto i kiedy); własne mosty gracz zna, wrogie — z rozpoznania; zniszczenie mostu zmienia routing (T15, T17).
7. Schema/SCHEMA.md/walidator: obiekty inżynieryjne w turach gracza (biała lista), pełny stan w umpire.
8. CLAUDE.md: praca saperów obu stron; SOP przeciwnika (rozpoznanie inżynieryjne przed natarciem, przejścia w zaporach).

**Scenariusze testowe**
- [A] Kalkulator: znane wartości (np. kompania saperów, pole min 800 m → czas wg tabeli; most składany 20 m); determinizm.
- [A] Walidator: geometria zapory, stany z listy, brak pól sędziego w plikach gracza.
- [M] Rozkaz „postawić pole min wg szkicu ZAPORA-1" → po turach obiekt „gotowe" i meldunek; natarcie przeciwnika w tym rejonie ponosi straty na minach.

## T28 — Zmęczenie i morale ✅
Wytrzymałość jako zasób: rotacja i odpoczynek stają się decyzją.

**WA**
1. `stamina_min` (reszta wytrzymałości jednostki; `endurance_min` zostaje dla czasu lotu środków) i `morale` w `umpire/turns/` (pole już strzeżone przez walidator); gracz widzi własne jednostki jako kategorię `fatigue` (`wypoczęta` / `zmęczona` / `wyczerpana`) w turach gracza.
2. Zużycie: natarcie pod ogniem > obrona pod ostrzałem > marsz > postój; doba bez snu obniża; noc w spokoju i pobyt w odwodzie regenerują.
3. Skutki rozstrzygane: tempo marszu, jakość wykonania rozkazów (opóźnienia, literalne zrozumienie), próba morale przy ciężkich stratach/okrążeniu (zatrzymanie, samowolny odwrót, w skrajnych przypadkach poddanie się — częściej u słabych formacji).
4. Meldunki mówią ludzkim głosem, nie liczbami: „ludzi nie stać na kolejne natarcie", „kompania zasnęła na stanowiskach".
5. Inspektor: wskaźnik `fatigue` z kolorem; schema: kategoria na białej liście, walidator.
6. CLAUDE.md: reguły zużycia i regeneracji, próby morale.

**Scenariusze testowe**
- [A] Walidator: `fatigue` z listy kategorii; `stamina_min` w pliku gracza → błąd (strażnik wycieku).
- [A] Inspektor pokazuje kategorię i kolor.
- [M] Brygada po dobie ciągłej walki melduje „nie stać nas na natarcie" i realnie zwalnia; świeża rezerwa działa pełnym tempem.

## T28.1 — Strefa sztabu (S2/S3/S4) ✅
Na starcie każdej tury gracz dostaje krótką odprawę sztabu: trzy stanowiska (S2 — wywiad, S3 — operacje, S4 — logistyka). Gracz siedzi w dowództwie, nie patrzy z góry.

**WA**
1. `staff` w `player/turns/NNN.json` (biała lista): tablica do 3 pozycji `{ role: "s2"|"s3"|"s4", name: "stopień nazwisko, funkcja", text: ≤ 300 znaków, time: ISO }`. Walidator: role z listy, unikalność ról w turze, `time` w okresie tury (poza → uwaga).
2. UI: panel „Odprawa sztabu" przy wejściu na turę — trzy karty z odznaką roli (S2/S3/S4), nazwą, tekstem i DTG. Kliknięcie karty otwiera kanał danej postaci. Panel da się zamknąć i przywołać (ikona przy zegarze), stan zapamiętany (`localStorage`).
3. Widok odprawy działa też w archiwum (odprawa danej tury). Na wąskich ekranach panel mieści się w zakładce.
4. CLAUDE.md: procedura pisania odprawy na start każdej tury — krótko i wojskowo, **bez prawdy** (S2/S3/S4 jej nie znają): S2 ocena wroga z pewnością, S3 ocena własna i propozycja, S4 stan logistyki i ryzyka. Wzory: *„S2: wróg przegrupowuje się na zachód — pewność średnia"*, *„S3: 1 bzmot wykrwawiony, proponuję rotację 1k"*, *„S4: amunicja dart 0,4 doby, konwój 3 opóźniony"*.
5. Wprowadzamy na żywo w poligonie (`00-test-przesmyk`) od pierwszej rozstrzyganej tury po wdrożeniu.
6. **Widok według komórki sztabu:** gotowe ustawienia warstw i paneli dla S2 (kontakty, REW, CCIR-PIR), S3 (własne siły, linie, rozkazy), S4 (logistyka, DOS) i wsparcia ogniowego (zasięgi T47, zgłoszenia ognia T52); przełączenie jednym klikiem lub skrótem, bez utraty własnych ustawień gracza.

**Scenariusze testowe**
- [A] Walidator: struktura `staff`, role z listy, duplikat roli → błąd, `time` poza turą → uwaga, `staff` spoza białej listy w innych plikach gracza → błąd.
- [A] Logika UI: budowa odprawy (role, teksty, DTG), zamknięcie i przywołanie, stan w `localStorage`.
- [M] Po rozstrzygnięciu tury aplikacja pokazuje odprawę S2/S3/S4; klik karty otwiera kanał; w archiwum widać odprawę tamtej tury.

# Etap v0.3 — po bitwie (realizowany w krokach 2 i 3)

Tryb po bitwie powstaje w dwóch kawałkach: **minimalny w kroku 2** (T29 — odblokowanie prawdy i AAR po `status: “finished”`) i **pełny w kroku 3** (T32 — suwak czasu i warstwy dla kampanii). Oryginalne zadania T20–T22 pozostają tu jako punkt odniesienia:

- **T20 Tryb „po bitwie”:** dostęp do `umpire/` dopiero po oznaczeniu scenariusza jako zakończony (`scenario.json: status = “finished”`).
- **T21 Suwak czasu:** przewijanie tur, warstwy „wiedza gracza”, „prawda” i „notatki”, przełączane lub nałożone.
- **T22 Raport z ćwiczeń:** wyświetlanie `aar.md` obok suwaka.

# Etap v0.4 — pełna bitwa: „Przesmyk suwalski” (krok 2)

## T23 — Scenariusz „Przesmyk suwalski” ⬜
Gracz: dowódca dywizji zmechanizowanej w obronie przesmyku. Jedna bitwa, 8–12 tur po 2 h (1–3 wieczory grania), zakończona rozstrzygnięciem i AAR. Wielodniowość i noce — dopiero w kroku 3 (T31), tu noc rozstrzygana narracyjnie.

**WA**
1. ORBAT dywizji z otwartych źródeł (np. 16 DP) do poziomu kompanii, z fikcyjnymi oznaczeniami; stany osobowe i sprzęt wg T12.1; w ORBAT wszystkie rodzaje wojsk z v0.2: saperzy (T27), REW (T26), rozpoznanie, OPL, logistyka (batalion logistyczny, kompanie zaopatrzenia).
2. Przeciwnik: zgrupowanie z obwodu królewieckiego i z Białorusi wg doktryny (T24), z zegarem zaopatrzenia (Kaliningrad odcięty); plan w `umpire/enemy-plan.md` z wariantami reakcji.
3. Wszystkie mechaniki v0.2 od tury 0 (DOS, doręczenie, REW, saperzy, zmęczenie) zgodne ze schema.
4. Odprawa z oceną wywiadu, która może się mylić (jak w scenariuszu testowym); gazeter ≥ 30 miejsc z odmianami.
5. Przełożony i sąsiedzi jako pełne formacje z pododdziałami (jak `zt-mamry`), żyjący własnym życiem i meldujący.
6. Pogoda i dzień/noc rozstrzygane narracyjnie (pełny system dopiero w T30); tury sięgające nocy oznaczone w zegarze.
7. Zakończenie: warunki końca bitwy (utrzymanie rubieży do chwili X / przełamanie / rozbicie zgrupowania) → `status: “finished”` + `aar.md` w stylu omówienia ćwiczenia.
8. `npm run validate` czysto dla całego scenariusza; test dymny przechodzi.

**Scenariusze testowe**
- [A] Walidator bez błędu i uwag dla wszystkich tur scenariusza.
- [A] Ciągłość numeracji tur, kanałów i czasu; schema v0.2 w praktyce.
- [M] Pełna bitwa rozegrana do końca: rozkazy z tarciem, logistyka daje o sobie znać, AAR pokazany w aplikacji (T29).

## T29 — Tryb po bitwie (minimalny) ⬜
Zapłata za grę: po `status: “finished”` aplikacja pokazuje prawdę i AAR.

**WA**
1. `scenario.json` ma `status` (`active` domyślnie, `finished` po bitwie); serwer serwuje zawartość `umpire/` **wyłącznie**, gdy `status: “finished”`: `GET /api/truth/:n` i `GET /api/aar`; inaczej 403 (także próby obejścia — testy jak w T01).
2. Widok „Prawda” na końcowej turze: jednostki obu stron z `umpire/turns/NNN` (przeciwnik na prawdziwych pozycjach) obok wiedzy gracza; przełącznik w panelu Warstwy (aktywny tylko po zakończeniu).
3. `aar.md` jako dokument w stylu odprawy (T09): pełnoekranowy, ze spisem treści.
4. Komunikator w trybie po bitwie: tylko podgląd; przełącznik „Po bitwie” na osi czasu (T12.7) odblokowany.
5. Walidator: `status` z listy; uwaga, gdy `finished` bez `aar.md`.
6. CLAUDE.md: procedura zamknięcia bitwy (sprawdzenie warunków końca, `status: “finished”`, napisanie AAR w stylu omówienia ćwiczenia: zamiary vs rzeczywistość, decyzje kluczowe, wnioski).

**Scenariusze testowe**
- [A] `GET /api/truth/1` przy `active` → 403; przy `finished` → 200 z prawdą; próby `..` nie dają wycieku (jak T01).
- [A] Walidator: zły `status` → błąd; `finished` bez `aar.md` → uwaga.
- [M] Po zakończeniu T23: „Prawda” pokazuje prawdziwe pozycje przeciwnika, a AAR czyta się jak omówienie ćwiczenia.

## T24 — Rozbudowa CLAUDE.md ⬜
Modele i doktryna potrzebne do prowadzenia T23: zużycie DOS (postój < obrona < marsz < natarcie) i jego odtworzenie, rozstrzyganie doręczeń (T25) i zużycia wytrzymałości (T28), doktryna przeciwnika (w tym REW i inżynieryjna), zasady starzenia informacji, procedura zamknięcia bitwy (T29).

---

# Etap v0.5 — kampania wielodniowa (krok 3)

Ten sam szczebel (dywizja), jedna wielodniowa bitwa w **czasie gry**: fazy D+0…D+3, noce jako osobny rytm, zegar logistyczny, rezerwy przyjeżdżające wg harmonogramu. Gracz gra sam; nic się nie resetuje między dniami. (Szerszy front — dowodzenie 2 dywizjami/korpusem — odłożony na później, po kampanii.)

## T30 — Pogoda i cykl dobowy ⬜
**WA**
1. `weather` w turach (biała lista): tekst i kategorie (opad, mgła, wiatr, temperatura, widzialność). Pogoda jawna dla gracza (prognoza + obserwacje), zmiany meldunkami.
2. Dzień/noc liczony z realnego czasu startu i szerokości geograficznej (wschód/zachód słońca); zegar i oś czasu oznaczają noce.
3. Skutki rozstrzygane (CLAUDE.md): drony (wiatr/opad/mgła), obserwacja (widzialność, termowizja nocą — kto ma, widzi; maskowanie cieplne), przejezdność terenu po deszczu, zużycie wytrzymałości w zimie.
4. UI: ikona i opis pogody w nagłówku oraz w karcie tury; nocna tura oznaczona w zegarze.
5. Schema/walidator: struktura `weather`, kategorie z listy, biała lista.

**Scenariusze testowe**
- [A] Wschód/zachód słońca dla znanej daty i szerokości (Suwałki 14.05: ok. 04:40/20:10, tolerancja).
- [A] Walidator: `weather` z kategorii z listy; brak pól sędziego.
- [M] Deszcz odwołuje lot BSP (meldunek „lot odwołany — wiatr"), nocne natarcie widzi tylko jednostka z termowizją.

## T31 — Przejście dni: noc jako tura ⬜
**WA**
1. Tura nocna: dłuższa (np. 20:00–06:00) i cicha z założenia — uzupełnienie (DOS rośnie wg konwojów, T17/T18), ewakuacja rannych, regeneracja wytrzymałości (T28), przegrupowania; wypad wroga możliwy, ale rzadki i meldowany z opóźnieniem.
2. `duration_min` opcjonalne w pliku tury (biała lista): czas bieżącej tury zamiast domyślnego `turnMinutes`; zegar liczy godzinę następnej tury z `duration_min`; walidator sprawdza ciągłość (tura N+1 `time` = tura N `time` + `duration_min`).
3. Fazy dni w `scenario.json` (`phases`: D+0…D+X); zadanie dnia przychodzi od przełożonego na start dnia (meldunek w kanale przełożonego).
4. Rezerwy i konwoje wg harmonogramu: prawda w `umpire/` (godzina przybycia na konkretną trasę/MSR), gracz zna je z meldunków S4 i przełożonego.
5. Znaczniki dni w UI: nagłówek („D+1"), oś czasu tur z podziałem na dni, powiadomienie „nowy dzień bojowy".
6. Warunki zakończenia kampanii (utrzymano do D+X / przełamano / rozbite zgrupowanie) → `status: "finished"`.
7. CLAUDE.md: procedura nocy (co robią obie strony, co melduje S4, jak liczyć regenerację i uzupełnienie).
8. Schema/walidator: `duration_min`, `phases`.

**Scenariusze testowe**
- [A] Ciągłość czasu: `duration_min: 480` → następna tura o `time + 8 h`; walidator zgłasza niespójność.
- [A] UI: nagłówek pokazuje „D+1", oś czasu dzieli się na dni.
- [M] Noc: meldunki S4 o uzupełnieniu, jednostki regenerują (Inspektor), o świcie meldunek rozpoznania o przegrupowaniu wroga.

## T32 — AAR kampanii i pełny tryb po bitwie ⬜
**WA**
1. Suwak czasu (rozszerzenie T29): przewijanie wszystkich tur kampanii z warstwami „wiedza gracza", „prawda" i „notatki", przełączanymi lub nałożonymi.
2. AAR kampanii (`aar.md`): omówienie ćwiczenia dzień po dniu — zamiary vs rzeczywistość, decyzje kluczowe z dziennika sędziego, straty, logistyka, wnioski.
3. Statystyki końcowe: straty obu stron w podziale na dni i kategorie (personnel/equipment z tur), zużycie amunicji — sekcja w dokumencie AAR.
4. Serwowanie prawdy jak w T29 (tylko po `finished`); walidator: `finished` wymaga `aar.md` i ciągłości tur.

**Scenariusze testowe**
- [A] Suwak: warstwy przełączalne, nałożenie „prawdy" na „wiedzę" pokazuje kontakt nad prawdziwą pozycją (przesunięcie widoczne).
- [A] Statystyki: sumy strat zgadzają się z plikami tur.
- [M] Po kampanii: przewinięcie D+0…D+3 z prawdą pokazuje, gdzie gracz się mylił; AAR czyta się jednym tchem.
