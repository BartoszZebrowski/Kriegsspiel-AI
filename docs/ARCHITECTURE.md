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

## Pozycje własnych sił z BFT (T49)

Gracz widzi ostatnią zameldowaną pozycję jednostki (jak w Blue Force Tracking), nie prawdę; w zagłuszeniu, ciszy radiowej i przy utracie łączności pozycja zamarza.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/schema.js` | `pos_time` w `PLAYER_FIELDS.units`; `checkPosTime(posTime, turnTime, turnMinutes)` → `{error}` (późniejszy niż tura) / `{warn}` (starszy niż okres tury) / `{}`. Używa go `tools/validate-checks.js` i `turn.mjs`. Opis pola: [SCHEMA.md](SCHEMA.md). |
| Logika | `domain/bft.js` (czysta) | `BFT_STALE_MIN` (30 min, jedno miejsce), `posAgeMin`, `isPosStale`, `posOpacity`, `bftStatus` → `{stale, ageMin, reportedAt, text}`; brak `pos_time` = czas tury. Bez nowych plastrów store. |
| Widoki | `views/map/index.js` (krycie symbolu i podpowiedź), `domain/cards.js` (wiersz „Ostatni raport BFT” w karcie) | Wyłącznie odczyt `pos_time` z tury; `track` animacji kończy się na `pos` BFT (liczy `turn.mjs`), więc `views/map/motion.js` bez zmian. |
| Sędzia | `tools/umpire/turn.mjs`, [CLAUDE.md](../CLAUDE.md) | Prawda pozycji tylko w `umpire/turns`. Widok gracza = prawda z `pos_time` = czas tury, chyba że `plan.player.units.<id>` podaje `{pos, pos_time}` (zamrożenie). `pos_time` nie jest dziedziczone z tury N. |

## Formularze meldunków i rozkazów (T50)

Szablony z polami (SPOTREP, LOGSTAT, FRAGO, zapotrzebowanie na ogień) obok wolnego tekstu. Wiadomość niesie czytelny `text` **oraz** strukturę `form: { kind, fields }` (w `player/outbox` od gracza, w `player/inbox` od postaci). Pola „gdzie”/„cel” wskazuje się na mapie istniejącym mechanizmem wskazywania geometrii z T48 (`ccirEditor.pick`), bez drugiej warstwy mapy.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/form.js` (czysty JS) | `FORM_KINDS` (id szablonów), limity, `checkFormShape(form)` → tekst błędu albo `null`: `kind` z listy, `fields` to obiekt, wartości to tekst / liczba / geometria (`checkCcirGeometry`). Osobny plik, bo `shared/schema.js` ma jednego właściciela naraz; w schemacie tylko `form` dopisane do `PLAYER_MESSAGE_FIELDS`. |
| Logika | `domain/forms.js` (czysta, jedno miejsce definicji szablonów) | `FORMS` (pola: id, etykieta PL, typ `text` / `textarea` / `select` / `geo`, wymagalność, opcje, kształt geometrii), `emptyForm`, `setFormField`, `missingFields`, `checkFormContent` (nieznane pola, opcje spoza listy, brak wymaganych), `formText` (czytelny tekst), `formRows` (wiersze tabelki), `textBeyondForm`. Id rodzajów lustrzane do `shared/form.js` (komentarz zamiast importu: `domain/` nie importuje z `shared/`). Serwer i walidator importują `domain/forms.js` jak `domain/command.js`. |
| Stan | szkic kanału w `store.drafts[kanał].form` | bez nowych plastrów store; wskazywanie to `ccirEditor.pick = { id, shape, target: "form", channel }`. |
| Intencje | `core/forms.js` (podkontroler jak `orders.js`) | `formSelect`, `formSetField`, `formClear`, `formPickStart`, `formSetGeometry`; korzysta z `setDraft` komunikatora. |
| Widoki | `views/messenger/form.js` (panel pól i tabelka `formTableHtml`, wszystko przez `escapeHtml`), `views/messenger.js` (menu „Szablon”, wysyłka), `views/messenger/thread.js` (tabelka w wątku), `views/map/ccir.js` (tylko rozgałęzienie: wynik wskazania z `target: "form"` idzie do `formSetGeometry`) | Brak importów między widokami; `thread.js` i panel dzielą tylko `views/messenger/form.js`. |
| Serwer | `server/store.js` (`POST /api/outbox`) | pole `form`: `checkFormShape` + `checkFormContent` (400 przy błędzie), zapis w wiadomości. Walidator scenariusza sprawdza `form` w `outbox` (błąd) i `inbox` (braki wymaganych = uwaga). |

