# Schemat plików scenariusza (wersja 1)

Jedyny, obowiązujący opis formatu danych. Gdy ten dokument i kod się rozchodzą, poprawiamy oba w tym samym zadaniu. Stałe i walidatory żyją w [`shared/schema.js`](../shared/schema.js) (używają ich serwer, walidator `tools/validate.js` i docelowo klient); walidator scenariusza: `npm run validate -- <nazwa>`.

## Konwencje ogólne

- Katalog scenariusza: `scenarios/<id>/`. Numeracja plików tur: `NNN.json`, 3 cyfry z zerami (`000`, `001`…), ciągła od `000`.
- Współrzędne: `[długość, szerokość]` (lon, lat, jak w GeoJSON), stopnie WGS84. Dopuszczalne: |lon| ≤ 180, |lat| ≤ 90.
- Czas: ISO 8601 ze strefą (`2026-05-14T06:00:00+02:00`). Czas tury N = `start + N × turnMinutes`.
- Symbole: SIDC MIL-STD-2525C, 15 znaków; dozwolone tylko kody opisane w `public/js/sidc.js`.
- Kodowanie UTF-8, JSON wcięty 2 spacjami. Teksty dla gracza po polsku.
- `schemaVersion` (w `scenario.json`): numer wersji tego schematu. Obecnie `1`. Walidator: brak pola = uwaga, inna wartość niż obsługiwana = błąd. Zmiana niekompatybilna podnosi numer i dodaje sekcję „Migracja” poniżej.

### Zasada widoczności (leak guard)

Pliki dzielą się na **jawne dla gracza** (serwer je czyta i wysyła do przeglądarki) i **tylko sędziego** (`umpire/`, serwer ich nigdy nie czyta). Pliki gracza mogą zawierać wyłącznie pola z kolumny „gracz” poniżej (biała lista `PLAYER_FIELDS` w `shared/schema.js`). Każde pole spoza listy (np. `side`, `supply`, `events`, `endurance_min`, `stamina_min`, `morale`) w pliku gracza to **błąd walidatora** — pilnuje tego `npm run validate`, który trzeba uruchamiać po każdej turze.

### Niespójności nazewnictwa (świadomie zachowane)

Pliki mieszają `camelCase` (`turnMinutes`, `schemaVersion`) i `snake_case` (`uncertainty_m`, `estimate_personnel`, `endurance_min`, `stamina_min`, `enemy_flot`), a `current`/`authorized` w jednostkach kontra `count` w szacunkach. Decyzja: **nie zmieniamy nazw istniejących pól** (zgodność ze scenariuszami, testami i klientem). Nowe pola nazywamy w `camelCase`; ewentualne ujednolicenie tylko razem z podniesieniem `schemaVersion` i migracją.

---

## `scenario.json` — jawny

Metadane i kanały komunikatora.

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `schemaVersion` | liczba | zalecane | Wersja schematu, obecnie `1`. |
| `id` | tekst | tak | Identyfikator = nazwa katalogu, np. `00-test-przesmyk`. |
| `title` | tekst | tak | Tytuł wyświetlany w aplikacji. |
| `status` | tekst | nie | `active` (domyślnie) albo `finished`. Dopiero `finished` zwalnia treści `umpire/` (CLAUDE.md, T20). |
| `side` | tekst | nie | Strona gracza, np. `PL`. |
| `scale` | tekst | nie | Skala dowodzenia, np. `brygada` (informacyjnie). |
| `timezone` | tekst | tak | Strefa IANA, np. `Europe/Warsaw`. |
| `start` | czas ISO | tak | Czas tury 0. |
| `turnMinutes` | liczba > 0 | tak | Długość tury w minutach. |
| `map` | `{center:[lon,lat], zoom}` | nie | Początkowy widok mapy. |
| `channels` | lista kanałów | tak, ≥ 1 | Rozmówcy komunikatora (poniżej). |
| `reportCycle` | `{sitrep, logstat, anchor?}` | nie | Rytm meldunków cyklicznych w minutach czasu gry (T48), np. `{"sitrep": 240, "logstat": 1440}`; liczby całkowite > 0; `anchor` (czas ISO) = godzina odniesienia. Nieznane pole albo zła wartość = błąd. |
| `commandRules` | `{skipEchelon}` | nie | Reguły dowodzenia (T45). `skipEchelon`: `off` (bez ograniczeń), `soft` (domyślny: ostrzeżenie w komunikatorze, skutki rozstrzyga sędzia wg CLAUDE.md), `hard` (wysyłka do kanałów poniżej bezpośrednich podwładnych zablokowana — w kliencie i na serwerze — poza `priority: urgent`). Inna wartość albo nieznane pole = błąd. |

