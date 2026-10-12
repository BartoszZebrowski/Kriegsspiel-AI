# Architektura klienta — jednokierunkowe MVC

Dotyczy `public/js/` (ES modules, bez bundlera i frameworka). Serwer opisuje [CLAUDE.md](../CLAUDE.md), format danych [SCHEMA.md](SCHEMA.md), uzasadnienie zmiany [ARCHITECTURE-AUDIT.md](ARCHITECTURE-AUDIT.md).

## Idea w jednym obrazku

```
              intencje (wywołania metod)                    zapytania HTTP / SSE
   ┌──────────┐ ───────────────────────────►  ┌────────────┐ ─────────────────────► ┌───────────┐
   │  WIDOKI  │                               │ KONTROLER  │                        │  api.js   │
   │ (views/) │ ◄───────────────────┐         │(controller)│ ◄───────────────────── │  serwer   │
   └──────────┘                     │         └─────┬──────┘      odpowiedzi        └───────────┘
        ▲  render ze store          │               │ store.set(patch)
        │  (subskrypcja plastrów)   │               ▼
        │                           │         ┌────────────┐
        └───────────────────────────┴──────── │   STORE    │   jedyne źródło prawdy
                                              │ (core/)    │   + wartości pochodne (archive, channels…)
                                              └─────┬──────┘
                                                    │ używa czystych funkcji
                                                    ▼
                                              ┌────────────┐
                                              │  DOMAIN    │   sidc, orbat, strength, geo, tactical,
                                              │ (domain/)  │   linkify, format, cards, markdown…
                                              └────────────┘
```

Dane płyną tylko w jedną stronę: **widok → intencja → kontroler → store → widok**. Widok nigdy nie zmienia store bezpośrednio i nie woła API.

## Warstwy i układ katalogów

```
public/js/
  main.js              bootstrap: tworzy store, kontroler i widoki, spina je, uruchamia SSE
  core/
    store.js           Model: obserwowalny store + wartości pochodne (bez DOM)
    controller.js      intencje użytkownika, API, SSE, tokeny sekwencji (bez DOM)
    api.js             klient HTTP/SSE (woła go tylko kontroler)
  domain/              czysta logika bez DOM i bez Leaflet (testowana w Node)
    sidc, orbat, strength, geo, tactical, linkify, format, cards, markdown,
    messages (filtr wg tury, nieprzeczytane, rodzaje, kanały), entities (findEntity),
    mgrs, omnibox (indeks i ranking), timeline (węzły i ścieżki), splitter (clamp, zwijanie),
    mentions (@ i #), briefing (dokument ze spisem treści),
    motion (animacja przemieszczeń: długość i punkt na łamanej, wygładzenie, plan ruchu z dwóch tur)
  views/               każdy widok: subskrybuje plastry store, emituje intencje
    topbar, docks (splittery, szyny, pasek zakładek), hotkeys, tooltips, toasts, briefing,
    structure, inspector, legend, messenger, timeline, omnibox, leader, draw,
    map/{index,controls,basemaps,lines,hierarchy,motion,ewzones,logistics,ranges}
    podkatalogi widoków (patrz „Podział dużych plików”): draw/, messenger/, structure/
  lib/                 liście bez zależności od warstw: storage (localStorage), symbols (milsymbol), icons (sprite SVG)
  sidc.js              cienki re-export domain/sidc.js (importuje go tools/validate.js)
```

### Reguła zależności

```
main  →  views, controller  →  store  →  domain
```

- `domain/` nie importuje niczego spoza `domain/`; nie dotyka DOM, `window`, `localStorage` ani Leaflet.
- `core/` (store, kontroler) też nie dotyka DOM: zależności (API, storage, środowisko) dostaje przez parametry. Dzięki temu testy działają w samym Node.
- `views/` importują `domain/`, `lib/` i dostają `store` oraz `controller` jako parametry. **Widoki nie importują się nawzajem i nie wołają się nawzajem.** Widok `views/x.js` wolno rozbić na moduły w własnym katalogu `views/x/` (np. `views/map/*`, `views/draw/*`): importować się wolno tylko w obrębie jednej grupy `x`. Komunikują się wyłącznie przez store (stan) i kontroler (intencje).
- `main.js` jest jedynym miejscem, które zna wszystkie części.

Dwa świadome kontrakty między widokami (bez importów):