Pola wartości: tekst lub liczba bez struktury albo geometria GeoJSON (`Point` / `LineString` / `Polygon`, `[długość, szerokość]`). Wysłany tekst = `formText` + opcjonalna dopiska gracza; wątek pokazuje tabelkę, a tekst tylko w części wykraczającej poza `formText`.

## Zgłoszenie ognia i jego status (T52)

Zgłoszenie to wiadomość `player/outbox` z `form.kind = "fire"` (szablon z T50, kanał wiadomości = środek wsparcia). Status zgłoszenia przychodzi od sędziego w wiadomości `player/inbox` z polem `fire: { request_id, status, time, rounds?, reason? }`. Pole **nigdy** nie niesie skutku ognia (skutek gracz poznaje z obserwacji i meldunków). Zgłoszenie bez odpowiedzi ma status „wysłane” (wyliczany, bez wiadomości).

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/fire.js` (osobny plik) | `FIRE_STATUSES` (`accepted`, `refused`, `done`), `checkMessageFire(m)`: `request_id` (tekst), `status`, `time` (ISO), `rounds` (liczba całkowita ≥ 0, tylko `done`), `reason` (tekst, wymagany przy `refused`); żadnych innych pól. `fire` dopisane do `PLAYER_MESSAGE_FIELDS`; `fire` tylko w inbox. |
| Logika | `domain/fires.js` (czysta) | model cyklu: `FIRE_STATUS` (`sent` → `accepted` / `refused` → `done`; `sent` → `done` dozwolone), `canTransition`, `fireTasks(messages)` → zadania ogniowe z wiadomości outbox (`form.kind = fire`) i odpowiedzi inbox (najpóźniejsze dozwolone przejście wygrywa), `fireAnchor` (punkt znacznika: punkt albo środek rejonu), `fireStatusText`, `fireLabel`. Bez DOM, bez importów spoza `domain/`. |
| Stan | `core/store.js` | tylko flaga warstwy `layers.fires`; zadania wyliczane z `messages` (bez nowego plastra). |
| Widoki | `views/map/fires.js` (nowy plik, osobna warstwa), `views/map/controls.js` (wiersz „Ogień” w panelu warstw) | znacznik w celu (punkt) albo obrys rejonu, etykieta z godziną i statusem; tekst przez `escapeHtml`; subskrypcja `messages` + `layers` + `turn`. Brak importów między widokami. |
| Walidator | `tools/validate-fire.js` (wołany z `validate.js`) | `fire` w inbox: `checkMessageFire`, `request_id` wskazuje zgłoszenie z outbox (brak = uwaga), `fire` w outbox = błąd. |
| Sędzia | [CLAUDE.md](../CLAUDE.md) | zasady rozstrzygania i format odpowiedzi; skutek tylko z obserwacji. |

## Nakładki od przełożonego (T51)

Wiadomość sędziego (`inbox`) może nieść `overlay: { id, name, features: [szkic…] }` — graficzną nakładkę rozkazu (granice, rubieże, osie, rejony). Elementy to **te same szkice** co w `player/notes` (`checkNote`), więc rysuje je ten sam kod znaków taktycznych (`domain/tactical.js`, `lib/tactical-layers.js`). Nakładka jest tylko do odczytu; gracz może ją skopiować do szkiców i dołączyć do rozkazu.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/overlay.js` (osobny plik, bo `shared/schema.js` ma jednego właściciela naraz) | `checkOverlay(overlay)` → tekst błędu albo `null`: `id` (`[\w-]{1,30}`), `name` (≤ 60), `features` (1–`OVERLAY_MAX_FEATURES`), każdy element przez `checkNote` (nieznany znak / rodzaj = błąd), id elementów unikalne. W `shared/schema.js` tylko `overlay` dopisane do `PLAYER_MESSAGE_FIELDS`. |
| Logika | `domain/overlays.js` (czysta) | `overlaysOf(messages)` → `{ id, name, time, from, channel, messageId, features }` z wiadomości przychodzących z `overlay`; **nowsza nakładka o tym samym `id` zastępuje starszą** (wg `time`, przy remisie tura), wynik od najnowszej. `overlayLayerKey(id)` (`ov:<id>`), `overlayNotes(overlay, existing, limit)` → kopie elementów jako szkice z nowymi, unikalnymi id (`MAX_NOTES` jako parametr, `domain/` nie importuje z `shared/`). |
| Stan | `core/store.js` | pochodna `overlays` (z `visibleMessages`, więc archiwum nie zdradza przyszłych nakładek); widoczność nakładki to `layers['ov:<id>']` (domyślnie wyłączona), bez nowego plastra. |
| Intencje | `core/overlays.js` (podkontroler jak `orders.js`) | `copyOverlayToNotes(id, { attach })`: kopie → `saveNotes`; z `attach` dodatkowo `attachIds` w szkicu aktywnego kanału (`setDraft`). Archiwum: odmowa. |
| Widoki | `views/map/overlays.js` (nowy plik, osobna warstwa; czyta `overlays` i `layers`), `views/map/controls.js` (sekcja „Nakładki od przełożonego” w panelu warstw: nazwa, DTG, włącz/wyłącz, „Do szkiców”, „Do rozkazu”) | Warstwa rysuje przez `buildGraphic` + `builtLayers` (przeliczanie po zoomie); brak importów z innych widoków. |
| Walidator | `tools/validate.js` | `overlay` w `inbox`: `checkOverlay` (błąd); w `outbox` pole jest błędem (tylko sędzia). |