Kanał (`channels[]`): `id` (tekst, unikalny, tak), `name` (tak), `kind` (`superior`, `neighbor`, `subordinate`, `logistics`, `recon`, `other`; inny = uwaga), `description` (nie), `short` (nie, skrót w UI), `unit` (nie, id jednostki, której kanał dotyczy), planowane `commander` (id pliku `umpire/commanders/<id>.md`, T14). Wiadomość można też zaadresować do dowolnej jednostki własnej z bieżącej tury (`channel` = id jednostki). Ile szczebli pominięto, liczy się z `parent` (bezpośredni podwładny = 0, kompania pod batalionem = 1, pluton = 2; sąsiedzi i `formation` nie dotyczą); zob. `commandRules`.

## `briefing.md` — jawny

Odprawa w Markdownie, wyświetlana w zakładce Odprawa. Brak pliku = uwaga walidatora.

## `gazetteer.json` — jawny, opcjonalny

`{ "places": [ … ] }`. Miejsca zamieniane w wiadomościach na linki do mapy.

| Pole miejsca | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | tekst | tak | Unikalne. |
| `name` | tekst | tak | Nazwa w mianowniku. |
| `kind` | tekst | tak | `miasto`, `wieś`, `wzgórze`, `jezioro`, `rzeka`, `droga`, `przejście`, `inne` (inny = uwaga). |
| `pos` | `[lon,lat]` | tak | Położenie (geokodowane, np. Nominatim). |
| `zoom` | liczba 1–19 | nie | Przybliżenie po kliknięciu. |
| `forms` | lista tekstów | tak | Odmiany (mianownik, dopełniacz, miejscownik, narzędnik…); musi zawierać `name`. |
| `note` | tekst | nie | Źródło / uwaga. |

## `player/turns/NNN.json` — jawny (widok gracza)

Stan świata **taki, jaki zna gracz**: własne siły na ostatnich zameldowanych pozycjach (BFT, `pos_time`), wróg tylko jako kontakty. Pola najwyższego poziomu (gracz): `turn`, `time`, `units`, `contacts`, `assets`, `lines`, `logistics`, `staff`.

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `turn` | liczba | tak | Musi równać się numerowi z nazwy pliku. |
| `time` | czas ISO | tak | Czas tury (= start + N × turnMinutes, inaczej uwaga). |
| `units` | lista | tak | Jednostki własne, przełożony, sąsiedzi. |
| `contacts` | lista | nie | Kontakty z wrogiem. |
| `assets` | lista | nie | Środki rozpoznania gracza. |
| `lines` | lista | nie | Linie operacyjne. |
| `logistics` | obiekt | nie | Warstwa logistyczna znana graczowi (sekcja `logistics` niżej). |
| `staff` | lista | nie | Odprawa sztabu na start tury (T28.1), niżej. Dotyczy tylko tej tury, nie jest dziedziczona. |
| `engineering` | lista | nie | Obiekty inżynieryjne znane graczowi (T27): zapory, przejścia, mosty. Sekcja `engineering` niżej. |

Wszystkie elementy `units`/`contacts`/`assets` mają unikalne w pliku `id`.

### `staff` (gracz, T28.1)

Do 3 pozycji `{ role, name, text, time }`: `role` ∈ `s2` / `s3` / `s4` (unikalna w turze), `name` (`stopień nazwisko, funkcja`), `text` (≤ 300 znaków), `time` (ISO, w okresie tury: od czasu tury − `turnMinutes` do czasu tury; poza nim uwaga). Treść zawiera tylko to, co wiedzą stanowiska sztabu, nigdy prawdę. Stałe i walidator: `shared/staff.js` (`checkStaff`); `staff` w `inbox`/`outbox` jest błędem (poza `PLAYER_MESSAGE_FIELDS`). Karta w aplikacji otwiera kanał postaci: `s2` → kanał `s2` (albo pierwszy kanał rodzaju `recon`), `s4` → kanał `s4` albo `logistics`, `s3` → kanał `s3`, a gdy go brak, karta jest tylko do czytania.

### `units[]` (gracz)