0. **Zaznaczenie jest jedno** (`store.selection`): mapa, struktura, inspektor i komunikator czytają je ze store. Zmiana tury nie przenosi zaznaczenia na jednostkę kanału, jeśli coś już zaznaczono.
1. **Powierzchnia mapy** (`mapView.surface = { map, pointOf }`): obiekt Leaflet jest współdzielonym zasobem renderowania. Widok mapy go tworzy, a `main.js` przekazuje go widokom nakładek (`draw`, `leader`) jako parametr.
2. **Kotwica linii do jednostki:** komunikator oznacza aktywną kartę kanału atrybutem `data-leader-anchor`, a `leader` czyta jego położenie z DOM.

## Store — plastry stanu

`core/store.js`: `createStore()`, `store.get()`, `store.set(patch)`, `store.subscribe(klucze | '*', fn, { immediate })`. Powiadomienie dostają tylko subskrybenci zmienionych kluczy (porównanie `!==`). Jedno `set` = jedno powiadomienie. `set` wywołany z subskrybenta jest kolejkowany.

| Plaster | Znaczenie |
|---|---|
| `scenario`, `turns`, `currentTurn`, `viewTurn` | scenariusz, lista tur, tura bieżąca i oglądana |
| `turn` | dane oglądanej tury (jednostki, kontakty, środki, linie) |
| `messages`, `notes`, `places` | wiadomości (wszystkie), szkice oglądanej tury, gazeter |
| `selection`, `details`, `hoverUnit` | podświetlony obiekt `{id, kind}`, obiekt w panelu szczegółów, jednostka wskazana myszą |
| `focus` | jednorazowe polecenie dla widoku (`entity`, `place`, `geometry`) z `nonce` — widok reaguje na zmianę obiektu |
| `detail`, `mapZoom`, `layers`, `basemap` | wybór szczegółowości (`battalion` / `company` / `platoon`), zoom, widoczność warstw (sytuacja, szkice, etykiety, nakładki kafelkowe) i podkład |
| `activeChannel`, `pinned`, `read`, `fresh` | stan komunikatora: aktywny kanał, kanały przypięte na pasku, przeczytane, wiadomości nieprzeczytane w chwili otwarcia kanału (separator „NOWE”) |
| `ui` | `leftCollapsed`, `rightCollapsed` (szyny 40 px), `mobile` (zakładka telefonu), `narrow`, `leader` (linia do jednostki), `animations` (przełącznik „Animacje”, zapamiętany), `reducedMotion` (systemowe `prefers-reduced-motion`, zgłasza `main.js`) |
| `animation` | jednorazowe zlecenie dla mapy `{ nonce, from, to, plan, ms }` — odtwórz przemieszczenia między turami (`plan` z `domain/motion.js`); `null`, gdy przejście nie jest N → N+1, animacje są wyłączone albo nic się nie ruszyło |
| `popover`, `omnibox` | otwarty popover mapy (`legend` / `layers` / `bell`) i omnibox |
| `command` | jednorazowe polecenie dla widoku `{ name, arg, nonce }`: `tool`, `fit`, `treeFilter`, `compose` (jak `focus`, reaguje tylko widok, którego dotyczy) |
| `briefing`, `notice`, `notices`, `noticesSeen` | odprawa, toast, historia komunikatów (dzwonek) |

**Wartości pochodne** liczy store (lista `DERIVED`), nigdy widok: `archive` (`viewTurn !== currentTurn` — jedyna kopia flagi), `channels`, `channel`, `channelUnit`, `visibleMessages` (w archiwum tylko do oglądanej tury), `unread`, `level` (szczegółowość wg wyboru i zoomu), `unreadUnits` (nieprzeczytane na jednostkę, dla drzewa), `outboxCount` (wiadomości gracza w bieżącej turze — pigułka „SKRZYNKA”).

Lokalny stan tylko jednego widoku (np. tekst w polu rozkazu, edytowany szkic, podzakładka legendy, podkład mapy) zostaje w tym widoku. Do store trafia to, co jest potrzebne innym widokom albo kontrolerowi.

## Jak płynie akcja użytkownika

Przykład: klik w symbol jednostki na mapie.

1. Widok mapy: `marker.on('click', () => controller.selectEntity(id))`.
2. Kontroler: wyszukuje obiekt (`findEntity`), ewentualnie odsłania ukrytą kompanię (`detail: 'company'`) i robi **jedno** `store.set({ selection, details, focus })`.
3. Store powiadamia subskrybentów tych kluczy: widok mapy podświetla symbol i linie, panel szczegółów rysuje kartę, mapa centruje się na obiekcie (`focus`), linia do jednostki się przelicza.

