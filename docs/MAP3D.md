# Widok 3D terenu (T43)

Mapa sztabowa zostaje w Leaflet 2D. Widok 3D wybranego rejonu (bieżący rejon mapy) to osobna nakładka na MapLibre GL JS, tylko do odczytu. Wariant D z rozmowy 2026-10-12.

## Porównanie wariantów

| | MapLibre GL JS | CesiumJS | Google Photorealistic 3D Tiles |
|---|---|---|---|
| Koszt | 0 zł, bez klucza | 0 zł (silnik); najlepsze dane (Cesium ion) wymagają konta i tokenu, własny teren wymaga serwera kafli | wymaga klucza Google Cloud i rozliczeń; limity i opłaty za użycie |
| Licencja | BSD-3-Clause | Apache-2.0 (silnik); dane osobno | warunki Google Maps Platform: brak cache'owania i użycia offline, obowiązkowa atrybucja, ograniczenia zastosowań (m.in. wojskowych) |
| Offline | tak, po własnym zbuforowaniu kafli (PMTiles / lokalne kafle) | tak, ale ciężko | nie (zakazane) |
| Rozmiar biblioteki | ok. 1 MB JS (min), ładowana leniwie | ok. 4–5 MB + zasoby Workers/Assets | Cesium lub deck.gl + kafle w GB |
| Teren i budynki | raster-dem (Terrarium) + wytłaczane budynki z kafli wektorowych | pełny glob, modele 3D | fotorealistyczna siatka, ale bez swobody stylu |
| Dopasowanie do aplikacji | ES modules, bez bundlera, ten sam układ współrzędnych `[lon, lat]`, znaczniki HTML (milsymbol) | wielki silnik, własny układ sceny | zależność od cudzej usługi, niezgodna z „bez klucza i płatności” |

**Rekomendacja: MapLibre GL JS.** Spełnia wymóg „bez klucza API i bez płatności”, ma najmniejszy koszt integracji (jak Leaflet: plik z `/vendor/`) i pozwala pracować offline po zbuforowaniu kafli. Cesium jest zbyt ciężki dla tego zadania, Google 3D Tiles odpada przez klucz, rozliczenia i zakaz buforowania.

## Wybrane źródła danych (bez klucza)

| Warstwa | Źródło | URL | Licencja / atrybucja |
|---|---|---|---|
| Rzeźba terenu | Terrain Tiles (AWS Open Data, „Terrarium”, format RGB: `R*256 + G + B/256 - 32768` m) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom do 15 | Dane publiczne złożone z USGS 3DEP, SRTM, GMTED i in.; atrybucja źródeł wg [Joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) i [rejestru AWS](https://registry.opendata.aws/terrain-tiles/). Aplikacja pokazuje: „Terrain Tiles (AWS) z danych USGS 3DEP, SRTM, GMTED”. |
| Podkład | OpenStreetMap, raster | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | ODbL, „© OpenStreetMap”; serwer kafli OSM ma politykę użycia (umiarkowany ruch, bez masowego pobierania). |
| Budynki | OpenFreeMap (kafle wektorowe OpenMapTiles z danych OSM; warstwa `building`, pola `render_height`, `render_min_height`) | TileJSON `https://tiles.openfreemap.org/planet`, bez klucza, bez rejestracji | Usługa MIT, dane © OpenStreetMap (ODbL), schemat © OpenMapTiles; atrybucja „OpenFreeMap © OpenMapTiles Data from OpenStreetMap”. Budynki widać od zoomu 14. |

Zastrzeżenia: zewnętrzne kafle wymagają sieci. Brak sieci nie psuje widoku: błędy kafli są ignorowane, a jednostki, linie i logistyka rysują się na pustym tle. Budynki są dodatkiem: gdy OpenFreeMap jest niedostępny, widok działa bez nich. Przy wdrożeniu produkcyjnym lub dużym ruchu warto zbuforować kafle terenu lokalnie (PMTiles z tego samego zbioru).

## Zakres widoku 3D

- Wejście: przycisk „3D” w panelu przy mapie albo polecenie „Widok 3D” w omniboksie. Otwiera rejon aktualnie widoczny na mapie 2D.
- Rzeźba z przewyższeniem 1,3x, cieniowanie, pochylenie do 80 stopni, obrót, kompas.
- Na scenie: jednostki własne i sąsiedzi (symbole milsymbol), kontakty z przezroczystością wg wieku informacji, linie (`boundary`, `flot`, `enemy_flot`, `phase`, `axis`, `enemy_axis`), strefy REW (`ew_zone`), logistyka (trasy, składy, konwoje, mosty). Respektuje warstwy i szczegółowość z mapy 2D.
- Tylko odczyt: klik w symbol zaznacza jednostkę w store (inspektor), bez zmian danych.
- Zamknięcie (przycisk, Esc) usuwa kontekst WebGL i wraca do 2D. Bez WebGL pokazuje komunikat „Brak WebGL”.
- Wersja biblioteki jest przypięta w `package.json` (`maplibre-gl` 5.7.0); pliki serwowane z `/vendor/maplibre/`.
