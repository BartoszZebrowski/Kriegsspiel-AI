# Narzędzia sędziego

Skrypty w `tools/umpire/` pomagają sędziemu (Claude) rozstrzygać tury bez „sztywnych bloków”. Nie są częścią aplikacji ani serwera i nie czytają niczego poza plikiem tury podanym w CLI.

## Rozstawianie pododdziałów (`deploy.mjs`)

Zamiast przesuwać kompanię razem z plutonami jako sztywny rząd (stały odstęp, jedna linia), sędzia woła `deploy`. Układ zależy od **zadania** (formacja), azymutu, szerokości odcinka, liczby i rodzaju elementów oraz ziarna. Nie ma jednego kształtu: ten sam trzypluton może stanąć w linii o nierównych odstępach, jako „dwa i odwód” za lewym, środkiem albo prawym skrzydłem, w rzucie skośnym, w nieregularnym skupisku albo w kolumnie.

### API

```js
import { deploy, deployTree } from '../tools/umpire/deploy.mjs';

const pos = deploy({
  center: [22.877, 54.285],   // [lon, lat] środka oddziału
  formation: 'obrona',        // obrona | natarcie | marsz | wyczekujace | artyleria | obserwacja (+ aliasy)
  facing: 340,                // azymut frontu / kierunku działania (0 = N, 90 = E)
  frontage_m: 1800,           // opcjonalnie; domyślnie losowo w przedziale dla szczebla
  depth_m: 700,               // opcjonalnie: głębokość odwodu
  forward: 2,                 // opcjonalnie: ile elementów w pierwszym rzucie
  variant: 'dwa-i-odwod',     // opcjonalnie: w-linii | dwa-i-odwod | szyk | rzut-skosny
  route: [[lon, lat], …],     // marsz: trasa (łamana, w kierunku jazdy)
  children: [{ id, sidc, role? }],   // role: forward | depth | support | hq
  seed: '1bzmot-2k-t5',       // ziarno: ten sam wynik przy tych samych danych
});
// pos = { '1bzmot-2k-1p': [lon, lat], … }
// pos._hq    — proponowane miejsce dowództwa przełożonego (własność niewyliczalna)
// pos._meta  — wybrany wariant, szerokość frontu, kto w pierwszym rzucie, faktyczny azymut
```

`deployTree(units, rootId, plan, { seedBase })` rozstawia rekurencyjnie batalion → kompanie → plutony. `plan` to mapa `id → { formation, facing, frontage_m, depth_m, forward, variant, center, route, seed, roles, parentAtHq }`; wpis `'*'` to wartości domyślne. Jednostka bez wpisu dziedziczy azymut, a formację marszu, natarcia i rejonu wyczekiwania po przełożonym (inaczej bierze obronę). Kompanie pierwszego rzutu dostają pas równy ok. 0,9 × (front batalionu / liczba kompanii w pierwszym rzucie). Wynik: `{ id: [lon, lat] }` dla wszystkich potomków (oraz roota, jeśli plan podaje `center`).

Rozpoznawanie ról: jawne `role`, inaczej z SIDC. Znaki 5–10 `UCF*` (artyleria, moździerze), `UCD*` (OPL) i `US*` (zaopatrzenie) to `support`, reszta idzie do pierwszego rzutu. Czołgi (`UCAT`) chętniej zostają odwodem. Szczebel oddziału (skala odległości) wynika z wielkości podwładnych (znak 12 SIDC: D → kompania, E → batalion, F → brygada) i można go wymusić `level`.

### Formacje (wartości przybliżone, praktyka małych pododdziałów PL/NATO)

