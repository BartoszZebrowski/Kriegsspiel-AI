// Podkłady i nakładki kafelkowe mapy (Leaflet jako zmienna globalna `L`).
/* global L */

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Podkład szary Esri (Dark/Light Gray Canvas) z warstwą nazw — darmowy, bez klucza.
function esriCanvas(tone) {
  const url = (kind) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${tone}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
  return L.layerGroup([
    L.tileLayer(url('Base'), { maxNativeZoom: 16, maxZoom: 19, attribution: 'Podkład &copy; Esri, HERE, Garmin, &copy; OpenStreetMap' }),
    L.tileLayer(url('Reference'), { maxNativeZoom: 16, maxZoom: 19 }),
  ]);
}

export const BASEMAPS = {
  'Mapa (OSM)': () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR }),
  'Topografia (OpenTopoMap)': () =>
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: `${OSM_ATTR}, SRTM | styl: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    }),
  'Ciemna (Esri)': () => esriCanvas('Dark'),
  'Jasna (Esri)': () => esriCanvas('Light'),
  'Satelita (Esri)': () =>
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Zdjęcia &copy; Esri, Maxar, Earthstar Geographics, GIS User Community',
    }),
};

export const OVERLAYS = {
  'Rzeźba terenu': () =>
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.45,
      attribution: 'Cieniowanie &copy; Esri',
    }),
  'Koleje': () =>
    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc',
      attribution: '<a href="https://www.openrailwaymap.org">OpenRailwayMap</a> (CC-BY-SA)',
    }),
  'Nazwy i granice': () =>
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Nazwy &copy; Esri',
    }),
};

// Kolejność podkładów w popoverze „Warstwy”.
export const BASEMAP_ORDER = ['Ciemna (Esri)', 'Topografia (OpenTopoMap)', 'Mapa (OSM)', 'Jasna (Esri)', 'Satelita (Esri)'];
// Podkłady ciemne (ciemna mapa, satelita): jasne podpisy symboli (CSS .is-dark-base).
export const DARK_BASES = ['Ciemna (Esri)', 'Satelita (Esri)'];
