// Widok: legenda jako popover przy palecie mapy (`#legend`) — karty „Na mapie” (typy symboli z oglądanej tury)
// i „Zasady” (ściąga budowy symbolu). Otwarcie to stan współdzielony (store.popover): przycisk `?`, klawisz,
// pasek górny i omnibox. Najechanie na symbol na mapie pokazuje opis kontekstowo, więc legenda jest potrzebna rzadko.
import { symbolSvg } from '../lib/symbols.js';
import { groupSymbolTypes } from '../domain/sidc.js';
import { escapeHtml as e } from '../domain/markdown.js';

const row = (sidc, title, small = '', right = '', size = 26) =>
  `<div class="lg-r"><div class="s">${symbolSvg(sidc, { size }).svg}</div><div class="d">${e(title)}${small ? `<small>${small}</small>` : ''}</div><div class="x">${right}</div></div>`;

const group = (title, items) =>
  items.length ? `<div class="lg-g cap">${title}</div>` + items.map((g) => row(g.sidc, g.description, `<span class="mono">${e(g.sidc)}</span>`, g.count > 1 ? `×${g.count}` : '')).join('') : '';

export function renderOnMap(el, turn) {
  const own = groupSymbolTypes(turn.units || []);
  const enemy = groupSymbolTypes(turn.contacts || []);
  const assets = groupSymbolTypes((turn.assets || []).filter((a) => a.sidc));
  if (!own.length && !enemy.length && !assets.length) {
    el.innerHTML = '<p class="muted pad">Brak symboli na mapie.</p>';
    return;
  }
  const svgRow = (svg, title, small) => `<div class="lg-r"><div class="s">${svg}</div><div class="d">${title}<small>${small}</small></div><div class="x"></div></div>`;
  el.innerHTML =
    group('Siły własne', own) +
    group('Przeciwnik', enemy) +
    group('Środki rozpoznania', assets) +
    `<div class="lg-g cap">Elementy mapy</div>` +
    svgRow('<svg width="34" height="20"><circle cx="17" cy="10" r="8" fill="rgba(255,128,128,.12)" stroke="#ff8080" stroke-dasharray="3 2"/></svg>', 'Okrąg niepewności', 'promień = niepewność położenia kontaktu') +
    svgRow('<svg width="34" height="20"><circle cx="9" cy="10" r="5" fill="#ff8080"/><circle cx="25" cy="10" r="5" fill="#ff8080" opacity=".38"/></svg>', 'Wiek informacji', 'kontakt blaknie wraz z upływem czasu') +
    svgRow('<svg width="34" height="20"><path d="M2 10h30" stroke="#d6dde6" stroke-width="3"/></svg>', 'Granica pasa', 'rozgraniczenie pasów zgrupowań') +
    svgRow('<svg width="34" height="20"><path d="M2 10h30" stroke="#ff2bd6" stroke-width="2.5" stroke-dasharray="7 5"/></svg>', 'Podporządkowanie', 'przełożony → podwładny');
}

const AFFIL = [
  ['SFGPUCI----E---', 'Swój'],
  ['SHGPUCI----E---', 'Wróg'],
  ['SUGPUCI----E---', 'Nieznany'],
  ['SSGPUCI----E---', 'Podejrzany'],
];
const ECHELON = [
  ['D', 'Pluton', '•••'],
  ['E', 'Kompania', 'I'],
  ['F', 'Batalion', 'II'],
  ['G', 'Pułk', 'III'],
  ['H', 'Brygada / ZT', 'X'],
  ['I', 'Dywizja', 'XX'],
];
const BRANCH = [
  ['SFGPUCI-------', 'Piechota — krzyżyk'],
  ['SFGPUCIZ------', 'Piechota zmechanizowana — krzyżyk z elipsą'],
  ['SFGPUCAT------', 'Pancerne — elipsa (gąsienica)'],
  ['SFGPUCR-------', 'Rozpoznanie — ukośna kreska'],
  ['SFGPUCFHE-----', 'Artyleria samobieżna'],
  ['SFGPUCFRMS----', 'Wyrzutnie rakiet'],
  ['SFGPUCAA------', 'Przeciwpancerne'],
  ['SFGPUCD-------', 'Obrona przeciwlotnicza'],
  ['SFGPUCE-------', 'Saperzy — „mostek”'],
  ['SFGPUUS-------', 'Łączność'],
  ['SFGPUSS-------', 'Zaopatrzenie'],
  ['SFGPUSM-------', 'Medyczne'],
  ['SFAPMFQ-------', 'Dron (bezzałogowy statek powietrzny)'],
];

export function renderRules(el) {
  const aff = (items) => `<div class="aff">${items.map(([s, d, mark]) => `<div>${symbolSvg(s, { size: 34 }).svg}${e(d)}${mark ? `<br><span class="mono">${mark}</span>` : ''}</div>`).join('')}</div>`;
  el.innerHTML =
    `<div class="lg-g cap">Przynależność — kolor i kształt ramki</div>${aff(AFFIL)}` +
    `<div class="lg-g cap">Wielkość — znaczniki nad ramką</div>${aff(ECHELON.map(([c, d, mark]) => [`SFGPUCI----${c}---`, d, mark]))}` +
    `<div class="lg-g cap">Rodzaj — znak w środku ramki</div>${BRANCH.map(([s, d]) => row(s.padEnd(15, '-'), d)).join('')}` +
    `<div class="lg-g cap">Status</div>${row('SHGAUCI----E---', 'Ramka przerywana', 'niepotwierdzony / przewidywany')}` +
    `<div class="lg-g cap">Opisy przy symbolu</div><p class="muted pad">Pod symbolem: nazwa jednostki. Przy kontaktach: oznaczenie i wiek informacji.</p>`;
}

export function createLegendView({ store, controller, root = document }) {
  const body = root.getElementById('lg-body');
  const seg = root.getElementById('seg-leg');
  let tab = 'map'; // karta legendy to stan lokalny widoku

  function render() {
    const { turn, popover } = store.get();
    if (popover !== 'legend') return;
    if (tab === 'map') {
      if (turn) renderOnMap(body, turn);
    } else renderRules(body);
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.l === tab);
  }

  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-l]');
    if (!b) return;
    tab = b.dataset.l;
    render();
  });
  root.getElementById('leg-x').addEventListener('click', () => controller.setPopover(null));
  store.subscribe(['popover', 'turn'], render, { immediate: true });
}