| Formacja | Układ i parametry | Uzasadnienie |
|---|---|---|
| `obrona` | Front kompanii 1500–2500 m, batalionu 4000–6000 m, brygady 10–15 km. Odcinek ≤ 2200 m (kompania) / 5500 m (batalion): **dwa w pierwszym rzucie i jeden w głębi** (500–800 m za linią, ×1,6 dla batalionu), a odwód stoi za lewym, środkiem albo prawym elementem. Odcinek szerszy albo `forward = n`: **wszyscy w linii**. Pasy elementów mają nierówną szerokość (0,5–1,5 średniej), wysunięcie ±230 m niezależnie dla każdego (to „teren”). Wsparcie (moździerze, KW) 800–1500 m za linią, dowództwo 300–500 m. | Pluton broni ok. 300–700 m frontu, kompania zwykle 1–2,5 km; przy szerokim odcinku nie ma kim robić odwodu. Moździerze 81/120 mm stoją za linią, by sięgnąć przedpola. |
| `natarcie` | Front kompanii ~1000 m, batalionu ~3000 m. Wariant z ziarna: **dwa i odwód** (tył 300–500 m, za lewym/środkiem/prawym), **rzut skośny** (elementy schodkiem co 250–450 m w lewo lub prawo) albo **szyk** (wszyscy obok siebie). Wsparcie 600–1000 m z tyłu, dowództwo 200–300 m. | Kompania atakuje szerzej niż broni się wąsko, ale ma mniejsze luki. Rzut skośny zabezpiecza skrzydło, a odwód za jednym plutonem wzmacnia kierunek główny. |
| `marsz` | Kolumna wzdłuż `route` albo azymutu. Rozstaw plutonów 150–300 m, kompanii 1–2 km (±12%), kolejność jak w `children`, pierwszy na czele. Środek `center` = środek kolumny. | Odstępy w kolumnie zmniejszają straty od ognia pośredniego i lotnictwa; pododdziały idą jedno za drugim po drodze. |
| `wyczekujace` | Nieregularne skupisko w promieniu 400–700 m (kompania), ok. 1,5 km (batalion), minimalny odstęp 150 m (batalion 350 m). | Rejon wyczekiwania służy rozśrodkowaniu i maskowaniu, a nie ładnemu ustawieniu; wolno je dopasować do lasu (`preferCover`). |
| `artyleria` | Stanowiska ogniowe co 300–600 m, nieregularne, rozrzut w głębi ±220 m, układ zasadniczo w poprzek azymutu, nigdy na jednej prostej. Dowództwo 250–400 m z tyłu. | Rozrzut utrudnia kontrbaterię i ogranicza skutki jednego uderzenia; ustawienie w poprzek azymutu daje sektor ognia. |
| `obserwacja` | Posterunki co 800–2500 m wzdłuż linii prostopadłej do azymutu, wysunięcie ±250 m. | Rozpoznanie i ubezpieczenie obserwuje szeroki front, a nie skupisko. |

Każdy układ ma losowe odchylenie orientacji ±10° i drobny rozrzut odległości (±10–15%). Zachowanie jest deterministyczne dla tego samego `seed`, więc **zmieniaj ziarno wraz z turą** (np. `<id>-t5`), żeby układ nie zamarzał. Aliasy formacji: `defense`, `attack`, `march`, `kolumna`, `rejon`, `recon`, `ubezpieczenie`, `ogniowe` i inne (patrz `ALIASES` w kodzie).

### Wskazówki dla sędziego

- Dobierz formację do **zadania** jednostki z rozkazu i `enemy-plan.md`, a nie do jej poprzedniego układu. Kompania po marszu w rejon wyczekiwania stoi w skupisku, nie w linii.
- Dla każdej kompanii podaj inny `seed` i, gdy sytuacja tego wymaga, własny `frontage_m` i `variant`. Teren decyduje: przy jeziorze po jednej stronie zawęź front i podaj `forward: 2`.
- Rozstawienie poprawiaj terenem: `--terrain` (woda) i `--cover` (las), patrz niżej.
- Nie zmienia to pozycji gracza w sposób zdradzający prawdę: wynik zapisujesz do `umpire/turns/`, a do `player/turns/` kopiujesz tylko pola dozwolone przez schemat.

### Przykład w skrypcie rozstrzygania tury

```js
import { readFile, writeFile } from 'node:fs/promises';
import { deploy, deployTree } from '../tools/umpire/deploy.mjs';
import { findWater, nudgeOutOfWater } from '../tools/umpire/terrain.mjs';

const turn = JSON.parse(await readFile('scenarios/<nazwa>/umpire/turns/005.json', 'utf8'));
const N = turn.turn;

// batalion w obronie na NW, 2 kompanie w pierwszym rzucie, trzecia w odwodzie
const plan = {
  '1bzmot': { formation: 'obrona', facing: 330, frontage_m: 5000, center: [22.86, 54.27], seed: `1bzmot-t${N}`,
              roles: { '1bzmot-3k': 'depth', '1bzmot-1k': 'forward', '1bzmot-2k': 'forward' } },
  '1bzmot-1k': { formation: 'obrona', frontage_m: 2400, forward: 3, seed: `1k-t${N}` },  // szeroki odcinek, trzy w linii
  '1bzmot-3k': { formation: 'wyczekujace', seed: `3k-t${N}` },                              // odwód w lesie
};
let pos = deployTree(turn.units, '1bzmot', plan);

const water = await findWater([22.78, 54.20, 22.98, 54.33]);        // bbox: [minLon, minLat, maxLon, maxLat]
pos = await nudgeOutOfWater(pos, null, { polygons: water });

for (const u of turn.units) if (pos[u.id]) u.pos = pos[u.id];
await writeFile('scenarios/<nazwa>/umpire/turns/005.json', `${JSON.stringify(turn, null, 2)}\n`);
```