## Wojska inżynieryjne (T27)

Zapory, przejścia i mosty jako obiekty ze stanem. Prawda (`umpire/turns`, pole `engineering`) ma pełny stan i pola sędziego; gracz dostaje w `player/turns` tylko listę z białej listy: własne obiekty z prawdy, zapory przeciwnika wyłącznie z rozpoznania.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/engineering.js` (osobny plik, bo `shared/schema.js` ma jednego właściciela naraz) | `ENGINEERING_KINDS` (`minefield`, `obstacle`, `lane`, `temp_bridge`, `bridge`) z geometrią każdego rodzaju, `WORK_STATES` (`planned` / `building` / `done`), `BRIDGE_STATES` (`intact` / `damaged` / `destroyed`), `checkEngineering(list, { player, turnTime })` → `{ errors, warnings }`. W `shared/schema.js` tylko `engineering` w `PLAYER_TURN_FIELDS` i lista pól w `PLAYER_FIELDS` (strażnik wycieku działa bez zmian w walidatorze). |
| Logika klienta | `domain/engineering.js` (czysta; stałe lustrzane do `shared/`) | `engineeringItems(turn)`, `engineeringLabel` („ZAPORA-1: 60%”), `engineeringStateText`, `engineeringTone`, `engineeringTip`; nowe kody SIDC saperów w `domain/sidc.js`. Bez DOM. |
| Stan | `core/store.js` | tylko flaga warstwy `layers.engineering`; obiekty to część `turn`, bez nowego plastra. |
| Widoki | `views/map/engineering.js` (nowy plik, osobna warstwa), `views/map/controls.js` (wiersz „Zapory i mosty” na końcu panelu warstw), `public/css/engineering.css` | Zapory rysują znaki z `domain/tactical.js` (pole minowe, linia zapór) przez `buildGraphic` + `builtLayers`; mosty i przejścia to znaczniki z etykietą i stanem. Własne i wrogie (rozpoznane) różnią kolor i kreskowanie; tekst przez `escapeHtml`; subskrypcja `turn` + `layers`. Brak importów z innych widoków. |
| Kalkulator | `tools/umpire/engineer.mjs` (czyste funkcje + CLI, deterministyczne) | czas pola minowego, przejścia, mostu składanego / pontonowego, zniszczenia mostu, postęp zadania. Nie zależy od klienta ani serwera. |
| Sędzia | `tools/umpire/engineering-merge.mjs` (wołany z `turn.mjs`), [CLAUDE.md](../CLAUDE.md) | dziedziczenie listy z tury N i łatki planu (`set` / `remove`); widok gracza = obiekty strony gracza z prawdy + wrogie z `plan.player.engineering`; stan mostu synchronizowany z `logistics.bridges` (zmiana routingu T15 / T17). |
| Walidator | `tools/validate.js` | `engineering` w `umpire/turns` (pełny stan, pola dodatkowe dozwolone) i w `player/turns` (biała lista, wrogie z `observed`). |

## Strefa sztabu: odprawa S2/S3/S4 i widoki komórek (T28.1)

Na starcie tury gracz dostaje krótką odprawę trzech stanowisk sztabu (`staff` w `player/turns`), a przełącznik „Sztab” na mapie daje gotowe zestawy warstw i paneli dla S2, S3, S4 i wsparcia ogniowego.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/staff.js` (osobny plik, bo `shared/schema.js` ma jednego właściciela naraz) | `STAFF_ROLES`, `STAFF_MAX_TEXT`, `checkStaff(staff, turnTime, turnMinutes)` → `{errors, warnings}`: ≤ 3 pozycje, role z listy i unikalne, `name`, `text` ≤ 300 znaków, `time` ISO (poza okresem tury = uwaga). W `shared/schema.js` tylko `staff` dopisane do `PLAYER_TURN_FIELDS`. Używają go `tools/validate.js` i `tools/umpire/turn.mjs` (`plan.player.staff`, nie dziedziczone). |
| Logika | `domain/staff.js` (czysta) | `staffCards(staff, channels, tz)` → karty `{role, badge, title, name, text, dtg, channel}` w kolejności S2/S3/S4; `staffChannelId` (kanał o id = rola, rezerwa: S2 → rozpoznanie, S4 → logistyka, S3 → brak); stan panelu `isStaffOpen`, `closeStaff`, `openStaff` (zamknięte tury + przywołane w archiwum). |
| Logika | `domain/staffviews.js` (czysta) | `STAFF_VIEWS` (S2, S3, S4, Ogień: warstwy i panel), `activateStaffView`, `restoreStaffView`, `toggleStaffView`: preset dotyka tylko wymienionych warstw, a przy pierwszym włączeniu zapamiętuje wartości gracza tych warstw i panelu (`staffView.saved`) do przywrócenia. |
| Stan | `core/store.js` | plastry `staffUi` (`closed`, `recalled`) i `staffView` (`active`, `saved`); pochodne `staff` (karty z `turn.staff` i `channels`) oraz `staffOpen`. |
| Intencje | `core/staff.js` (podkontroler jak `ccir.js`) | `closeStaffPanel`, `openStaffPanel`, `toggleStaffPanel`, `openStaffChannel(role)` (przez `openChannel`), `setStaffView(id\|null)` (jedno `set`). Zamknięte tury zapisuje przez `storage` pod kluczem `ks:<scenariusz>:staff-closed`. |
| Widoki | `views/staff.js` (panel „Odprawa sztabu” + ikona przy zegarze), `views/staffviews.js` (przełącznik S2/S3/S4/Ogień/Moje), `views/hotkeys.js` (Shift + 1…4, Shift + 0), `public/css/staff.css` | Brak importów między widokami; tekst przez `escapeHtml`. Panel jest pływającym oknem mapy (na telefonie na szerokość zakładki „Mapa”), działa w archiwum (odprawa oglądanej tury). |

