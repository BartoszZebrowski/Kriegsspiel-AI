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
    map/{index,controls,basemaps,lines,hierarchy,motion,ewzones,logistics}
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