Pojedynczą kompanię rozstawia `deploy({ center, formation, facing, children, seed })`, a pozycję dowództwa daje `pos._hq`.

### CLI

```
node tools/umpire/deploy-cli.mjs <turn.json> --unit 1bzmot-2k --formation obrona --facing 340 \
  [--frontage 1800] [--depth 700] [--forward 2] [--variant dwa-i-odwod] [--center lon,lat] \
  [--route "lon,lat;lon,lat"] [--seed x] [--plan plan.json] [--terrain] [--cover 400] [--write]
```

Bez `--write` tylko drukuje nowe pozycje (id, lon/lat, przesunięcie w metrach). Z `--write` zmienia **wyłącznie** `pos` jednostki (gdy podano `--center`) i jej potomków, a plik zapisuje jako JSON z wcięciem 2 spacje i końcowym newline. `--plan` wczytuje plan per jednostka (jak w `deployTree`); flagi CLI nadpisują wpis dla `--unit`. Domyślne ziarno to `<unit>-t<tura>`.

Uwaga: CLI zmienia plik, który wskażesz. Przy grze w toku pracuj na nowej turze (`umpire/turns/(N+1).json`), a pozycje w `player/turns/` przepisz osobno zgodnie z procedurą „koniec tury”.

## Rozstawianie na mapie (ręcznie, ze zrzutu)

Algorytm `deploy.mjs` nie widzi terenu, więc sędzia traktuje go jako **punkt wyjścia**. Właściwe rozstawienie robi tak, jak dowódca kompanii czytający mapę: ogląda zrzut terenu i wskazuje pozycje pikselami. Dwa narzędzia: `terrain-view.mjs` (zrzut) i `pick.mjs` (piksele → `[lon, lat]` w pliku tury).

### Procedura

1. **Zrzut okolicy** kompanii/batalionu z kierunkiem zagrożenia:
   ```
   npm run terrain-view -- --turn scenarios/<nazwa>/umpire/turns/005.json --unit 1bzmot-2k --zoom 14 \
     --hillshade --show own,enemy --facing 330 --out <katalog-tymczasowy>/v.png
   ```
   Zrzut i `v.png.json` zapisuj **poza** `scenarios/` (np. katalog tymczasowy). Zoom 13 (~11 m/px) pokazuje cały batalion, 14–15 (5,6–2,8 m/px) kompanię i pluton.
2. **Obejrzyj PNG** (Read) i zdecyduj o pozycjach według terenu: wzniesienia i grzbiety (izohipsy, hillshade), skraje lasów, sektory ognia i przedpole, przeszkody (jeziora, rzeki, bagna), osłona, drogi dowozu. Unikaj wody i otwartego terenu bez osłony dla stanowisk. Odczytaj piksele z siatki (podpisy co 100 px, linie co 50 px).
3. **Zapisz pozycje do tury N+1** (`umpire/turns/(N+1).json`; nie do tury, która już jest w grze):
   ```
   npm run pick -- --meta <katalog-tymczasowy>/v.png.json --turn scenarios/<nazwa>/umpire/turns/006.json \
     --set "1bzmot-2k-1p=412,236" --set "1bzmot-2k-2p=530,198" --set "1bzmot-2k-3p=470,330" --check-water --write
   ```
   Bez `--write` tylko drukuje wyniki do przeglądu. `--track "id=x,y;x,y;…"` zapisuje `track` (ostatni punkt = `pos` jednostki), np. dla ruchu po drodze.
4. **Zweryfikuj**: wyrenderuj zrzut z nowej tury (te same `--unit`/`--zoom`, `--highlight` na rozstawionych plutonach) i sprawdź, czy ułożenie ma sens (odstępy, osłona, nic w wodzie).
5. **Widok gracza:** pozycje jednostek własnych przepisz do `player/turns/(N+1).json` zgodnie z procedurą „koniec tury” w CLAUDE.md (bez pól sędziego; `track` dla ruchu).

### `terrain-view.mjs`

