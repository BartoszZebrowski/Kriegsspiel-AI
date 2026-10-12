// Widok: lewy dok, panel „Struktura” — własne siły (drzewo z liniami łączącymi, paskami siły i plakietkami
// nieprzeczytanych) oraz zwijane sekcje: przełożony i sąsiedzi, kontakty przeciwnika, środki rozpoznania.
// Zaznaczenie jest jedno (store.selection): klik zaznacza, dwuklik / ikona kanału otwiera rozmowę.
import { buildTree, echelonRank, BATTALION_RANK, splitUnits, channelForUnit, subtreeSum, formationTree, parentIdOf, isNeighbourUnit, reparentedParents, indexById } from '../domain/orbat.js';
import { symbolSvg } from '../lib/symbols.js';
import { ic } from '../lib/icons.js';
import { escapeHtml as e } from '../domain/markdown.js';
import { readinessLevel, readinessRatio } from '../domain/strength.js';
import { ageMinutes, formatAgeShort } from '../domain/format.js';
import { describeSidc } from '../domain/sidc.js';

const SECTIONS = [
  ['own', 'Siły własne'],
  ['ext', 'Przełożony i sąsiedzi'],
  ['con', 'Kontakty przeciwnika'],
  ['ast', 'Środki rozpoznania'],
];
const SEC_H = 26;

// Poziom siły jednostki 0–1 (osobowy stan, w razie braku — pole strength) albo null.
function strengthRatio(u) {
  if (u.personnel) return readinessRatio(u.personnel.current, u.personnel.authorized);
  return typeof u.strength === 'number' ? u.strength : null;
}
const barClass = (r) => {
  const l = readinessLevel(r);
  return l === 'warn' ? 'warn' : l === 'bad' ? 'bad' : '';
};
const confClass = { wysoka: 'h', średnia: 'm', niska: 'l' };