| Pole | Typ | Wym. | Znaczenie / przykład |
|---|---|---|---|
| `id` | tekst | tak | `1bzmot-1k`. Jest też dozwolonym kanałem wiadomości. |
| `name` | tekst | zalec. | `1 kompania`. |
| `sidc` | tekst(15) | tak | `SFGPUCIZ---F---`. |
| `pos` | `[lon,lat]` | tak | Ostatnia **zameldowana** pozycja (BFT, T49); zwykle równa prawdzie, w zagłuszeniu / ciszy radiowej / przy utracie łączności zamrożona. Prawda o pozycji tylko w `umpire/turns`. |
| `pos_time` | czas ISO | nie | Czas raportu BFT dla `pos`. Późniejszy niż czas tury = błąd; wcześniejszy niż `time − turnMinutes` = uwaga (pozycja zamarznięta); brak = czas tury (zgodność wstecz). Mapa przygasza symbol, gdy pozycja jest starsza niż 30 min (`domain/bft.js`). |
| `strength` | liczba 0–1 | nie | Siła bojowa. |
| `status` | tekst | nie | `w marszu`, `SD rozwinięte`… |
| `task` | tekst | nie | Bieżące zadanie. |
| `personnel` | `{current, authorized}` | nie | Liczby całkowite ≥ 0; `current > authorized` = uwaga. |
| `equipment` | `[{name, current, authorized, ref?}]` | nie | Główny sprzęt. `ref` = id pozycji katalogu wyposażenia (`data/equipment.json`, T46): karta pokazuje grupy wg kategorii i zasięgi; `ref` spoza katalogu = błąd, brak `ref` = jak dotąd. |
| `parent` | tekst | nie | Id jednostki nadrzędnej (istniejącej, bez cykli). Przełożony i sąsiedzi bez `parent`. |
| `formation` | tekst | nie | **Jednostka sąsiada** (nie podlega graczowi): id dowództwa sąsiada z tej samej tury (np. `zt-mamry`), zamiast `parent`. Cel nie ma ani `parent`, ani `formation` (brak cykli); `parent` i `formation` naraz = błąd. Podwładni takiej jednostki mogą używać `parent` (należą do formacji pośrednio). Takie jednostki nie mają kanałów komunikatora (serwer odrzuca wiadomość: 400). |
| `track` | `[[lon,lat], …]` | nie | Trasa przejechana w turze, która **kończy się** w `pos` (pierwszy punkt = pozycja z poprzedniej tury). ≥ 2 poprawne punkty (inaczej błąd); ostatni punkt ≠ `pos` (tolerancja 1e-6°) albo pierwszy punkt dalej niż ~100 m od poprzedniej pozycji = uwaga. Służy tylko animacji przemieszczenia; bez `track` jednostka jedzie po prostej. Dotyczy jednostek własnych i sąsiadów. |
| `notes` | tekst | nie | Opis do karty jednostki. |
| `dos` | `{fuel, ammo, general, readiness, as_of}` | nie | **Meldowany** stan zaopatrzenia (T18): `fuel`/`ammo`/`general` = dni zaopatrzenia (liczby ≥ 0, każde opcjonalne, ale wymagany min. jeden wskaźnik razem z `readiness`), `readiness` = sprawność sprzętu 0–1, `as_of` = czas meldunku ISO (wymagany). To wiedza gracza, nie prawda: może być nieaktualna i zaokrąglona. Wartość ujemna, `readiness` > 1 albo zły `as_of` = błąd. Prawdziwy stan to `supply` w `umpire/turns/`. |
| `fatigue` | `wypoczęta` / `zmęczona` / `wyczerpana` | nie | Kategoria zmęczenia jednostki własnej (T28), wyliczana przez sędziego z `stamina_min` (< 12 h = zmęczona, < 4 h = wyczerpana). To jedyna wiedza gracza o wytrzymałości; liczby (`stamina_min`, `morale`) są tylko w `umpire/turns/`. Inna wartość = błąd. |

Pola **tylko sędziego** (w `umpire/turns/`, zabronione w pliku gracza): `side`, `supply`, `stamina_min`, `morale`.

### `logistics` (gracz i sędzia, T17)

Obiekt z czterema opcjonalnymi listami. Ten sam kształt w `player/turns` (to, co wie S4 gracza, dane mogą być nieaktualne) i `umpire/turns` (prawda). Id unikalne w całym `logistics` danej tury. Stałe i walidator: `shared/schema.js` (`checkLogistics`, `DEPOT_STATUSES`, `ROUTE_KINDS`, `ROUTE_STATUSES`, `BRIDGE_STATUSES`, `CONVOY_STATUSES`, `LOGISTICS_FIELDS`). W pliku gracza element nie może mieć pól spoza `LOGISTICS_FIELDS` (błąd); w `umpire/` pola dodatkowe są dozwolone.

| Lista | Pola | Enumy |
|---|---|---|
| `depots[]` | wymagane: `id`, `name`, `pos` `[lon,lat]`, `stock` `{fuel, ammo, general}` (tony ≥ 0, wszystkie trzy), `status`, `as_of` (ISO); opcjonalne: `notes` | `status`: `operational`, `limited`, `destroyed` |
| `routes[]` | wymagane: `id`, `name`, `kind`, `coords` (≥ 2 punkty), `status`; opcjonalne: `as_of`, `notes` | `kind`: `MSR`, `ASR`; `status`: `open`, `threatened`, `closed` |
| `bridges[]` | wymagane: `id`, `name`, `pos`, `status`; opcjonalne: `mlc` (tony > 0), `as_of`, `notes` | `status`: `intact`, `damaged`, `destroyed` |
| `convoys[]` | wymagane: `id`, `name`, `pos`, `from`, `to` (tekst: id składu/jednostki albo nazwa), `cargo` `{fuel, ammo, general}` (tony), `status`; opcjonalne: `eta` (ISO), `track`, `as_of`, `notes` | `status`: `planned`, `moving`, `halted`, `delayed`, `destroyed`, `arrived` |