```
node tools/umpire/terrain-view.mjs --turn <turn.json> [--center lon,lat | --unit <id> | --bbox minLon,minLat,maxLon,maxLat]
  [--zoom 13] [--size 1200x900] [--base topo|osm|satellite|dark] [--hillshade]
  [--show own,enemy,contacts,neighbors] [--contacts <plik tury gracza>] [--highlight id,id]
  [--facing 330] [--grid 50] [--timeout 20000] --out <plik.png>
```

- Podkład domyślnie OpenTopoMap (teren, lasy, izohipsy); `--hillshade` dokłada cieniowanie Esri; `satellite` = Esri World Imagery. Wymaga internetu (kafelki), Chrome (`CHROME_PATH` albo typowe ścieżki) i działa bez dotykania portu 8080 (własny serwer na losowym porcie).
- Bez `--center`/`--unit`/`--bbox` widok obejmuje wszystkie pokazywane jednostki. `--unit` centruje i wyróżnia jednostkę (żółta poświata). Domyślnie `--show own,enemy,contacts,neighbors` (z pliku sędziego widać prawdę o wrogu, więc zrzutów nie pokazuj graczowi).
- Nakładki: siatka pikseli (0,0 = lewy górny róg; linie co `--grid`, podpisy co 100 px na wszystkich czterech brzegach), skala, północ, strzałka frontu `--facing` (azymut) ze środka widoku, symbole NATO z id, kontakty na czerwono z przerywanym kręgiem niepewności.
- Sidecar `<out>.json`: `center`, `zoom`, `size`, `crs`, `pixelOrigin`, `bounds`, `tileSize`, `mpp`, liczba kafelków i brakujące, lista jednostek z pikselami. Środek jest dosuwany tak, by początek widoku leżał na całkowitym pikselu świata (stąd `center` może różnić się o ułamek piksela od `--center`).
- Czeka na komplet kafelków (limit `--timeout`, jeden ponowny strzał dla kafelka z błędem); przy braku kafelków kończy normalnie i raportuje je w konsoli i w sidecarze.

### `pick.mjs`

Funkcje (import): `pixelToLonLat(meta, x, y)`, `lonLatToPixel(meta, lon, lat)`, `project`/`unproject`, `snapCenter`, `fitZoom`, `applyPicks`. `meta` to zawartość sidecara (wystarczą `center`, `zoom`, `size`, `tileSize`). Pozycje zapisuje z dokładnością 6 miejsc (~0,1 m). `--check-water` używa `terrain.mjs` (Overpass z cache) i ostrzega o punktach w wodzie.

## Kontrola terenu (`terrain.mjs`)

Dane z OpenStreetMap (Overpass API), `bbox = [minLon, minLat, maxLon, maxLat]`.

- `await findWater(bbox)`: poligony wód (`natural=water`, `water=*`, `waterway=riverbank`), w tym relacje multipolygon z wyspami. Wynik zapisuje się w `tools/umpire/.cache/water-<hash>.json` (katalog w `.gitignore`), kolejne wywołania działają **offline**. `{ refresh: true }` wymusza pobranie.
- `await findForest(bbox)`: jak wyżej dla lasu (`landuse=forest`, `natural=wood`).
- `pointInPolygon(pt, poly)`: test z dziurami.
- `await nudgeOutOfWater(points, bbox, { polygons?, inland_m = 60 })`: punkt w wodzie przesuwa na najbliższy brzeg i 60 m w głąb lądu, prosto od wody. Przyjmuje tablicę `[lon,lat]` albo mapę `id → [lon,lat]`; lista przesunięć w `result.moved`.
- `await preferCover(points, radius_m, bbox, { polygons?, water? })`: punkt poza lasem trafia do lasu, jeśli ten jest w promieniu `radius_m` (skraj + 40 m w głąb). Stosuj do rejonów wyczekiwania i odwodów.

Połączenia: jedno zapytanie na bbox, User-Agent z opisem, ponowna próba po 429/504 z wycofaniem, potem lustra (`overpass.private.coffee`, `overpass.kumi.systems`), gdy główny serwer jest przeciążony. Testy nie używają sieci (wstrzykują poligony).