Akcje z zapisem (wysłanie rozkazu, zapis szkicu) idą tak samo: widok → `controller.sendMessage / saveNotes` → `api` → po sukcesie `store.set` → widoki same się odrysują.

## Jak płynie aktualizacja SSE

1. `EventSource` zgłasza `update` → `controller.onUpdate()` (odświeżenia nie nakładają się; zdarzenie w trakcie odświeżenia powtarza je raz).
2. `refresh()` pobiera scenariusz, gazeter, oglądaną turę z notatkami i wiadomości. Nowa tura bieżąca przełącza widok i pokazuje komunikat.
3. Wynik jest **porównywany** z store (`keep`): plaster bez zmian zostaje tym samym obiektem, więc nikt nie dostaje powiadomienia. Zmiana w `inbox` odświeża tylko `messages`; mapa, szkice, panel szczegółów, zaznaczenie i przewijanie zostają. Trwająca edycja kształtu nie jest przerywana.
4. Panel szczegółów zamyka się tylko wtedy, gdy jego obiektu nie ma już w nowych danych.

**Token sekwencji:** każda ręczna nawigacja (`showTurn`) zwiększa `navEpoch`. Odpowiedź starszego żądania jest odrzucana, a `refresh()` rozpoczęty przed nawigacją nie nadpisuje wyboru użytkownika (stosuje tylko dane globalne). Zmiana tury ustawia `viewTurn`, `turn` i `notes` jednym `set`, więc widoki nigdy nie widzą stanu pośredniego.

## Animacja przemieszczeń między turami

Czysta logika leży w `domain/motion.js` (testowana w Node): `pathLength`, `pointAt` (punkt na łamanej po ułamku długości), `slicePath` (ślad), `easeInOut`, `routeFor` (trasa z `track` domykana pozycjami tur albo linia prosta), `isSequential` i `buildPlan(prev, next)` → `{ moves, ghosts }`: jednostki i środki z pozycją w obu turach, które się przesunęły (`moves`, każda ze swoją trasą), oraz kontakty wroga o tym samym `id` ze zmienioną pozycją (`ghosts` — wróg nie jedzie, bo to tylko meldunki).

Przepływ: `controller.applyView` przy zmianie tury **o jedną do przodu** (wg listy dostępnych tur; żywa aktualizacja albo „następna”) i włączonych animacjach (`ui.animations` i brak `ui.reducedMotion`) liczy plan z poprzedniej i nowej tury i ustawia w **tym samym** `set` plaster `animation`; skok, cofnięcie i archiwum zerują go. `controller.replayTurn()` (przycisk „▶ Odtwórz turę”, polecenie omniboksu `replay`) pobiera poprzednią turę i ustawia samo `animation` dla oglądanej. Widok mapy (`views/map/motion.js`) subskrybuje `['turn', 'animation']`: zmiana tury zatrzymuje i sprząta stare ślady, rysuje turę w pozycjach końcowych, a zlecenie animacji cofa symbole na start i w pętli `requestAnimationFrame` przesuwa je po trasach (wszystkie kończą w `ms`, wygładzenie ease-in-out). W trakcie ruchu linie podporządkowania (`hierarchy.follow`) i linia komunikatora (zdarzenie mapy `ks:motion`, nasłuchuje je `leader`) podążają za symbolami, a poświata zaznaczenia i etykiety są częścią ikony. Ślad (cienka przerywana linia) i „duch” kontaktu blakną przez CSS (`.motion-trail`, `.motion-ghost`) i są usuwane po ~3 s. Klik gdziekolwiek lub Esc kończy animację natychmiast. Odświeżenie SSE bez zmiany tury nie dotyka plastra `animation`.

## Formacje sąsiadów

Jednostka z `formation: "<id sąsiada>"` (zob. [SCHEMA.md](SCHEMA.md)) należy do sąsiada: `domain/orbat.js` traktuje `formation` jak przełożonego w drzewie, widoczności i liniach (`parentIdOf`, `buildTree`, `childrenOf`, `hierarchyLinks` z flagą `neighbour`), ale `mergeChannels` nie tworzy dla niej kanału, a `splitUnits` wydziela ją z sił własnych (`{ own, external, formation }`; `formationTree` składa drzewo sąsiada). Widoki tylko to wyświetlają (struktura: rozwijany, przygaszony węzeł; mapa: szare przerywane linie; inspektor: tylko odczyt; omnibox: grupa „Sąsiedzi”); serwer odrzuca wiadomość do takiej jednostki.