- `as_of` = czas, na który dane są aktualne; starsze niż 1 turę oznacza stare dane (UI). Wymagane tylko dla składu.
- `convoys[].track` jak `units[].track`: trasa przejechana w turze, kończy się w `pos` (≥ 2 punkty; ostatni punkt ≠ `pos` = uwaga). Tylko animacja.
- **Gracz vs sędzia:** plik gracza ma stan znany graczowi (np. skład z zapasem sprzed 3 h); `umpire/turns` ma prawdę (może zawierać dodatkowe pola, np. rzeczywisty zapas). `supply` pozostaje polem tylko sędziego i w pliku gracza to błąd.

**`ew_zone` (T26)** — zameldowana strefa zagłuszenia/aktywności radioelektronicznej, **wiedza gracza** (jak kontakt: meldunek, nie prawda; starzeje się). Wymaga: `coords` = zamknięty wielokąt (≥ 4 punkty, pierwszy == ostatni, inaczej błąd), niepustego `label`, `observed` (ISO, nie późniejszy niż `time` tury). Walidator: `checkEwZone` (`shared/ew.js`). Prawdziwy obraz — `ew` w `umpire/turns` (niżej). Aplikacja rysuje strefę jako półprzezroczysty wielokąt z etykietą i wiekiem meldunku.

### `contacts[]` (gracz)

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | tekst | tak | `c-001`. |
| `sidc` | tekst(15) | tak | Przynależność `H`/`S`/`U`; status `A` = niepotwierdzony. |
| `pos` | `[lon,lat]` | tak | Pozycja **zameldowana**, nie prawdziwa. |
| `uncertainty_m` | liczba | nie | Promień niepewności w metrach. |
| `observed` | czas ISO | tak | Czas ostatniej obserwacji; nie późniejszy niż `time` tury. |
| `source` | tekst | nie | Źródło (`dron BSP-1`, `wywiad`). |
| `confidence` | tekst | nie | `wysoka` / `średnia` / `niska`. |
| `estimate` | tekst | nie | Opis szacunku (`batalionowa grupa taktyczna`). |
| `estimate_personnel` | `{count, approx}` | nie | `count` całkowite ≥ 0. |
| `estimate_equipment` | `[{name, count, approx, ref?}]` | nie | Szacunek sprzętu. `ref` jak w `equipment` (część `side: "RU"` katalogu); zasięgi na karcie są szacunkowe. |

**Kontakt-nadajnik (T26):** namierzony nadajnik to kontakt z SIDC funkcji `UUMSEI` (np. `SHGAUUMSEI----`), **zawsze status `A`** (niepotwierdzony, ramka przerywana; błąd, gdy inny), `source` powinno wskazywać REW/DF (brak = uwaga), `uncertainty_m` zwykle duże. Pozostałe SIDC REW (`SIDC` w `public/js/domain/sidc.js`): `UUMS` rozpoznanie radiowe (SIGINT), `UUMSE` jednostka REW, `UUMSED` namierzanie (DF), `UUMSEJ` zagłuszanie.

### `assets[]` (gracz)

`id` (tak), `name`, `type` (np. `dron rozpoznawczy FlyEye`), `sidc`, `pos` (tylko gdy w powietrzu / rozwinięty), `status`, `task`. **Tylko sędzia:** `side`, `endurance_min`.

### `lines[]` (gracz)

`id` (tekst), `kind` (`boundary`, `flot`, `enemy_flot`, `phase`, `axis`, `enemy_axis`, `ew_zone`; inny = uwaga), `label` (tekst), `coords` (`[[lon,lat], …]`, ≥ 2 punkty, tak), `observed` (czas ISO meldunku; wymagane dla `ew_zone`), `formation` (nie; id dowództwa sąsiada z tej samej tury — linia należy do sąsiada, np. jego FLOT; ta sama reguła celu co przy `units[].formation`).

### `engineering` (gracz i sędzia, T27)

