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

Pliki dzielą się na **jawne dla gracza** (serwer je czyta i wysyła do przeglądarki) i **tylko sędziego** (`umpire/`, serwer ich nigdy nie czyta). Pliki gracza mogą zawierać wyłącznie pola z kolumny „gracz” poniżej (biała lista `PLAYER_FIELDS` w `shared/schema.js`). Każde pole spoza listy (np. `side`, `supply`, `events`, `endurance_min`) w pliku gracza to **błąd walidatora** — pilnuje tego `npm run validate`, który trzeba uruchamiać po każdej turze.

### Niespójności nazewnictwa (świadomie zachowane)

Pliki mieszają `camelCase` (`turnMinutes`, `schemaVersion`) i `snake_case` (`uncertainty_m`, `estimate_personnel`, `endurance_min`, `enemy_flot`), a `current`/`authorized` w jednostkach kontra `count` w szacunkach. Decyzja: **nie zmieniamy nazw istniejących pól** (zgodność ze scenariuszami, testami i klientem). Nowe pola nazywamy w `camelCase`; ewentualne ujednolicenie tylko razem z podniesieniem `schemaVersion` i migracją.

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

Kanał (`channels[]`): `id` (tekst, unikalny, tak), `name` (tak), `kind` (`superior`, `neighbor`, `subordinate`, `logistics`, `recon`, `other`; inny = uwaga), `description` (nie), `short` (nie, skrót w UI), `unit` (nie, id jednostki, której kanał dotyczy), planowane `commander` (id pliku `umpire/commanders/<id>.md`, T14). Wiadomość można też zaadresować do dowolnej jednostki własnej z bieżącej tury (`channel` = id jednostki).

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

Stan świata **taki, jaki zna gracz**: własne siły na prawdziwych pozycjach, wróg tylko jako kontakty. Pola najwyższego poziomu (gracz): `turn`, `time`, `units`, `contacts`, `assets`, `lines`, `logistics`.

| Pole | Typ | Wym. | Znaczenie |
|---|---|---|---|
| `turn` | liczba | tak | Musi równać się numerowi z nazwy pliku. |
| `time` | czas ISO | tak | Czas tury (= start + N × turnMinutes, inaczej uwaga). |
| `units` | lista | tak | Jednostki własne, przełożony, sąsiedzi. |
| `contacts` | lista | nie | Kontakty z wrogiem. |
| `assets` | lista | nie | Środki rozpoznania gracza. |
| `lines` | lista | nie | Linie operacyjne. |
| `logistics` | obiekt | nie | Warstwa logistyczna znana graczowi (sekcja `logistics` niżej). |

Wszystkie elementy `units`/`contacts`/`assets` mają unikalne w pliku `id`.

### `units[]` (gracz)

| Pole | Typ | Wym. | Znaczenie / przykład |
|---|---|---|---|
| `id` | tekst | tak | `1bzmot-1k`. Jest też dozwolonym kanałem wiadomości. |
| `name` | tekst | zalec. | `1 kompania`. |
| `sidc` | tekst(15) | tak | `SFGPUCIZ---F---`. |
| `pos` | `[lon,lat]` | tak | Pozycja prawdziwa (własne siły). |
| `strength` | liczba 0–1 | nie | Siła bojowa. |
| `status` | tekst | nie | `w marszu`, `SD rozwinięte`… |
| `task` | tekst | nie | Bieżące zadanie. |
| `personnel` | `{current, authorized}` | nie | Liczby całkowite ≥ 0; `current > authorized` = uwaga. |
| `equipment` | `[{name, current, authorized}]` | nie | Główny sprzęt. |
| `parent` | tekst | nie | Id jednostki nadrzędnej (istniejącej, bez cykli). Przełożony i sąsiedzi bez `parent`. |
| `formation` | tekst | nie | **Jednostka sąsiada** (nie podlega graczowi): id dowództwa sąsiada z tej samej tury (np. `zt-mamry`), zamiast `parent`. Cel nie ma ani `parent`, ani `formation` (brak cykli); `parent` i `formation` naraz = błąd. Podwładni takiej jednostki mogą używać `parent` (należą do formacji pośrednio). Takie jednostki nie mają kanałów komunikatora (serwer odrzuca wiadomość: 400). |
| `track` | `[[lon,lat], …]` | nie | Trasa przejechana w turze, która **kończy się** w `pos` (pierwszy punkt = pozycja z poprzedniej tury). ≥ 2 poprawne punkty (inaczej błąd); ostatni punkt ≠ `pos` (tolerancja 1e-6°) albo pierwszy punkt dalej niż ~100 m od poprzedniej pozycji = uwaga. Służy tylko animacji przemieszczenia; bez `track` jednostka jedzie po prostej. Dotyczy jednostek własnych i sąsiadów. |
| `notes` | tekst | nie | Opis do karty jednostki. |
| `dos` | `{fuel, ammo, general, readiness, as_of}` | nie | **Meldowany** stan zaopatrzenia (T18): `fuel`/`ammo`/`general` = dni zaopatrzenia (liczby ≥ 0, każde opcjonalne, ale wymagany min. jeden wskaźnik razem z `readiness`), `readiness` = sprawność sprzętu 0–1, `as_of` = czas meldunku ISO (wymagany). To wiedza gracza, nie prawda: może być nieaktualna i zaokrąglona. Wartość ujemna, `readiness` > 1 albo zły `as_of` = błąd. Prawdziwy stan to `supply` w `umpire/turns/`. |