Bieżąca tura otwiera panel sama, dopóki gracz jej nie zamknie; w archiwum panel pokazuje się tylko na żądanie. Presety nie zmieniają podkładów ani nakładek kafelkowych. Sędzia: procedura w [CLAUDE.md](../CLAUDE.md), format w [SCHEMA.md](SCHEMA.md).

## Starzenie się kontaktów (T16)

Czysta logika w `domain/contactage.js` (bez DOM): `contactAgeClass(sidc)` wybiera klasę wg SIDC (dron / pancerne i rozpoznanie / piechota, artyleria, OPL, REW / logistyka / inne) z progami „świeży” i „stary”; `contactFreshness(contact, turnTime)` zwraca `{ageMin, opacity, old, text}` (wiek z `ageMinutes` z `domain/format.js`, krycie liniowo 1 → 0,35, `text` „informacja sprzed X” od progu starego). `views/map/index.js` używa `opacity` dla symbolu i koła niepewności, a `text` dopisuje do podpowiedzi; `domain/cards.js` (`contactCard`) pokazuje ten sam napis. Widoki nie liczą progów same; BFT własnych jednostek (`domain/bft.js`) pozostaje osobny.

## Zmęczenie i morale (T28)

Wytrzymałość jest zasobem sędziego. Prawda (`umpire/turns`, jednostki) ma `stamina_min` (reszta wytrzymałości w minutach) i `morale` (0–1). Gracz dostaje w `player/turns` wyłącznie kategorię `fatigue` (`wypoczęta` / `zmęczona` / `wyczerpana`); liczby nie wychodzą poza `umpire/`, a stan ducha ludzie opisują słowami w meldunkach (`inbox`).

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/fatigue.js` (osobny plik, bo `shared/schema.js` ma jednego właściciela naraz) | `FATIGUE_LEVELS`, progi (`fatigueLevel(stamina_min)` → kategoria), `checkFatigue(unit)` (kategoria z listy), `checkUmpireFatigue(unit)` (`stamina_min` ≥ 0, `morale` 0–1). W `shared/schema.js` tylko `fatigue` dopisane do `PLAYER_FIELDS.units`; `stamina_min` i `morale` zostają poza białą listą, więc strażnik wycieku działa bez zmian. |
| Logika klienta | `domain/fatigue.js` (czysta; lista kategorii lustrzana do `shared/`) | `fatigueInfo(level)` → etykieta, ton (`ok` / `warn` / `bad`) i opis; `fatigueBlock(unit)` → HTML sekcji karty (escapeHtml). Bez DOM, bez importów z `core/` i `views/`. |
| Widok | `views/inspector.js` przez `domain/cards.js` (`unitCard` dokłada `fatigueBlock`), `public/css/inspector.css` | Wskaźnik „Zmęczenie” z kolorem w karcie jednostki własnej; sąsiedzi i kontakty go nie mają. Bez nowego stanu w store. |
| Sędzia | `tools/umpire/turn.mjs`, [CLAUDE.md](../CLAUDE.md) | `fatigue` w widoku gracza wyliczane z `stamina_min` prawdy (`fatigueLevel`), z możliwością nadpisania łatką `plan.player.units.<id>.fatigue`; `stamina_min` i `morale` dziedziczone w prawdzie z tury N. Reguły zużycia, regeneracji i prób morale: CLAUDE.md. |
| Walidator | `tools/validate-checks.js` | `fatigue` w `player/turns` (kategoria z listy); `stamina_min` / `morale` w `umpire/turns` (zakresy); w plikach gracza oba pola są błędem (biała lista). |

## Pomiar po drogach (T15)

Miarka z T12 dostaje tryb „Po drogach”: trasa z routera OSRM przez serwer gry, czas marszu wg typu jednostki i ostrzeżenia o mostach.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Logika | `domain/roadmarch.js` (czysta, bez DOM i sieci) | `MARCH_PROFILES` (kołowa / gąsienicowa / piesza: prędkości dzień i noc, masa sprzętu), `profileFromSidc`, `isNightAt(time, tz)`, `marchMinutesFor(km, profile, night)`, `estimateRoute(coords)` (prosta × 1,3, `estimate: true`), `bridgesOnRoute(path, bridges, mass)` → ostrzeżenia, `routeSummary(...)`. Masy: tabela w module (katalog `data/equipment.json` nie ma mas). |
| Serwer | `server/route.js` (bez zależności) + `POST /api/route` w `server/app.js` | `createRouter({ fetchImpl, timeoutMs, ttlMs, max, disabled })`: walidacja punktów (2–25, zakres, 5 miejsc po przecinku), zapytanie GET do OSRM `driving` z limitem czasu, pamięć podręczna (klucz = punkty), odpowiedź `{ coords, km, source: 'osrm' }`. Do routera idą wyłącznie współrzędne. Błąd routera → 502, wyłączony (`KS_ROUTER=off`) → 503; klient wtedy liczy szacunek. `createApp(dir, { router })` pozwala podstawić atrapę (smoke, testy). Serwer nadal nie czyta `umpire/`. |
| API / kontroler | `core/api.js` (`api.route(coords)`), `core/controller.js` (`measureRoute`) | Wywołanie sieci tylko tu; widok dostaje wynik albo wyjątek. Bez nowego plastra store. |
| Widok | `views/draw/roadmeasure.js` (nowy), podpięty z `views/draw/measure.js`; styl `public/css/draw.css` | Własny panel nad miarką: przełącznik „Po drogach”, wybór typu i dzień/noc, wynik, ostrzeżenia o mostach (z `turn.logistics.bridges`); linia drogowa w osobnej warstwie Leaflet. Numer żądania odrzuca spóźnione odpowiedzi; każdy błąd → szacunek z oznaczeniem. Tekst przez `escapeHtml`. |

Przepływ: kliknięcie punktu → `roadmeasure.update(points)` → `controller.measureRoute` → `POST /api/route` → render. Przy błędzie render z `estimateRoute`.

## Utrata łączności (T19)

Stan łączności jednostki to wiedza sztabu: pole `comms: {status, last_contact}` w `player/turns` (brak = `ok`). Prawda (`comms_true: {status, since, cause}`) jest tylko w `umpire/turns`.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/comms.js` (osobny plik, jak `fatigue.js`) | `COMMS_STATUSES`, `checkComms(comms, turnTime)` → tekst błędu lub null (status z listy, `last_contact` ISO, wymagany przy `degraded`/`lost`, nie późniejszy niż tura), `checkUmpireComms(unit)`. W `shared/schema.js` tylko `comms` dopisane do `PLAYER_FIELDS.units`; `comms_true` poza białą listą, więc strażnik wycieku działa bez zmian. |
| Logika klienta | `domain/comms.js` (czysta; lista statusów lustrzana do `shared/`) | `commsInfo(unit, turnTime, tz)` → `{status, lost, degraded, ageMin, lastContact, text, tone}`; brak pola = `ok` z pustym `text`. `commsWarning(unit, turnTime, tz)` – tekst ostrzeżenia komunikatora, `channelComms`, `commsCardText`. Bez DOM, bez nowego stanu w store. |
| Widoki | `views/map/index.js` (znacznik przy symbolu i podpowiedź), `domain/cards.js` (wiersz „Łączność”), `views/messenger.js` + `views/messenger/warn.js` (znacznik kanału, ostrzeżenie), `public/css/*.css` | Wyłącznie odczyt `comms` z tury; BFT (`domain/bft.js`) pozostaje osobny. Wysyłka nie jest blokowana (decyzja T25: bez statusów doręczenia). |
| Sędzia | `tools/umpire/turn.mjs`, [CLAUDE.md](../CLAUDE.md) | `comms` w widoku gracza z `comms_true` (`since` → `last_contact`) albo łatką `plan.player.units.<id>.comms`; nie dziedziczone z tury N. `comms_true` nie trafia do pliku gracza. Zasady utraty i odzyskania łączności: CLAUDE.md. |
| Walidator | `tools/validate-checks.js` | `comms` w `player/turns` przez `checkComms`; `comms_true` w `umpire/turns` przez `checkUmpireComms`. |