Obiekty inżynieryjne: pola minowe, linie zapór, przejścia, mosty. Walidator: `checkEngineering` (`shared/engineering.js`). Rysunek na mapie: warstwa „Zapory i mosty”.

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | tekst | tak | Unikalne w liście. |
| `kind` | tekst | tak | `minefield` (pole minowe), `obstacle` (linia zapór), `lane` (przejście w zaporze), `temp_bridge` (most składany / pontonowy), `bridge` (most stały). |
| `owner` | tekst | tak | Gracz: `own` albo `enemy`. Prawda: strona (`PL`, `RU`…). |
| `state` | tekst | tak | Zapory, przejścia, `temp_bridge`: `planned` / `building` / `done` (planowane / wykonywane / gotowe). `bridge`: `intact` / `damaged` / `destroyed` (cały / uszkodzony / zburzony). |
| `coords` | lista | zależnie | `minefield`: zamknięty wielokąt (≥ 4 punkty, pierwszy == ostatni); `obstacle`, `lane`: łamana (≥ 2 punkty). `[lon, lat]`. |
| `pos` | `[lon, lat]` | zależnie | `temp_bridge`, `bridge`. |
| `label` | tekst | nie | Nazwa, np. „ZAPORA-1”. |
| `progress` | liczba 0–100 | nie | Postęp w % (sens tylko przy `building`; brak przy `building` = uwaga). Meldunek: „ZAPORA-1: 60%”. |
| `unit` | tekst | nie | Id jednostki saperskiej wykonującej zadanie. |
| `observed`, `source`, `confidence` | czas ISO, tekst, `wysoka`/`średnia`/`niska` | `observed` tak dla `owner: enemy` | Wiedza z rozpoznania o obiekcie przeciwnika (jak kontakt: starzeje się). |

- **Gracz** (`player/turns`): tylko pola z tabeli. Obiekty `own` pochodzą **z prawdy** (nie z notatek gracza); obiekty `enemy` tylko z rozpoznania (albo odkryte przy wejściu — wtedy sędzia dopisuje je z `observed` i `source`). Most stały, który jest już w `logistics.bridges`, nie powtarza się w `engineering`.
- **Sędzia** (`umpire/turns`): pełna lista, w tym obiekty nieodkryte; pola dodatkowe dozwolone (`changed_at`, `changed_by` — kto i kiedy uszkodził / zburzył most, `started`, `until`, …). Stan mostu stałego jest synchronizowany do `logistics.bridges` (`status`), więc zburzony most zmienia routing (T15, T17).
- Na mapie stan wyraża kreskowanie (planowane cienko kropkowane, wykonywane kreskowane, gotowe ciągłe); obiekty przeciwnika są czerwone.

## `player/inbox/NNN.json` — jawny

`{ "messages": [ … ] }` — wiadomości do gracza z rozstrzyganego okresu (między turą N a N+1); plik NNN odpowiada turze, w której wiadomości się pojawiają. Zapisuje sędzia.

Wiadomość: `id` (tekst, unikalny w całym scenariuszu, np. `in-000-01`, tak), `channel` (id kanału lub jednostki z tury, tak), `from` (tekst: „stopień nazwisko, funkcja”), `time` (ISO, tak), `type` (`rozkaz`, `zarzadzenie`, `meldunek`, `wiadomosc`; nie), `priority` (`normal`, `urgent`; nie), `text` (niepusty, ≤ 4000 znaków, tak), `form` (T50, nie — patrz niżej). Opcjonalnie (T48): `ccir` (id pozycji z `player/ccir.json`, np. `PIR-2` — wiadomość spełnia tę potrzebę informacyjną; nieistniejąca pozycja = uwaga walidatora) i `report` (`sitrep` albo `logstat` — meldunek cykliczny; z `type: meldunek`). Aplikacja pokazuje `type` jako znacznik na karcie wiadomości, a `priority: "urgent"` jako „PILNE”.

## `player/outbox/NNN.json` — jawny, zapisuje aplikacja

`{ "messages": [ … ] }` — rozkazy gracza z tury N. **Sędzia nie modyfikuje tego pliku** (tylko czyta). Wiadomość: `id` (`out-xxxxxxxx`), `channel`, `turn`, `time` (czas gry tury), `sent` (rzeczywisty czas wysłania, ISO UTC), `type` (kategoria rozkazu wybrana przez gracza: `rozkaz`, `zarzadzenie`, `meldunek`, `wiadomosc`; domyślnie `wiadomosc`), `priority` (`normal` albo `urgent` — przełącznik „Pilne”; domyślnie `normal`), `text`, opcjonalne `attachments` (kopie szkiców, jak w `notes`, oraz rozkazy graficzne `kind: "order"` — niżej). Zapis przez API jest serializowany (kolejka per scenariusz), a plik zapisywany atomowo przez unikalny plik tymczasowy.

### Formularz `form` w wiadomości (T50)