## Jak dodać nowy widok lub funkcję

1. **Dane** — jeśli nowe pole pochodzi z serwera: dodaj je do `api.js` i (jeśli to nowy plaster) do `initialState()` w `store.js`. Logikę liczenia (filtr, sumy, grupowanie) napisz jako czystą funkcję w `domain/` z testem.
2. **Pochodne** — wartość liczona z innych plastrów trafia do `DERIVED` w `store.js`.
3. **Intencje** — każda akcja użytkownika to metoda kontrolera (`controller.xyz()`); zmienia store jednym `set` i jest testowana z fałszywym `api`.
4. **Widok** — nowy plik `views/xyz.js` z `createXyzView({ store, controller, root })`: znajdź swoje elementy po id, podepnij zdarzenia DOM → metody kontrolera, `store.subscribe([...plastry], render, { immediate: true })`. Nie importuj innych widoków.
5. **Spięcie** — jedna linia w `main.js`. Element HTML dopisz do `index.html`.
6. **Warstwa mapy** — nowy plik w `views/map/`, rysujący do własnej `L.layerGroup`; subskrypcja w `views/map/index.js`.
7. **Test dymny** — dopisz krok w `tools/smoke.mjs`; jeśli dodajesz klucz `localStorage`, użyj prefiksu `ks:<id scenariusza>:`.

## Testowanie

- `npm test` (node:test): domena, store i kontroler są DOM-free.
  - `test/store.test.js` — subskrypcje per plaster, powiadomienia, wartości pochodne (m.in. `archive`).
  - `test/controller.test.js` — z fałszywym `api` i storage: odrzucanie spóźnionych odpowiedzi, filtr wiadomości w archiwum, odświeżenie SSE różnicowe, wybór obiektów, komunikator, szkice.
  - `test/motion.test.js` — matematyka animacji i plan ruchu; `test/animation.test.js` — kiedy kontroler zleca animację (kolejne tury, wyłączenia, powtórka); `test/neighbours.test.js` — formacje sąsiadów (ORBAT, kanały, omnibox, walidator, serwer).
  - testy logiki w `test/*.test.js` importują z `public/js/domain/`.