## Pogoda i cykl dobowy (T30)

Pogoda jest jawna dla gracza (prognoza i obserwacje), więc `weather` jest w białej liście `player/turns`; sędzia zapisuje ten sam obiekt w `umpire/turns` (dziedziczony z tury N, zmieniany planem). Dzień i noc nie są polem pliku: liczy je klient z czasu tury i położenia scenariusza.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/weather.js` (osobny plik, jak `fatigue.js`) | Listy kategorii (`WEATHER_PRECIP`, `WEATHER_FOG`, `WEATHER_WIND`), `checkWeather(weather)` → tekst błędu lub null. W `shared/schema.js` tylko `weather` dopisane do `PLAYER_TURN_FIELDS`. |
| Logika dnia i nocy | `domain/daylight.js` (nowy, czysty; algorytm NOAA, bez zależności) | `solarElevation(ms, lat, lon)`, `sunTimes(ms, lat, lon)` → `{sunrise, sunset}`, `dayPhase(iso, lat, lon)` → `day` / `twilight` / `night`, `isNightPhase`. Jedyne miejsce reguł zmierzchu (progi stopni). |
| Logika pogody | `domain/weather.js` (nowy, czysty; listy kategorii lustrzane do `shared/`) | `weatherInfo(weather)` → ikona, etykieta, ton, opis; `droneFlightVerdict(weather)` (wiatr / opad / mgła → lot możliwy lub powód); `groundSpeedFactor(weather)` (rozmoknięty teren); `visibilityNote`. Bez DOM. |
| Marsz | `domain/roadmarch.js` | `isNightAt(iso, tz, pos?)` – z położeniem liczy wg słońca (inaczej stare progi godzinowe); `marchMinutesFor(km, profile, night, weather?)` mnoży czas przez `groundSpeedFactor`. Zależność tylko `domain/` → `domain/`. |
| Widok | `views/weather.js` (nowy), podpięty w `main.js`; `views/timeline.js` i `domain/timeline.js` (znacznik nocy na węzłach), `domain/cards.js` (karta środka rozpoznania: werdykt lotu) | Wskaźnik pogody i dnia/nocy w zegarze (`#clk-weather`), klasa `body.is-night` (przyciemnienie kafli mapy w CSS), podpowiedź z opisem. Dane tylko ze store (`turn.weather`, `scenario.map.center`, `scenario.timezone`); bez nowego stanu i bez importów innych widoków. |
| Sędzia | `tools/umpire/turn.mjs`, [CLAUDE.md](../CLAUDE.md) | `plan.weather` (obiekt lub `null`), dziedziczenie z tury N, `checkWeather` jako ostrzeżenie. Skutki (drony, obserwacja, przejezdność, zima): CLAUDE.md. |
| Walidator | `tools/validate-checks.js` | `weather` w obu rodzajach tur przez `checkWeather`; poza białą listą `weather` nie jest błędem pola. |