**Limit czasu.** Całe zapytanie (wszystkie serwery i ponowienia razem) ma twardy limit, domyślnie 20 s, dzielony po równo między serwery. Nadpisanie: opcja `{ timeoutMs }` w `findWater`/`findForest`/`nudgeOutOfWater`/`preferCover`, zmienna `OVERPASS_TIMEOUT_MS` albo `pick.mjs --overpass-timeout <sekundy>`. Lista serwerów: opcja `endpoints` albo `OVERPASS_ENDPOINTS` (adresy po przecinku). Po przekroczeniu limitu rzucany jest błąd z `code === 'OVERPASS_UNAVAILABLE'`; `pick --check-water` łapie go, wypisuje „UWAGA: tryb offline — nie sprawdzono wody” i kończy się kodem 0 (dane z cache działają dalej bez sieci). Zawieszenie niemożliwe nawet przy serwerze, który przyjmuje połączenie i milczy (test: wskaż `OVERPASS_ENDPOINTS` na lokalny gniazdowy serwer bez odpowiedzi i `OVERPASS_TIMEOUT_MS=1000`).

## Logistyka i DOS w planie tury (`turn.mjs`, T17/T18)

`plan.logistics` zmienia prawdę sędziego (`umpire/turns`), `plan.player.logistics` widok gracza (`player/turns`). Oba mają ten sam format, a każdy działa tylko na swojej poprzedniej turze: gracz **nie dostaje** niczego z logistyki sędziego (stan znany graczowi aktualizujesz jawnie, np. skład z opóźnionym `as_of`).

```json
{
  "logistics": {
    "depots":  { "patch": { "sk-blog": { "stock": { "fuel": 160, "ammo": 120, "general": 240 } } } },
    "bridges": { "patch": { "most-2": { "status": "destroyed" } } },
    "convoys": { "patch": { "kw-1": { "pos": [22.91, 54.17], "route": [[22.88, 54.1]], "status": "delayed" } },
                 "add": [ { "id": "kw-2", "name": "Kolumna 2", "pos": [22.79, 53.975], "from": "sk-blog", "to": "sk-przod", "cargo": { "fuel": 10, "ammo": 5, "general": 5 }, "status": "planned" } ] }
  },
  "player": {
    "logistics": { "convoys": { "patch": { "kw-1": { "pos": [22.9, 54.15] } } } },
    "units": { "1bzmot": { "dos": { "fuel": 1.8, "ammo": 1.5, "general": 2.5, "readiness": 0.88, "as_of": "2026-05-14T06:30:00+02:00" } } }
  }
}
```

- Format sekcji (`depots`, `routes`, `bridges`, `convoys`): `{ "patch": { id: łatka | null }, "add": [obiekty] }`. Łatka scala pola (`null` w polu usuwa pole), `null` zamiast łatki usuwa element. Brak planu = poprzedni stan.
- **Track konwoju** liczony jak dla jednostek: od pozycji z tury N do nowego `pos`, z punktami pośrednimi z łatki (`route`) albo pełnym `track`; w widoku gracza, gdy łatka gracza nie ma `route`, użyta zostaje trasa z łatki sędziego (koniec zawsze w `pos` gracza).
- Widok gracza przechodzi przez białą listę `LOGISTICS_FIELDS`, więc pola sędziego z elementu nie wyciekną. `dos` jednostki **nie jest** kopiowany z prawdy: ustawiasz go wyłącznie łatką `plan.player.units.<id>.dos` (inaczej dziedziczony z tury N gracza).
- Poprawność (statusy, id, współrzędne) turn.mjs zgłasza jako UWAGI (`sędzia logistics…` / `gracz logistics…`); twardy wynik daje `npm run validate`.

### Dane przykładowe do ręcznych testów

`test/fixtures/logistics-sample.json` (1 MSR, 1 ASR, 2 składy, 2 mosty, 1 konwój z `track`, `dos` dla 5 jednostek z różnymi progami) i `test/fixtures/logistics-sample.mjs` (`injectLogisticsSample(katalogScenariusza)` wstrzykuje je do ostatniej tury gracza i sędziego kopii; czasy `"T-30"` są rozwiązywane względem czasu tury). Podgląd: `node test/fixtures/logistics-sample.mjs <katalog>` kopiuje 00-test-przesmyk i wstrzykuje dane; potem `PORT=8090 npm start -- <katalog-absolutny>`.

## Testy

`npm test` zawiera `test/umpire-deploy.test.js`: zakresy rozstawów, orientację względem azymutu, determinizm, ograniczenie jitteru, marsz po trasie, nieliniowość artylerii, poligony wody (z wyspą) i korektę, a także test, że kompanie o różnych zadaniach, azymutach i ziarnach dają wyraźnie różne układy względne, a nie obrócone kopie jednego wzoru.
