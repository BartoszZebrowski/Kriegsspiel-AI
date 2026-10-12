// Bootstrap: tworzy store, kontroler i widoki, spina je i uruchamia aplikację.
// Cała logika leży gdzie indziej — zob. docs/ARCHITECTURE.md (main → views/controller → store → domain).
import { api } from './core/api.js';
import { createStore } from './core/store.js';
import { createController } from './core/controller.js';
import { load, save } from './lib/storage.js';
import { createToastsView } from './views/toasts.js';
import { createTooltipsView } from './views/tooltips.js';
import { createTopbarView } from './views/topbar.js';
import { createWeatherView } from './views/weather.js';
import { createDocksView } from './views/docks.js';
import { createHotkeysView } from './views/hotkeys.js';
import { createBriefingView } from './views/briefing.js';
import { createAarView } from './views/aar.js';
import { createCcirView } from './views/ccir.js';
import { createStaffView } from './views/staff.js';
import { createStaffViewsView } from './views/staffviews.js';
import { createStructureView } from './views/structure.js';
import { createInspectorView } from './views/inspector.js';
import { createLegendView } from './views/legend.js';
import { createDosView } from './views/dos.js';
import { createMessengerView } from './views/messenger.js';
import { createTimelineView } from './views/timeline.js';
import { createOmniboxView } from './views/omnibox.js';
import { createMapView } from './views/map/index.js';
import { createDrawView } from './views/draw.js';
import { createLeaderView } from './views/leader.js';

async function start() {
  const store = createStore();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const controller = createController({
    store,
    api,
    storage: { load, save },
    env: {
      narrowScreen: window.innerWidth < 900,
      isPageVisible: () => !document.hidden,
      prefersReducedMotion: () => reducedMotion.matches,
    },
  });
  // Systemowe „ogranicz ruch”: animacja przemieszczeń wyłączona także po zmianie ustawienia w trakcie pracy.
  reducedMotion.addEventListener?.('change', () => controller.setReducedMotion(reducedMotion.matches));

  // Widoki, które nie potrzebują scenariusza, powstają przed jego wczytaniem (żeby pokazać błąd).
  createTooltipsView();
  createToastsView({ store, controller });
  try {
    await controller.init();
  } catch (err) {
    controller.notify('Nie udało się wczytać scenariusza: ' + err.message, true);
    return;
  }

  createTopbarView({ store, controller });
  createWeatherView({ store, controller });
  createDocksView({ store, controller });
  createBriefingView({ store, controller });
  createAarView({ store, controller });
  createCcirView({ store, controller });
  createStaffView({ store, controller });
  createStaffViewsView({ store, controller });
  createStructureView({ store, controller });
  createInspectorView({ store, controller });
  createLegendView({ store, controller });
  createDosView({ store, controller });
  createMessengerView({ store, controller });
  createTimelineView({ store, controller });
  createOmniboxView({ store, controller });
  const mapView = createMapView({ store, controller });
  // Powierzchnia mapy (Leaflet) jest współdzielonym zasobem renderowania: widoki nakładek dostają ją od bootstrapu.
  const drawing = createDrawView({ store, controller, surface: mapView.surface });
  createLeaderView({ store, surface: mapView.surface });
  createHotkeysView({ store, controller });

  if (new URLSearchParams(location.search).has('debug')) {
    window.__ks = { store, controller, map: mapView.map, surface: mapView.surface, drawing, motion: mapView.motion };
  }

  try {
    await controller.load();
  } catch (err) {
    controller.notify('Nie udało się wczytać tury: ' + err.message, true);
    return;
  }
  controller.ensureActiveChannel();
  controller.listen(api.events());
}

start();