Opcjonalne pole `form: { "kind": "spotrep|logstat|frago|fire", "fields": { … } }` w wiadomości `player/outbox` (gracz wysyła formularz z komunikatora) i `player/inbox` (postać może odpowiedzieć w tym samym formacie; komunikator pokazuje tabelkę). `text` zostaje czytelnym tekstem (w outbox generowanym z pól: `SPOTREP
Co: …`), więc sędzia może czytać sam `text`. Wartość pola to tekst (≤ 1000 znaków), liczba albo geometria GeoJSON (`Point`, `LineString`, `Polygon`, współrzędne `[długość, szerokość]`) dla pól wskazywanych na mapie. Pola szablonów (id, etykieta, wymagalność, opcje): `public/js/domain/forms.js`; w skrócie:

| kind | pola (* wymagane) |
|---|---|
| `spotrep` | `what`* co, `count`* ile, `where`* gdzie (punkt/rejon), `when`* kiedy, `direction` (`stoi`, `N`…`NW`), `certainty`* (`niska`, `średnia`, `wysoka`), `notes` |
| `logstat` | `fuel`*, `ammo`*, `personnel`*, `equipment`, `needs`* |
| `frago` | `task`*, `area`* (rejon/punkt/linia), `time`*, `coordination` |
| `fire` | `target`* (punkt/rejon), `targetKind`*, `effect`* (`obezwładnienie`, `zniszczenie`, `dymy`, `oświetlenie`), `time`*, `priority`* (`zwykły`, `pilny`, `natychmiastowy`), `support` |

Walidacja: struktura `checkFormShape` (`shared/form.js`), pola i wymagalność `checkFormContent` / `missingFields` (`domain/forms.js`). Serwer (`POST /api/outbox`, pole `form` w ciele) odrzuca błędny lub niekompletny formularz (400); walidator: błąd w `outbox`, w `inbox` braki wymaganych pól to uwaga.

### Status zgłoszenia ognia `fire` w wiadomości inbox (T52)

Odpowiedź sędziego na formularz `fire` (zgłoszenie = wiadomość outbox z `form.kind: "fire"`): wiadomość `player/inbox` z polem `fire: { "request_id", "status", "time", "rounds"?, "reason"? }`. `request_id` = `id` wiadomości ze zgłoszeniem (nieistniejące = uwaga walidatora), `status` = `accepted` (przyjęto), `refused` (odmowa; `reason` wymagany, ≤ 300 znaków) albo `done` (wykonano; `rounds` = liczba pocisków, liczba całkowita ≥ 0, tylko przy `done`), `time` = czas ISO ze strefą (np. godzina wykonania). Cykl: wysłane (brak odpowiedzi) → `accepted` / `refused` → `done`; `done` bez `accepted` dozwolone, po `refused` i `done` kolejne statusy są ignorowane. **Pole nie zawiera skutku ognia** (żadnych innych pól niż wymienione); skutek gracz poznaje z obserwacji i meldunków. `text` wiadomości to czytelna odpowiedź („Przyjęto.”, „Odmowa: brak amunicji.”, „Wykonano 08:20, 12 pocisków, skutek nieznany.”). `fire` w outbox = błąd. Walidacja: `checkMessageFire` (`shared/fire.js`), `tools/validate-fire.js`. Aplikacja pokazuje zgłoszenia na warstwie „Ogień” mapy.

### Nakładka od przełożonego `overlay` w wiadomości inbox (T51)

Wiadomość `player/inbox` (zwykle rozkaz przełożonego) może mieć `overlay: { "id", "name", "features": [ … ] }` — graficzną nakładkę (granice, rubieże, osie, rejony), którą gracz włącza w panelu Warstwy. `id` (1–30 znaków: litery, cyfry, `_`, `-`) wiąże kolejne wersje: nowsza nakładka o tym samym `id` (późniejszy `time` wiadomości) zastępuje starszą. `name` ≤ 60 znaków. `features` (1–60) to **szkice w formacie `player/notes`** (`id`, `kind`, `name`, `geometry`, `graphic`, `color`, `echelon`, `flip`, `sidc` dla `symbol`; id unikalne w nakładce) — te same znaki taktyczne co w szkicach. Walidacja: `checkOverlay` (`shared/overlay.js`) przez `checkNote`; nieznany znak (`graphic`) albo rodzaj to błąd. Pole jest zabronione w `player/outbox`. Gracz może skopiować nakładkę do własnych szkiców i dołączyć ją do rozkazu.

### Rozkaz graficzny w `attachments` (T44)