- `npm run smoke` (`tools/smoke.mjs`): uruchamia własny serwer na tymczasowej kopii scenariusza (domyślnie `scenarios/00-test-przesmyk`; inny: `npm run smoke -- <ścieżka>`), otwiera aplikację w headless Chrome przez CDP (bez zależności npm) i przechodzi skryptowaną trasę; oryginał nigdy nie jest modyfikowany: układ i zegar z DTG, odprawa, szczegółowość (w tym pluton), inspektor, struktura, legenda (popover), komunikator (pasek kanałów, nieprzeczytane, rodzaj i „Pilne”, @ i #, wysyłka, wycofanie, załączniki, wzmianki), szkice (flyout, wszystkie znaki NATO, edycja ✓/✕, usuwanie dwuetapowe), miarka, podkłady i warstwy, omnibox, splittery i szyny docków, oś czasu i archiwum, żywa aktualizacja po nowym pliku tury, animacja przemieszczeń (trasa, ślad, duch kontaktu, powtórka, przełącznik i reduced-motion), formacje sąsiadów (drzewo, brak kanałów, POST → 400, mapa, inspektor, omnibox), telefon 390 px. Kopia scenariusza jest obcinana do tury 0 (rozgrywana kampania ma kolejne tury). Kończy z kodem ≠ 0 przy błędzie kroku albo błędzie JS w konsoli. Chrome znajduje po `CHROME_PATH` lub w typowych lokalizacjach; flaga `--keep` zostawia katalog roboczy.
- Debug: `?debug` w adresie wystawia `window.__ks = { store, controller, map, surface, drawing }`.

## Podział dużych plików (T40)

Cel: ≤ ~300 linii na plik, podział wg odpowiedzialności, zachowanie bez zmian, eksporty publiczne zachowane (re-export). Reguły zależności pilnuje `test/architecture.test.js` (czysta funkcja `findViolations(pliki)` + skan `public/js`): `domain/` nie importuje spoza `domain/`, widoki nie importują innych widoków (tylko własny katalog), widoki nie importują `core/`, `core/` nie używa `document`/`window`/`localStorage` i nie importuje widoków.

| Plik (linie przed → po) | Nowe moduły wg odpowiedzialności |
|---|---|
| `views/draw.js` (877 → 389) | `views/draw/graphics.js` (stałe, narzędzia, podpowiedzi, `hypothesisSidc`, podgląd znaku), `draw/editor.js` (okno edycji rysunku), `draw/measure.js` (miarka), `draw/shapes.js` (warstwy kształtów, popup, dekoracje znaków). W `draw.js` zostaje paleta narzędzi i flyout, tryby rysowania, edycja kształtu, synchronizacja ze store — jeden stan narzędzia współdzielony przez te części. |
| `core/controller.js` (556 → 367) | `core/selection.js` (zaznaczenie, centrowanie, wzmianki, szczegółowość), `core/messaging.js` (kanały, przeczytane, szkice wiadomości, wysyłanie), `core/layout.js` (docki, telefon, animacje, popovery, omnibox). Zostają: komunikaty, ładowanie i nawigacja po turach, odświeżenie SSE, animacja przemieszczeń, stan mapy, szkice, odprawa, polecenia. |
| `views/messenger.js` (536 → 322) | `views/messenger/templates.js` (szablony), `glyphs.js` (awatary kanałów), `thread.js` (wątek wiadomości), `mentions.js` (podpowiedzi @ i #). |
| `tools/validate.js` (510 → 197) | `tools/validate-checks.js` (sprawdzenia plików tury: SIDC, stany, hierarchia, formacje, linie, trasy, gazeter), `tools/validate-realism.js` (T37: spójność i realizm, re-eksportowane z `validate.js`). |
| `domain/tactical.js` (379 → 199) | `domain/tactical-geometry.js` (geometria łamanych w pikselach; re-eksportowana). `tactical.js`: katalog znaków, `buildGraphic`, `mainStyle`, ikony punktów. |
| `views/structure.js` (364 → 300) | `views/structure/html.js` (czyste budowniczowie HTML: węzły drzewa, wiersze kontaktów i środków, sekcje). |
| `tools/umpire/turn.mjs` (376 → 232) | `tools/umpire/turn-merge.mjs` (czyste pomocniki: łatki, trasy, logistyka, skrzynka; re-eksportowane). `turn.mjs`: `buildTurn`, pliki, CLI. |
| `views/map/index.js` (319 → 282) | `views/map/logistics.js` (warstwa logistyczna wzorem `ewzones.js`); `LG_SIDC` w `domain/logistics.js` (jedno miejsce dla mapy i inspektora). |

Zostają większe niż ~300 linii: `views/draw.js` (389) i `core/controller.js` (367) — dalszy podział wymagałby przekazywania wspólnego, często zmienianego stanu (aktywne narzędzie / edycja kształtu; epoki nawigacji i odświeżenie) między modułami, co pogorszyłoby czytelność. `tools/smoke.mjs` (1190), `tools/umpire/deploy.mjs` (473), `terrain-view.mjs` (367) i testy są poza zakresem T40.

## Katalog wyposażenia (T46)

Jawny katalog sprzętu i uzbrojenia (dane z jawnych źródeł; zasięgi skuteczne, orientacyjne). Jedno źródło prawdy, trzy warstwy:

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Dane | `data/equipment.json` | `{ categories:[{id, portable?}], weaponKinds:{kind: opis}, items:[{id, name, side: PL\|RU, category, crew?, weapons?:[{name, range_m, kind}], note}] }`. Kolejność i lista kategorii oraz rodzajów broni są **w danych** (nie dublujemy ich w kodzie). Część `side: "RU"` = przeciwnik (RU/BY). |
| Walidacja | `shared/equipment.js` (czysty JS, bez DOM i Node) | `checkCatalog(catalog)` → lista błędów (id unikalne, kategoria i `kind` z listy katalogu, broń bez `range_m` > 0 = błąd), `indexCatalog`, `checkEquipmentRef`. Używają go walidator scenariusza (`tools/validate-equipment.js`) i testy. |
| Serwowanie | `server/app.js` | jawna lista `DATA` (jak `VENDOR` i `SHARED`): tylko `GET /data/equipment.json`; nic innego z `data/`. |
| Klient | `core/api.js` → `controller.init` → plaster `equipment` w store | katalog ładuje się raz przy starcie (brak katalogu = karty działają jak dotąd). |
| Logika | `domain/equipment.js` (czysta; katalog dostaje jako parametr, bo `domain/` nie importuje z `shared/`) | `indexCatalog`, `groupEquipment` (wg kategorii, z zasięgami), `subordinateTotals` (suma z podwładnych), `portableSummary` („3 × UKM-2000, 2 × Pirat”), `formatRange`. |
| Widok | `domain/cards.js` (HTML karty) + `views/inspector.js` | inspektor podaje `ctx.catalog` z store; karta renderuje grupy. Bez nowych zależności między widokami. |

Zgodność wstecz: `equipment[]` i `estimate_equipment[]` mogą mieć `ref` (id z katalogu) obok `name`; wpis bez `ref` działa jak dotąd (grupa „Inne”). Walidator: `ref` spoza katalogu = błąd. Katalog nie jest plikiem gracza ani sędziego, więc nie obowiązuje go strażnik wycieku; zasięgi wroga w kliencie wynikają wyłącznie z **szacunku** gracza (`estimate_equipment` + `ref`), nigdy z prawdy.

## Rozkaz graficzny na mapie (T44)

Gracz zaznacza jednostki, wskazuje na mapie punkt / trasę / rubież / rejon i wybiera zadanie. Wynik to **załącznik strukturalny do szkicu wiadomości** (nie wykonanie): `{ id, kind: "order", name, units:[id], task, geometry }`. Tarcie (T25) i interpretacja przez podwładnego zostają po stronie sędziego.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/order.js` (czysty JS) | `ORDER_TASKS` (zadanie → dozwolone typy geometrii), limity, `checkOrderAttachment(a)` → `{ order }` albo `{ error }`. Używają go serwer (`store.sendMessage`), walidator scenariusza i testy. Osobny plik, bo `shared/schema.js` ma jednego właściciela naraz. |
| Logika | `domain/order.js` (czysta, testowana w Node) | `ORDER_TASKS` z nazwami dla UI (id jak w `shared/order.js` — komentarz zamiast importu, bo `domain/` nie importuje z `shared/`), `selectableUnits`, `unitsInBounds` (ramka), `toggleUnit`, `geometryFromPoints`, `orderGraphic` (zadanie + typ geometrii → rodzaj i znak z `domain/tactical.js`), `deliveryGroups` (jednostki → kanały), `buildOrderAttachments`, `orderPreviewNote`, `addDraftOrders` / `removeDraftOrder`. |
| Stan | `core/store.js` | plaster `orderMode`: `null` albo `{ selected:[id], task, kind, delivery }`. Geometria w trakcie klikania jest lokalna dla widoku mapy; szkice (`drafts[kanał].orders`) już istnieją (T33). |
| Intencje | `core/orders.js` (podkontroler jak `messaging.js`) | `toggleOrderMode`, `orderPick`, `orderSetTask`, `orderSetKind`, `orderSetDelivery`, `orderRemoveUnit`, `orderCommit(geometry)`: buduje załączniki, dopisuje je do szkiców właściwych kanałów **jednym** `store.set`, otwiera pierwszy kanał. Zmiana tury (`applyView`) zeruje tryb. |
| Widoki | `views/map/order.js` (tryb: zaznaczanie klikiem / Shift+klik / Shift+ramką, panel zadań, zbieranie punktów) i `views/map/order-preview.js` (podgląd wszystkich załączników ze szkiców znakiem taktycznym, do czasu wysłania) | importują tylko `domain/` i `lib/`; `index.js` mapy przekazuje im `markers` i oddaje kliknięcie w symbol, gdy tryb jest aktywny. Messenger (`views/messenger/orders.js`) pokazuje załączniki w szkicu i wysyła je razem z wiadomością. |
| Wspólny render znaku | `lib/tactical-layers.js` | `addBuiltLayers(group, built, color, toLL)` rysuje wynik `buildGraphic` na grupie Leaflet (bez importu `domain/`: `built` dostaje jako dane). Używają go `views/draw/shapes.js` i podgląd rozkazu — jedna implementacja. |

**Decyzja (WA3): kanały.** Domyślnie (`delivery: "own"`) każda zaznaczona jednostka dostaje osobny załącznik w szkicu **własnego** kanału (dowódcy tej jednostki), z tą samą geometrią. Przełącznik „przez wspólnego przełożonego” (`"common"`) składa jednostki w jeden załącznik w kanale najniższego wspólnego przełożonego, o ile ma kanał podwładnego; w przeciwnym razie zachowuje się jak `own`. Jednostki bez kanału (sąsiedzi, przełożony) są pomijane z komunikatem. Szkice w kanałach są niezależne, gracz wysyła je osobno (z możliwością edycji tekstu).

**Serwer:** `POST /api/outbox` przyjmuje dodatkowe `orders: [...]`; każdy element przechodzi `checkOrderAttachment`, jednostki muszą istnieć w bieżącej turze gracza i nie należeć do formacji sąsiada. Do pliku `outbox` trafiają w `attachments` obok kopii szkiców. Zapis do `player/outbox`, `docs/SCHEMA.md`, walidator (`tools/validate.js`) sprawdza `kind: "order"` tym samym `checkOrderAttachment`.

## Zasięg ognia na mapie (T47)

Plan: zasięgi z katalogu wyposażenia (T46) rysowane jako pierścienie. WA 4 (sektory ognia i martwe pola z liniami widoczności z danych wysokościowych, T43) jest **przyszłe**: promień to zasięg skuteczny „na płasko”, a `domain/ranges.js` zostaje miejscem, do którego dojdzie kształt inny niż okrąg.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Logika | `domain/ranges.js` (czysta; katalog jako parametr) | `RANGE_KINDS` (rodzaje broni, kolejność, kolory — jedno miejsce dla mapy, panelu i legendy), `matchItem` (wpis sprzętu → pozycja katalogu), `unitRanges` (maks. zasięg na rodzaj wyłącznie z WŁASNEGO sprzętu jednostki — stany szczebli nadrzędnych już obejmują podwładnych, dowództwo bez broni nie ma pierścieni; rodzaj bez broni = brak pierścienia), `contactRanges` (wyłącznie z `estimate_equipment`, `estimate: true`, `uncertainty_m`), `entityRanges`, `coverageRings` (tryb „wszystkie jednostki”: widoczne wg szczegółowości jednostki własne, bez sąsiadów, bez dublowania rodzic+podwładni: najniższy widoczny szczebel z daną bronią). |
| Widok | `views/map/ranges.js` (własna `L.layerGroup`, wzorem `ewzones.js`) | Subskrybuje `turn, selection, equipment, layers, level`. Pierścienie zaznaczenia (jednostka: linia ciągła; kontakt: przerywana + obwódka „zasięg + niepewność”), pierścienie pokrycia dla włączonych warstw, mały panel z przełącznikami rodzajów (stan lokalny widoku) i kolorową legendą. |
| Warstwy | `layers['range:<rodzaj>']` w store, wiersze w `views/map/controls.js` | „Zasięg ppanc: wszystkie jednostki” itd.; przełącznik jak każda inna warstwa (`controller.setLayerVisible`), bez nowych intencji. |
| Legenda | `views/legend.js` | Wiersz „Zasięg ognia” z `RANGE_KINDS`. |

**Dopasowanie bez `ref`:** istniejące scenariusze (np. `01-obrona-bialegostoku`) nie mają jeszcze `ref` w `equipment`. `matchItem` używa `ref`, a gdy go brak — nazwy: słowa kluczowe pozycji katalogu (nazwa bez nawiasów, słowa > 2 znaki, bez diakrytyków) muszą wystąpić w nazwie wpisu (zgodność przedrostkowa, więc „moździerze” ≈ „moździerz”); wygrywa pozycja z największą liczbą słów kluczowych. Ogólne wpisy („czołgi”, „drony rozpoznawcze”) nie dopasują się i nie dają pierścieni — to świadome (lepiej brak niż błędny zasięg). Docelowo scenariusze dostają `ref`, a fallback po nazwie wygasa. Zasięgi wroga biorą się z **szacunku gracza**, nigdy z prawdy sędziego.

## Pomijanie szczebli dowodzenia (T45)

Koszt rozkazu wydanego z pominięciem dowódcy pośredniego. Tryb: `scenario.commandRules.skipEchelon` = `off` | `soft` (domyślny) | `hard`.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/schema.js` | `SKIP_ECHELON_MODES`, `checkCommandRules(rules)` (lista błędów); używa go `tools/validate.js`. Opis pól: [SCHEMA.md](SCHEMA.md). |
| Logika | `domain/command.js` (czysta) | `skipEchelonMode(scenario)` (domyślnie soft), `skippedEchelons(units, unitId)` → `{count, skipped}` z `parent` (bezpośredni podwładny 0, kompania 1, pluton 2; sąsiedzi i `formation` 0), `assessSkip({scenario, units, channels?, channelId, priority})` → `{level: none/warn/block, count, skipped, text}`, `skipMessage`. Tryby są tam porównywane jako teksty (`domain/` nie importuje z `shared/`). |
| Klient | `core/messaging.js` + `views/messenger.js` | widok pokazuje nieblokujące ostrzeżenie pod polem tekstu (`renderWarn`); kontroler odmawia wysyłki przy `block` (hard, bez `urgent`). Brak nowych plastrów store i zależności między widokami. |
| Serwer | `server/store.js` (`sendMessage`) | to samo `assessSkip` (import z `public/js/domain/command.js`, jak `tools/` z `domain/geo.js`): `block` → 403 przy `POST /api/outbox`. Jedna reguła w jednym pliku. |
| Sędzia | [CLAUDE.md](../CLAUDE.md) | skutki fabularne i licznik pominięć w `umpire/log.md` (serwer nie czyta `umpire/`). |

## CCIR i cykl meldunków (T48)

Gracz definiuje 3–7 krytycznych potrzeb informacyjnych (PIR o przeciwniku, FFIR o własnych siłach); postacie meldują pilnie tylko to, co je spełnia, a resztę w meldunkach cyklicznych (SITREP, LOGSTAT). Wiadomości mają odwołanie `ccir` (id pozycji) i/lub `report`.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/ccir.js` (osobny plik, bo `shared/schema.js` ma jednego właściciela naraz) | `checkCcirItem`, `checkCcir` (plik `player/ccir.json`: ≤ 7 pozycji błąd, < 3 uwaga, id `PIR-N`/`FFIR-N` zgodne z `kind`, opcjonalna geometria), `checkReportCycle` (`scenario.reportCycle`), `checkMessageReport` (pola `ccir`, `report`). Pola `ccir` i `report` dopisane do `PLAYER_MESSAGE_FIELDS`. Używają go serwer, `tools/validate-ccir.js` (z `validate.js`) i testy. |
| Serwer | `server/store.js` + `server/app.js` | `GET/PUT /api/ccir` jak szkice gracza: zapis do `player/ccir.json` pod blokadą, walidacja `checkCcir`. Nie zależy od tury. Sędzia nie modyfikuje pliku. |
| Logika | `domain/ccir.js` (czysta; stałe lustrzane do `shared/`) | edycja listy (`addCcirItem`, `updateCcirItem`, `removeCcirItem`, `setCcirGeometry`, `cleanCcirItems`), `ccirOf`, `filterCcir` / `countCcir` (filtr „tylko CCIR”), `ccirTags` (znaczniki `PIR-2`, `SITREP`; wołane z `messageTags`), `groupReports` (jeden element na rodzaj meldunku i turę, używa go `buildTimeline`), `reportCycleText`. |
| Stan | `core/store.js` | `ccir` (zapisana lista) i `ccirEditor { open, draft, pick }` (kopia robocza i tryb wskazywania geometrii). Filtr „tylko CCIR” jest lokalny dla komunikatora. |
| Intencje | `core/ccir.js` (podkontroler jak `orders.js`) | `openCcirEditor`, `ccirAdd/Edit/Remove`, `ccirPickStart/Cancel`, `ccirSetGeometry`, `ccirSave` (jedno `set`); `fetchCcir` w `load` i `refresh` (brak API = pusta lista). |
| Widoki | `views/ccir.js` (edytor, osobny widok), `views/map/ccir.js` (nakładka geometrii i wskazywanie punktu / linii / rejonu), `views/messenger/thread.js` + `messenger.js` (znaczniki i przycisk filtra), `views/timeline.js` (zgrupowane znaczniki meldunków) | Brak importów między widokami; edytor i mapa komunikują się przez `store.ccirEditor.pick`. |

Geometria CCIR jest widoczna zawsze (zapisane pozycje) albo w edytorze (kopia robocza); osobnego przełącznika warstwy nie ma. Sędzia: reguły w [CLAUDE.md](../CLAUDE.md), format w [SCHEMA.md](SCHEMA.md).