export function createStructureView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const body = $('tree-scroll');
  const filterInput = $('tr-q');
  const S = () => store.get();

  // Stan lokalny widoku: rozwinięte węzły, otwarte sekcje, filtr.
  let open = null; // Set id; null = jeszcze nie ustawiono (pierwszy render ustawia domyślne)
  const sections = { own: true, ext: true, con: true, ast: false };
  let filter = '';
  let turnKey = null;
  let prevUnits = null; // jednostki poprzednio narysowanej tury (wykrywanie przepięć podporządkowania)
  const nbSeen = new Set(); // dowództwa sąsiadów, które już raz rozwinięto domyślnie

  const q = () => filter.trim().toLowerCase();
  const matchesText = (...parts) => !q() || parts.join(' ').toLowerCase().includes(q());

  function ensureOpen(units) {
    if (open) return;
    // Domyślnie rozwinięte są szczeble od batalionu w górę; kompanie są zwinięte, więc plutony schowane.
    open = new Set(units.filter((u) => echelonRank(u) >= BATTALION_RANK || !u.parent).map((u) => u.id));
  }

  // ---------- budowa HTML ----------
  // Drzewo własnych sił oraz formacji sąsiada. Formacja (ctx.nb): korzeń = dowództwo sąsiada (z kanałem, jeśli ma),
  // podwładni sąsiada tylko do odczytu — bez kanałów, plakietek nieprzeczytanych i przycisku wiadomości.
  function nodeHtml(node, ctx, depth) {
    const u = node.unit;
    const nbChild = ctx.nb && depth > 0;
    const nbRoot = ctx.nb && depth === 0;
    const kids = node.children.filter((k) => subtreeMatches(k));
    const hasKids = node.children.length > 0;
    const isOpen = hasKids && (open.has(u.id) || (q() && kids.length > 0));
    const ratio = strengthRatio(u);
    const unread = nbChild ? 0 : subtreeSum(node, (x) => ctx.unreadUnits[x.id] || 0);
    const ch = nbChild ? null : channelForUnit(ctx.channels, u.id);
    const sym = u.sidc ? symbolSvg(u.sidc, { size: 20 }).svg : '';
    const sel = ctx.selId === u.id;
    const bar = ratio == null ? '' : `<span class="sbar ${barClass(ratio)}" title="Ukompletowanie ${Math.round(ratio * 100)}%"><i style="width:${Math.round(ratio * 100)}%"></i></span><span class="spct">${Math.round(ratio * 100)}</span>`;
    const nbLabel = nbRoot ? `<em>${ctx.channel?.kind === 'superior' ? 'przełożony' : 'sąsiad'}</em>` : '';
    return `<li data-id="${e(u.id)}" role="none"><div class="trow${sel ? ' sel' : ''}${nbRoot ? ' nb' : ''}${nbChild ? ' nb nb-unit' : ''}" data-id="${e(u.id)}" role="treeitem" aria-level="${depth + 1}" aria-selected="${sel}"${hasKids ? ` aria-expanded="${isOpen}"` : ''} tabindex="-1" title="${e(nbChild ? 'Sąsiad — brak dowodzenia' : u.status || describeSidc(u.sidc))}">
      <span class="tcar${hasKids ? (isOpen ? ' open' : '') : ' leaf'}" data-car="${e(u.id)}">${ic('chev')}</span>
      <span class="tsym">${sym}</span><span class="tname">${e(u.name || u.id)}${!ctx.nb && !u.parent && depth === 0 && node.children.length ? '<em>dowództwo</em>' : ''}${nbLabel}</span>
      ${unread ? `<span class="ubadge">${unread}</span>` : ''}${ch ? `<button class="tmsg ibtn" type="button" data-msg="${e(u.id)}" data-tip="Otwórz kanał" aria-label="Otwórz kanał: ${e(u.name || u.id)}">${ic('msg', 's')}</button>` : ''}${bar}</div>
      ${hasKids && isOpen && kids.length ? `<ul role="group">${kids.map((k) => nodeHtml(k, ctx, depth + 1)).join('')}</ul>` : ''}</li>`;
  }

  function subtreeMatches(node) {
    if (!q()) return true;
    const u = node.unit;
    return matchesText(u.name, u.id) || node.children.some(subtreeMatches);
  }

  function secHtml(key, title, count, inner) {
    const ix = SECTIONS.findIndex((s) => s[0] === key);
    const closed = !sections[key];
    return `<div class="sec-h${closed ? ' closed' : ''}" data-sec="${key}" role="button" tabindex="0" aria-expanded="${!closed}" style="top:${ix * SEC_H}px;bottom:${(SECTIONS.length - 1 - ix) * SEC_H}px">${ic('chevd', 's car')}<span class="cap">${title}</span><span class="count">${count}</span></div>
      <div class="sec-b${closed ? ' closed' : ''}" data-secb="${key}">${inner}</div>`;
  }

  function render() {
    const s = S();
    const turn = s.turn;
    if (!turn) {
      body.innerHTML = '<p class="muted pad">Brak danych tury.</p>';
      return;
    }
    const { own, external, formation } = splitUnits(turn.units || [], s.channels);
    ensureOpen(own);
    // Przepięcie podporządkowania lub nowa jednostka: rozwiń nowego przełożonego (i jego przodków), by zmiana była widoczna.
    if (prevUnits && prevUnits !== turn.units) {
      const byId = indexById(turn.units || []);
      for (let id of reparentedParents(prevUnits, turn.units)) {
        for (const seen = new Set(); id && !seen.has(id); id = parentIdOf(byId.get(id))) {
          open.add(id);
          seen.add(id);
        }
      }
    }
    prevUnits = turn.units || [];
    const ctx = { unreadUnits: s.unreadUnits, channels: s.channels, selId: s.selection?.id ?? null };
    const tree = buildTree(own).filter(subtreeMatches);
    const parts = [];
    parts.push(secHtml('own', 'Siły własne', own.length, tree.length ? `<ul class="tree" role="tree" aria-label="Siły własne">${tree.map((n) => nodeHtml(n, ctx, 0)).join('')}</ul>` : '<p class="muted pad">Brak jednostek.</p>'));

    // Sąsiedzi z własnymi jednostkami (`formation`) to rozwijane węzły; pozostali — płaskie wiersze jak dotąd.
    const trees = new Map(external.map(({ unit }) => [unit.id, formationTree(unit, formation)]));
    // Nowa formacja sąsiada otwiera się jak własne siły: dowództwo i szczeble od batalionu w górę.
    const openNew = (node) => {
      if (echelonRank(node.unit) >= BATTALION_RANK || !node.unit.parent) open.add(node.unit.id);
      node.children.forEach(openNew);
    };
    for (const [id, t] of trees) {
      if (t.children.length && !nbSeen.has(id)) {
        nbSeen.add(id);
        openNew(t);
      }
    }
    const ext = external.filter(({ unit }) => subtreeMatches(trees.get(unit.id)));
    parts.push(
      secHtml(
        'ext',
        'Przełożony i sąsiedzi',
        external.length + formation.length,
        ext
          .map(({ unit: u, channel }) => {
            const t = trees.get(u.id);
            if (t.children.length) return `<ul class="tree tree--nb" role="tree" aria-label="Formacja: ${e(u.name || u.id)}">${nodeHtml(t, { ...ctx, nb: true, channel }, 0)}</ul>`;
            const n = ctx.unreadUnits[u.id] || 0;
            const sel = ctx.selId === u.id;
            return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(u.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${u.sidc ? symbolSvg(u.sidc, { size: 20 }).svg : ''}</span><span class="tname">${e(u.name || u.id)}<em>${channel?.kind === 'superior' ? 'przełożony' : 'sąsiad'}</em></span>${n ? `<span class="ubadge${channel?.kind === 'superior' ? ' urg' : ''}">${n}</span>` : ''}${channel ? `<button class="tmsg ibtn" type="button" data-msg="${e(u.id)}" data-tip="Otwórz kanał" aria-label="Otwórz kanał: ${e(u.name || u.id)}">${ic('msg', 's')}</button>` : ''}</div>`;
          })
          .join(''),
      ),
    );

    const contacts = (turn.contacts || []).filter((c) => matchesText(c.id, c.estimate));
    parts.push(
      secHtml(
        'con',
        'Kontakty przeciwnika',
        (turn.contacts || []).length,
        contacts
          .map((c) => {
            const sel = ctx.selId === c.id;
            const age = c.observed ? formatAgeShort(ageMinutes(c.observed, turn.time)) : '';
            return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(c.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${symbolSvg(c.sidc, { size: 20 }).svg}</span><span class="tname"><span class="mono hostile">${e(c.id)}</span><em>${e(c.estimate || '')}</em></span><span class="age">${e(age)}</span><span class="conf ${confClass[c.confidence] || 'l'}" title="pewność: ${e(c.confidence || 'brak')}"></span></div>`;
          })
          .join(''),
      ),
    );

    const assets = (turn.assets || []).filter((a) => matchesText(a.name, a.id, a.type));
    parts.push(
      secHtml(
        'ast',
        'Środki rozpoznania',
        (turn.assets || []).length,
        assets
          .map((a) => {
            const sel = ctx.selId === a.id;
            return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(a.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${a.sidc ? symbolSvg(a.sidc, { size: 18 }).svg : ''}</span><span class="tname">${e(a.name || a.id)}<em>${a.pos ? 'w terenie' : 'gotowy'}</em></span></div>`;
          })
          .join(''),
      ),
    );

    const scroll = body.scrollTop;
    const hadFocus = body.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
    body.innerHTML = parts.join('');
    body.scrollTop = scroll;
    $('cnt-units').textContent = own.length;
    applyHover();
    roving(hadFocus);
  }

  // Roving tabindex: jeden wiersz w tabie (zaznaczony albo pierwszy), pozostałe dostępne strzałkami.
  function roving(focusId = null) {
    const rows = visibleRows();
    const cur = rows.find((r) => r.classList.contains('sel')) || rows[0];
    for (const r of rows) r.tabIndex = r === cur ? 0 : -1;
    if (focusId) body.querySelector(`.trow[data-id="${CSS.escape(focusId)}"]`)?.focus();
  }
  const visibleRows = () => [...body.querySelectorAll('.sec-b:not(.closed) .trow')];

  function applyHover() {
    const h = S().hoverUnit;
    for (const r of body.querySelectorAll('.trow.hov')) r.classList.remove('hov');
    if (h) body.querySelector(`.trow[data-id="${CSS.escape(h)}"]`)?.classList.add('hov');
  }

  // ---------- zaznaczenie (z mapy, omniboksu, komunikatora…) ----------
  function ancestorsOf(id) {
    const units = S().turn?.units || [];
    const byId = new Map(units.map((u) => [u.id, u]));
    const out = [];
    let p = parentIdOf(byId.get(id));
    while (p && byId.has(p) && !out.includes(p)) {
      out.push(p);
      p = parentIdOf(byId.get(p));
    }
    return out;
  }

  function onSelection() {
    const id = S().selection?.id ?? null;
    if (id && open) {
      const closed = ancestorsOf(id).filter((a) => !open.has(a));
      if (closed.length) {
        for (const a of closed) open.add(a);
        const units = S().turn?.units || [];
        const unit = units.find((u) => u.id === id);
        sections[unit && isNeighbourUnit(unit, new Map(units.map((u) => [u.id, u]))) ? 'ext' : 'own'] = true;
        render();
      }
    }
    for (const r of body.querySelectorAll('.trow')) {
      const on = r.dataset.id === id;
      r.classList.toggle('sel', on);
      r.setAttribute('aria-selected', String(on));
    }
    roving();
    body.querySelector('.trow.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- zdarzenia → intencje ----------
  function select(id) {
    if (!controller.selectEntity(id)) controller.notify('Tego obiektu nie ma teraz na mapie (brak pozycji)', true);
  }

  body.addEventListener('click', (ev) => {
    const T = ev.target;
    const car = T.closest('[data-car]');
    if (car) {
      const id = car.dataset.car;
      if (!car.classList.contains('leaf')) {
        if (!open.delete(id)) open.add(id);
        render();
      }
      return;
    }
    const msg = T.closest('[data-msg]');
    if (msg) {
      controller.openUnitChannel(msg.dataset.msg);
      return;
    }
    const sh = T.closest('.sec-h');
    if (sh) {
      sections[sh.dataset.sec] = !sections[sh.dataset.sec];
      render();
      return;
    }
    const row = T.closest('.trow');
    if (row) select(row.dataset.id);
  });
  body.addEventListener('dblclick', (ev) => {
    const row = ev.target.closest('.trow');
    // Jednostki sąsiadów (.nb-unit) nie mają kanałów — dwuklik tylko je zaznacza.
    if (row && !row.classList.contains('nb-unit') && S().turn?.units?.some((u) => u.id === row.dataset.id)) controller.openUnitChannel(row.dataset.id);
  });
  body.addEventListener('mouseover', (ev) => {
    const row = ev.target.closest('.trow');
    const id = row?.dataset.id ?? null;
    if (id !== S().hoverUnit) controller.hoverUnit(id);
  });
  body.addEventListener('mouseleave', () => controller.hoverUnit(null));

  // Nawigacja klawiaturą po drzewie: ↑↓ między wierszami, → rozwiń / wejdź, ← zwiń / wyjdź, Enter zaznacza.
  body.addEventListener('keydown', (ev) => {
    const sh = ev.target.closest?.('.sec-h');
    if (sh && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      sh.click();
      return;
    }
    const row = ev.target.closest?.('.trow');
    if (!row) return;
    const rows = visibleRows();
    const i = rows.indexOf(row);
    const focus = (r) => {
      if (!r) return;
      for (const x of rows) x.tabIndex = -1;
      r.tabIndex = 0;
      r.focus();
    };
    const id = row.dataset.id;
    const car = row.querySelector('.tcar');
    if (ev.key === 'ArrowDown') (ev.preventDefault(), focus(rows[i + 1]));
    else if (ev.key === 'ArrowUp') (ev.preventDefault(), focus(rows[i - 1]));
    else if (ev.key === 'Home') (ev.preventDefault(), focus(rows[0]));
    else if (ev.key === 'End') (ev.preventDefault(), focus(rows.at(-1)));
    else if (ev.key === 'ArrowRight' && car && !car.classList.contains('leaf')) {
      ev.preventDefault();
      if (!car.classList.contains('open')) {
        open.add(id);
        render();
        roving(id);
      } else focus(rows[i + 1]);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      if (car?.classList.contains('open')) {
        open.delete(id);
        render();
        roving(id);
      } else {
        const parent = ancestorsOf(id)[0];
        if (parent) focus(rows.find((r) => r.dataset.id === parent));
      }
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      select(id);
    }
  });

  $('tr-fold').addEventListener('click', () => {
    const units = S().turn?.units || [];
    open = new Set(units.filter((u) => echelonRank(u) > BATTALION_RANK || !u.parent).map((u) => u.id));
    render();
  });
  $('tr-unfold').addEventListener('click', () => {
    const units = S().turn?.units || [];
    open = new Set(units.map((u) => u.id));
    render();
  });
  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    render();
    if (q()) body.querySelector('.sec-b:not(.closed) .trow')?.scrollIntoView({ block: 'nearest' });
  });
  filterInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && filterInput.value) {
      ev.stopPropagation();
      filterInput.value = '';
      filter = '';
      render();
    }
  });

  // ---------- subskrypcje ----------
  store.subscribe(['turn', 'channels', 'unreadUnits'], () => {
    // Nowa tura zachowuje stan rozwinięcia; nowe id jednostek (pluton w nowej turze) nie są rozwinięte.
    const key = S().turn ? S().turn.turn : null;
    if (key !== turnKey) turnKey = key;
    render();
  }, { immediate: true });
  store.subscribe('selection', onSelection);
  store.subscribe('hoverUnit', applyHover);
  store.subscribe('command', ({ command }) => {
    if (command?.name === 'treeFilter') {
      filterInput.focus();
      filterInput.select();
    }
  });
}