Gracz zaznacza jednostki na mapie i wskazuje punkt, trasę, rubież albo rejon; wynik jest **załącznikiem do rozkazu**, nie jego wykonaniem (tarcie, czas i interpretacja podwładnego zostają po stronie sędziego). Sędzia czyta geometrię razem z treścią wiadomości; niejasność = interpretacja podwładnego. Walidacja: `checkOrderAttachment` z `shared/order.js` (serwer przy `POST /api/outbox` — pole `orders` w ciele żądania — i walidator scenariusza).

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | tekst `[\w-]{1,40}` | tak | `o-xxxxxxxx`. |
| `kind` | `"order"` | tak | Odróżnia od kopii szkicu (`arrow`, `line`, `area`, `point`, `symbol`). |
| `name` | tekst ≤ 80 | tak | Np. „Marsz do — 1 bzmot”. |
| `units` | lista id (1–12) | tak | Jednostki własne z bieżącej tury gracza, których dotyczy wskazanie. |
| `task` | `move`, `occupy`, `defend`, `attack`, `recon` | tak | Marsz do, zajmij rejon, broń rubieży, natarcie na, rozpoznanie. |
| `geometry` | `{type, coordinates}` | tak | GeoJSON `[lon, lat]`: `move` → Point (punkt) albo LineString (trasa); `occupy` → Polygon; `defend` → LineString (rubież); `attack`, `recon` → Point, LineString (oś / trasa) albo Polygon. |

Zaznaczenie jednostek różnych dowódców tworzy osobne szkice w ich kanałach (ten sam rozkaz z tą samą geometrią, osobna wiadomość do każdego dowódcy) — albo jeden załącznik w kanale wspólnego przełożonego, gdy gracz tak wybierze. Gdy gracz omija dowódcę (rozkaz do kompanii), obowiązują zasady z CLAUDE.md („Rozkazy do dowolnej jednostki własnej”).

## `player/notes/NNN.json` — jawny, zapisuje aplikacja

`{ "turn": N, "items": [ … ] }` — szkice gracza dla tury N (brak pliku = dziedziczone z ostatniej wcześniejszej tury). **Sędzia nie modyfikuje.** Walidowane przez `checkNote` / `validateNote` z `shared/schema.js` (przy zapisie przez API i przez walidator). Maks. 500 rysunków, id unikalne.

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | tekst `[\w-]{1,40}` | tak | `n-pxgh26gl`. |
| `kind` | `arrow`, `line`, `area`, `point`, `symbol` | tak | Rodzaj → typ geometrii: arrow/line = `LineString`, area = `Polygon`, point/symbol = `Point`. |
| `name` | tekst ≤ 60 | tak | Nazwa. |
| `description` | tekst ≤ 1000 | nie | Opis. |
| `color` | `blue`, `red`, `black` | nie | Domyślnie `black`. |
| `graphic` | tekst | nie | Znak taktyczny zależny od `kind` (`NOTE_GRAPHICS`: arrow → `axis_main`, `axis_support`, `axis_catk`, `direction`; line → `phase_line`, `boundary`, `flot`, `obstacle_line`, `line`; area → `generic`, `assembly`, `objective`, `engagement`, `battle_position`, `minefield`; point → `checkpoint`, `contact_point`, `target`, `point`). Brak = rysunek klasyczny. |
| `echelon` | `D`…`J` | nie | Szczebel na znaku. |
| `flip` | `true` | nie | Odbicie strony znaku (zapisywane tylko jako `true`). |
| `sidc` | tekst(15) | dla `symbol` | Symbol NATO. |
| `geometry` | `{type, coordinates}` | tak | GeoJSON: Point `[lon,lat]`; LineString ≥ 2 punkty; Polygon: pierścienie ≥ 4 punkty. |

## `player/ccir.json` — jawny, zapisuje aplikacja (T48)

`{ "items": [ … ] }` — CCIR gracza (krytyczne potrzeby informacyjne dowódcy). Jeden plik na scenariusz (nie per tura); brak pliku = pusta lista. **Sędzia nie modyfikuje** (tylko czyta, żeby wiedzieć, o czym alarmować). Walidowane przez `checkCcir` z `shared/ccir.js` (API `GET/PUT /api/ccir` i walidator). Maks. 7 pozycji (więcej = błąd), zalecane 3–7 (mniej niż 3 = uwaga).

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `id` | `PIR-N` / `FFIR-N` | tak | Unikalne; przedrostek zgodny z `kind`. |
| `kind` | `PIR`, `FFIR` | tak | PIR = o przeciwniku, FFIR = o własnych siłach. |
| `text` | tekst ≤ 200 | tak | Treść, np. „czołgi RU na wschód od linii Wiżajny–Rutka-Tartak”. |
| `geometry` | `{type, coordinates}` | nie | Rejon / linia / punkt z mapy: `Point`, `LineString` (≥ 2 punkty) albo `Polygon` (pierścienie ≥ 4 punkty), `[lon, lat]`. Aplikacja rysuje ją jako nakładkę. |

## `umpire/turns/NNN.json` — TYLKO sędzia