## Tryb po bitwie (T29)

Jedyny świadomy wyjątek od zasady „serwer nie czyta `umpire/`”: po `status: "finished"` w `scenario.json` serwer udostępnia prawdę (`umpire/turns/NNN.json`) i `umpire/aar.md`. Przy każdym innym statusie jest to technicznie niemożliwe.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Serwer (strażnik) | `server/truth.js` (nowy) | Jedyny plik serwera, który zna ścieżkę `umpire/`. `createTruth(dir)` zwraca `readTruthTurn(n)` i `readAar()`; obie przechodzą przez prywatną `openUmpire()`, która za każdym razem (bez pamięci podręcznej) czyta `scenario.json` i przy `status !== "finished"` rzuca `StoreError(403)`. `store.js` nadal nie ma odczytu `umpire/`. Test pilnuje, że łańcuch `umpire` występuje w `server/` tylko w `truth.js`. |
| API | `server/app.js` | `GET /api/truth/:n` (numer przez `parseTurnNumber`) i `GET /api/aar`; poza tym bez zmian (zakaz `..`, brak statycznego serwowania `umpire/`). |
| Logika | `domain/afterbattle.js` (czysta) | `isFinished(scenario)`, `enemyTruth(truth, ownSide)` → jednostki strony przeciwnej z prawdy, `truthLabel(unit)`. Dokument AAR to `briefingDocument` (spis treści z `##`) — bez drugiego parsera. |
| Stan | `core/store.js` | `truth: { turn, data }` (pobrana prawda oglądanej tury), `aar: { open, text, error }`, warstwa `layers.truth` (domyślnie wyłączona), pochodna `finished`. |
| Intencje | `core/afterbattle.js` (podkontroler) + `core/api.js` (`truth`, `aar`) | `setTruthVisible(on)` (tylko gdy `finished`; pobiera prawdę oglądanej tury), `syncTruth()` (po zmianie tury, wołane z `applyView`), `openAar`, `closeAar`. Błąd 403/sieci → `notify`. |
| Widoki | `views/map/truth.js` (nowa warstwa Leaflet: symbole przeciwnika na prawdziwych pozycjach, przerywany pierścień), `views/aar.js` (pełnoekranowy dokument jak odprawa, ten sam CSS `br-*`, osobny `#aar`), `views/map/controls.js` (wiersz „Prawda” w Warstwach, nieaktywny do końca bitwy), `views/timeline.js` (przycisk „Po bitwie” otwiera AAR), `views/messenger.js` (po bitwie komunikator tylko do podglądu) | Brak importów między widokami; tekst przez `escapeHtml`. |
| Walidator | `tools/validate.js` | `status` z listy (`SCENARIO_STATUSES` w `shared/schema.js`), uwaga dla `finished` bez `aar.md` (już istnieje). |