Pola **tylko sędziego** (w `umpire/turns/`, zabronione w pliku gracza): `side`, `supply`.

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
| `estimate_equipment` | `[{name, count, approx}]` | nie | Szacunek sprzętu. |

**Kontakt-nadajnik (T26):** namierzony nadajnik to kontakt z SIDC funkcji `UUMSEI` (np. `SHGAUUMSEI----`), **zawsze status `A`** (niepotwierdzony, ramka przerywana; błąd, gdy inny), `source` powinno wskazywać REW/DF (brak = uwaga), `uncertainty_m` zwykle duże. Pozostałe SIDC REW (`SIDC` w `public/js/domain/sidc.js`): `UUMS` rozpoznanie radiowe (SIGINT), `UUMSE` jednostka REW, `UUMSED` namierzanie (DF), `UUMSEJ` zagłuszanie.

### `assets[]` (gracz)

`id` (tak), `name`, `type` (np. `dron rozpoznawczy FlyEye`), `sidc`, `pos` (tylko gdy w powietrzu / rozwinięty), `status`, `task`. **Tylko sędzia:** `side`, `endurance_min`.

### `lines[]` (gracz)

`id` (tekst), `kind` (`boundary`, `flot`, `enemy_flot`, `phase`, `axis`, `enemy_axis`, `ew_zone`; inny = uwaga), `label` (tekst), `coords` (`[[lon,lat], …]`, ≥ 2 punkty, tak), `observed` (czas ISO meldunku; wymagane dla `ew_zone`), `formation` (nie; id dowództwa sąsiada z tej samej tury — linia należy do sąsiada, np. jego FLOT; ta sama reguła celu co przy `units[].formation`).

## `player/inbox/NNN.json` — jawny

`{ "messages": [ … ] }` — wiadomości do gracza z rozstrzyganego okresu (między turą N a N+1); plik NNN odpowiada turze, w której wiadomości się pojawiają. Zapisuje sędzia.

Wiadomość: `id` (tekst, unikalny w całym scenariuszu, np. `in-000-01`, tak), `channel` (id kanału lub jednostki z tury, tak), `from` (tekst: „stopień nazwisko, funkcja”), `time` (ISO, tak), `type` (`rozkaz`, `zarzadzenie`, `meldunek`, `wiadomosc`; nie), `priority` (`normal`, `urgent`; nie), `text` (niepusty, ≤ 4000 znaków, tak). Aplikacja pokazuje `type` jako znacznik na karcie wiadomości, a `priority: "urgent"` jako „PILNE”.

## `player/outbox/NNN.json` — jawny, zapisuje aplikacja

`{ "messages": [ … ] }` — rozkazy gracza z tury N. **Sędzia nie modyfikuje tego pliku** (tylko czyta). Wiadomość: `id` (`out-xxxxxxxx`), `channel`, `turn`, `time` (czas gry tury), `sent` (rzeczywisty czas wysłania, ISO UTC), `type` (kategoria rozkazu wybrana przez gracza: `rozkaz`, `zarzadzenie`, `meldunek`, `wiadomosc`; domyślnie `wiadomosc`), `priority` (`normal` albo `urgent` — przełącznik „Pilne”; domyślnie `normal`), `text`, opcjonalne `attachments` (kopie szkiców, jak w `notes`). Zapis przez API jest serializowany (kolejka per scenariusz), a plik zapisywany atomowo przez unikalny plik tymczasowy.

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

## `umpire/turns/NNN.json` — TYLKO sędzia

Pełna prawda dla tury N. Serwer nigdy go nie czyta i nie wysyła; walidator sprawdza strukturę, a w logach wypisuje tylko identyfikatory.

Ma te same pola co plik gracza (`turn`, `time`, `units`, `assets`, `lines`), plus:
- `units[]`/`assets[]`: `side` (`PL` / `RU` / …), `supply` (jednostki: `{fuel, ammo, general}` w dniach zaopatrzenia, DOS; gracz widzi tylko meldowane `dos`), `endurance_min` (środki: pozostały czas lotu), pełne i prawdziwe `personnel`/`equipment` (dla jednostek własnych identyczne jak w pliku gracza),
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
| `player/outbox`, `player/notes` | tylko czyta | zapisuje (API, atomowo, serializowane) |
| `umpire/**` | zapisuje i czyta | **nigdy** (serwer nie czyta) |

Kolejność zapisu nowej tury: `umpire/` → `player/inbox` → na końcu `player/turns` (pojawienie się nowej tury przełącza aplikację). Po każdej turze: `npm run validate -- <nazwa>`.

## Migracja

- Wersja 1 — pierwsza oznaczona wersja (opis stanu istniejącego, bez zmian nazw pól).