Pełna prawda dla tury N. Serwer nigdy go nie czyta i nie wysyła; walidator sprawdza strukturę, a w logach wypisuje tylko identyfikatory.

Ma te same pola co plik gracza (`turn`, `time`, `units`, `assets`, `lines`), plus:
- `units[]`/`assets[]`: `side` (`PL` / `RU` / …), `supply` (jednostki: `{fuel, ammo, general}` w dniach zaopatrzenia, DOS; gracz widzi tylko meldowane `dos`), `endurance_min` (tylko środki: pozostały czas lotu; to inne pole niż `stamina_min` jednostek), `stamina_min` (jednostki: reszta wytrzymałości w minutach, ≥ 0) i `morale` (jednostki: 0–1), z których sędzia wylicza `fatigue` gracza, pełne i prawdziwe `personnel`/`equipment` (dla jednostek własnych identyczne jak w pliku gracza),
- jednostki wroga (`side` ≠ strona gracza) z prawdziwymi pozycjami i stanami (kontaktów się tu nie zapisuje — to widok gracza),
- `logistics`: prawdziwy stan warstwy logistycznej (kształt jak u gracza, patrz „`logistics`”; pola dodatkowe dozwolone),
- `events`: lista tekstów — zdarzenia tury dla sędziego,
- `deliveries` (T25): doręczenia rozkazów gracza rozstrzygnięte w tej turze (nie dziedziczone). Lista `{ msg_id, to, sent, delivered, means, note? }`: `msg_id` = id z `player/outbox`, `to` = id adresata (jednostka/kanał), `sent` = czas wysłania w grze (ISO), `delivered` = godzina doręczenia (ISO, ≥ `sent`; może wypaść po czasie tury, gdy rozkaz jest w drodze) albo `null` dla zgubionego, `means` ∈ `radio` | `relay` (retransmisja) | `courier` | `lost`, `note` = powód (zagłuszenie, cisza radiowa, odległość). Rozkaz obowiązuje od `delivered`; `lost` = adresat działa wg poprzedniego zamiaru. **Wyłącznie w `umpire/`**: `deliveries` w pliku gracza to błąd (strażnik wycieku); UI komunikatora nie pokazuje doręczeń. Walidator: `checkDeliveries`.
- `ew` (T26): prawdziwy obraz REW, dziedziczony z tury N. `{ zones: [{ id, kind, owner, coords, from?, until?, … }] }`: `kind` ∈ `jamming` | `df` (strefa namierzania) | `decoy` (wabik), `owner` = strona (`RU`, `PL`), `coords` = zamknięty wielokąt, `from`/`until` = okno działania (ISO); pola dodatkowe (moc, zasięg) dozwolone. To, co z tego zna gracz, trafia do niego wyłącznie jako `lines[].kind = "ew_zone"` (meldunek), kontakty-nadajniki albo skutki (opóźnione/zgubione rozkazy, przerwane meldunki). Walidator: `checkEw`.

## `umpire/enemy-plan.md` — TYLKO sędzia

Plan przeciwnika w Markdownie (zamiar, siły, fazy czasowe). Swobodna forma. Nie ujawniany do `status: "finished"`.

## `umpire/log.md` — TYLKO sędzia

Dziennik rozstrzygnięć: nagłówek `## Tura N (HH:MM)` i krótkie punkty „co i dlaczego”. Dopisywany przy każdej turze.

## `umpire/commanders/<id>.md` — TYLKO sędzia (planowane, T14)

Plik wiedzy dowódcy-agenta (podwładny gracza lub przeciwnik): kim jest (osobowość, doświadczenie, styl), jego jednostki, otrzymane rozkazy i szkice, co sam wie o sytuacji, dziennik własnych decyzji. Agent dostaje tylko swój plik i swoją wiadomość wejściową — nigdy `umpire/turns/` ani plików innych dowódców. Nazwa pliku = `commander` z kanału w `scenario.json`.

## Kto co zapisuje

| Plik | Sędzia (Claude) | Aplikacja / gracz |
|---|---|---|
| `scenario.json`, `briefing.md`, `gazetteer.json` | tworzy, edytuje | tylko odczyt |
| `player/turns`, `player/inbox` | zapisuje | tylko odczyt |
| `player/outbox`, `player/notes`, `player/ccir.json` | tylko czyta | zapisuje (API, atomowo, serializowane) |
| `umpire/**` | zapisuje i czyta | **nigdy** (serwer nie czyta) |

Kolejność zapisu nowej tury: `umpire/` → `player/inbox` → na końcu `player/turns` (pojawienie się nowej tury przełącza aplikację). Po każdej turze: `npm run validate -- <nazwa>`.

## Migracja

- Wersja 1 — pierwsza oznaczona wersja (opis stanu istniejącego, bez zmian nazw pól).