Strażnik jest sprawdzany także odwrotnie: `status: "active"` (lub brak pola) daje 403 dla `/api/truth/*` i `/api/aar`, a ścieżki z `..` nigdy nie dochodzą do dysku. Przypadek graniczny: sędzia zmienia status na `finished` dopiero po zapisaniu `aar.md` (CLAUDE.md).

## AAR kampanii i pełny tryb po bitwie (T32)

Rozszerzenie T29 bez nowego dostępu do `umpire/`: statystyki liczy klient z prawdy pobieranej przez ten sam strażnik (`GET /api/truth/:n` przez `server/truth.js`), więc przy `status` innym niż `finished` nie ma ani prawdy, ani statystyk (403 → komunikat). Suwak czasu to istniejąca oś tur (T12.7) razem z warstwami; warstwy „wiedza gracza” (`contacts`), „Prawda” (`truth`) i „notatki” (`notes`) są niezależnymi przełącznikami, więc można je nakładać.

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Logika | `domain/aarstats.js` (nowy, czysty) | `battleDay(iso, startIso, tz)` → numer dnia (D+n); `summarizeLosses(turns, {start, timezone, ownSide})` → straty personelu i sprzętu oraz zużycie amunicji (spadek `supply.ammo`, DOS) po stronach i dniach (liczone po jednostkach liści hierarchii, żeby nie liczyć dwa razy batalionu i kompanii); `statsTableHtml` jest w widoku, nie tu. |
| Logika | `domain/afterbattle.js` | `matchContactsToTruth(contacts, truthUnits)` → pary kontakt–prawda (zachłanne najbliższe, jeden do jednego, próg odległości) do rysowania przesunięcia. |
| Intencje | `core/afterbattle.js` | `openAar()` dodatkowo pobiera wszystkie tury prawdy (`api.truth`) i zapisuje `aar.stats`; błąd jednej tury nie blokuje dokumentu. `store.aar` ma pole `stats`. |
| Widoki | `views/map/truth.js` | Linia przerywana od zameldowanej pozycji kontaktu do prawdziwej (z odległością w podpowiedzi), gdy włączone są obie warstwy. `views/aar.js` dopisuje sekcję „Statystyki końcowe” (tabele dni i kategorii) pod dokumentem; tekst przez `escapeHtml`. |
| Walidator | `tools/validate-realism.js`, `tools/validate.js` | `finished` bez `aar.md` jest błędem; `finished` wymaga ciągłości tur sędziego (`umpire/turns` 000…N, zgodnie z turami gracza). |

## Karta tury i przejście dni (T30 pkt 4, T31)

Dwie części. **Karta tury** to lekki widok w inspektorze (DTG, dzień kampanii, pora doby, wschód i zachód słońca, pogoda i prognoza). **Przejście dni** wprowadza turę o zmiennej długości (noc), dni kampanii i ich oznaczenia w UI. Czas tury przestaje być wyliczany z `start + N × turnMinutes`: źródłem prawdy o czasie jest `time` w pliku tury, a długość okresu, który tura otwiera, to opcjonalne `duration_min` (brak = `turnMinutes`).

