// Widok: pogoda i pora doby w zegarze (T30). Dane tylko ze store; stan pochodny to klasa body.is-night.
import { dayPhase, isNightPhase, PHASE_LABELS } from '../domain/daylight.js';
import { weatherInfo, weatherSummaryText } from '../domain/weather.js';

export function createWeatherView({ store, controller, root = document }) {
  const el = root.getElementById('clk-weather');

  function render({ turn, scenario }) {
    const phase = turn && scenario ? dayPhase(turn.time, scenario.map?.center) : 'day';
    const night = isNightPhase(phase);
    document.body.classList.toggle('is-night', night);
    if (!el) return;
    const info = weatherInfo(turn?.weather);
    const showPhase = phase !== 'day';
    if (!turn || (!info && !showPhase)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const moon = night ? '☾' : phase === 'twilight' ? '◐' : '';
    el.textContent = [moon, info?.icon, night ? 'noc' : phase === 'twilight' ? 'zmierzch' : ''].filter(Boolean).join(' ');
    el.dataset.phase = phase;
    el.dataset.tone = info?.tone || 'ok';
    el.dataset.tip = weatherSummaryText(turn.weather, phase);
    el.setAttribute('aria-label', `${PHASE_LABELS[phase]}. ${weatherSummaryText(turn.weather, phase)}`);
  }

  el?.addEventListener('click', () => controller?.showTurnCard());

  store.subscribe(['turn', 'scenario'], render, { immediate: true });
}