| Część | Miejsce | Odpowiedzialność |
|---|---|---|
| Schemat | `shared/campaign.js` (nowy, jak `fatigue.js`; w `shared/schema.js` tylko `duration_min` dopisane do `PLAYER_TURN_FIELDS`) | `turnDurationMin(turn, scenario)` (`duration_min` albo `turnMinutes`), `expectedNextMs(turn, scenario)` (ms), `checkDuration(v)`, `checkPhases(phases, scenario)` (`phases`: `[{id, start, title?}]`, rosnące, `id` unikalne, pierwsza faza w czasie startu lub po nim). `phases` leży w `scenario.json` (jawne dla gracza, bez pól sędziego). |
| Logika klienta | `domain/campaign.js` (nowy, czysty; lustrzane drobne stałe, bez importów spoza `domain/`) | `buildSchedule(scenario, entries)` → oś `[{turn, time, ms, offsetMin, durationMin}]` (z `GET /api/scenario`, uzupełniona o przyszłe tury `turnMinutes`), `dayOf(iso, scenario)` → `{id: 'D+1', index, title}` albo `null` (bez `phases` brak dni), `dayStarts(scenario, schedule)`, `isNewDay(prevIso, iso, scenario)`. Jedyne miejsce reguł dni; widoki nie liczą sami. |
| Logika karty | `domain/turncard.js` (nowy, czysty) | `turnCardHtml({turn, scenario, durationMin})` → HTML (`escapeHtml`): DTG, `D+x`, czas trwania, pora doby (`dayPhase`), wschód/zachód (`sunTimes`), blok pogody z istniejącego, dotąd nieużywanego `weatherBlockHtml` (`domain/weather.js`). Bez DOM. |
| Serwer | `server/store.js` (`listSchedule()`), `server/app.js` (`GET /api/scenario` dodaje `schedule: [{turn, time, duration_min?}]`) | Serwer czyta wyłącznie `player/turns` (jak dotąd); nic z `umpire/`. Powód: oś czasu potrzebuje czasów przeszłych tur bez pobierania każdej. |
| Stan / intencje | `core/store.js` (`schedule`), `core/selection.js` (`showTurnCard`: zaznaczenie specjalne `{id: '@turn', kind: 'turn'}`), `core/controller.js` | `schedule` ustawiane razem ze scenariuszem i przy odświeżaniu. `applyView` nie kasuje zaznaczenia `kind: 'turn'`. Powiadomienie „nowy dzień bojowy” (`notify`) przy awansie tury na początek nowego dnia (`isNewDay`). Bez nowego plastra stanu na kartę. |
| Widoki | `views/inspector.js` (gałąź `kind: 'turn'`), `views/topbar.js` (klik w środek zegara → `controller.showTurnCard()`, „D+x” obok numeru tury, czas tury z `durationMin`), `views/timeline.js` + `domain/timeline.js` (pozycje węzłów z osi czasu zamiast `i × turnMinutes`, linie podziału dni z etykietą), `views/messenger/thread.js` (czas doręczenia z osi), `public/css/*.css` | Brak importów między widokami; dane tylko ze store i kontrolera. `buildTimeline` przyjmuje opcjonalne `offsets` (minuty od startu) i `days`; bez nich zachowanie jak dotąd (zgodność testów). |
| Sędzia | `tools/umpire/turn.mjs`, nowy `tools/umpire/night.mjs` (czysta regeneracja nocna), `turn-merge.mjs` | Czas nowej tury = czas tury N + `duration_min` tury N (albo `turnMinutes`); `plan.time` nadal ma pierwszeństwo. `plan.duration_min` ustawia długość okresu otwieranego przez nową turę. `plan.night` (tryb nocny): regeneracja `stamina_min` jednostek (z wyjątkami `exclude`) proporcjonalnie do rozstrzyganego okresu; DOS i konwoje nadal planem. Okno „czas przed turą” w `checkPosTime`/`checkStaff` = długość poprzedniego okresu. |
| Walidator | `tools/validate-checks.js`, `tools/validate.js` | Ciągłość: `time` tury N+1 = `time` tury N + (`duration_min` ?? `turnMinutes`) (tura 0 = `start`); `duration_min` > 0; `phases` przez `checkPhases`. |

Zależności: `shared/` → nic; `domain/campaign.js` ← `domain/timeline.js`? Nie: `timeline` dostaje gotowe `offsets` jako parametr (słabe sprzężenie), a `core/` i `views/` wołają `domain/campaign.js` osobno. Pliki mieszczą się w ≤ 300 linii.
