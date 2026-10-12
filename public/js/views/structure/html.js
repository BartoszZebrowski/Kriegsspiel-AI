// Strukturę buduje się z gotowych fragmentów HTML: węzły drzewa sił, wiersze kontaktów i środków, nagłówki sekcji.
// Czyste funkcje (stan: ctx.open, ctx.q, sekcje podane jako argumenty) — widok tylko wstawia wynik do DOM.
import { subtreeSum, channelForUnit } from '../../domain/orbat.js';
import { symbolSvg } from '../../lib/symbols.js';
import { ic } from '../../lib/icons.js';
import { escapeHtml as e } from '../../domain/markdown.js';
import { readinessLevel, readinessRatio } from '../../domain/strength.js';
import { describeSidc } from '../../domain/sidc.js';

export const SECTIONS = [
  ['own', 'Siły własne'],
  ['ext', 'Przełożony i sąsiedzi'],
  ['con', 'Kontakty przeciwnika'],
  ['ast', 'Środki rozpoznania'],
];
export const SEC_H = 26;

// Poziom siły jednostki 0–1 (osobowy stan, w razie braku — pole strength) albo null.
export function strengthRatio(u) {
  if (u.personnel) return readinessRatio(u.personnel.current, u.personnel.authorized);
  return typeof u.strength === 'number' ? u.strength : null;
}
export const barClass = (r) => {
  const l = readinessLevel(r);
  return l === 'warn' ? 'warn' : l === 'bad' ? 'bad' : '';
};
export const confClass = { wysoka: 'h', średnia: 'm', niska: 'l' };

// Czy którykolwiek z fragmentów tekstu zawiera filtr `q` (puste q — wszystko pasuje).
export const matchesText = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(q);

// Drzewo własnych sił oraz formacji sąsiada. Formacja (ctx.nb): korzeń = dowództwo sąsiada (z kanałem, jeśli ma),
// podwładni sąsiada tylko do odczytu — bez kanałów, plakietek nieprzeczytanych i przycisku wiadomości.
export function nodeHtml(node, ctx, depth) {
  const u = node.unit;
  const nbChild = ctx.nb && depth > 0;
  const nbRoot = ctx.nb && depth === 0;
  const kids = node.children.filter((k) => subtreeMatches(k, ctx.q));
  const hasKids = node.children.length > 0;
  const isOpen = hasKids && (ctx.open.has(u.id) || (ctx.q && kids.length > 0));
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

export function subtreeMatches(node, q) {
  if (!q) return true;
  const u = node.unit;
  return matchesText(q, u.name, u.id) || node.children.some((k) => subtreeMatches(k, q));
}

export function secHtml(key, title, count, inner, sections) {
  const ix = SECTIONS.findIndex((s) => s[0] === key);
  const closed = !sections[key];
  return `<div class="sec-h${closed ? ' closed' : ''}" data-sec="${key}" role="button" tabindex="0" aria-expanded="${!closed}" style="top:${ix * SEC_H}px;bottom:${(SECTIONS.length - 1 - ix) * SEC_H}px">${ic('chevd', 's car')}<span class="cap">${title}</span><span class="count">${count}</span></div>
    <div class="sec-b${closed ? ' closed' : ''}" data-secb="${key}">${inner}</div>`;
}

// Wiersze płaskich sekcji (bez poddrzewa).
export function neighbourRowHtml(u, channel, ctx) {
  const n = ctx.unreadUnits[u.id] || 0;
  const sel = ctx.selId === u.id;
  return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(u.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${u.sidc ? symbolSvg(u.sidc, { size: 20 }).svg : ''}</span><span class="tname">${e(u.name || u.id)}<em>${channel?.kind === 'superior' ? 'przełożony' : 'sąsiad'}</em></span>${n ? `<span class="ubadge${channel?.kind === 'superior' ? ' urg' : ''}">${n}</span>` : ''}${channel ? `<button class="tmsg ibtn" type="button" data-msg="${e(u.id)}" data-tip="Otwórz kanał" aria-label="Otwórz kanał: ${e(u.name || u.id)}">${ic('msg', 's')}</button>` : ''}</div>`;
}
export function contactRowHtml(c, ctx, ageText) {
  const sel = ctx.selId === c.id;
  return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(c.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${symbolSvg(c.sidc, { size: 20 }).svg}</span><span class="tname"><span class="mono hostile">${e(c.id)}</span><em>${e(c.estimate || '')}</em></span><span class="age">${e(ageText)}</span><span class="conf ${confClass[c.confidence] || 'l'}" title="pewność: ${e(c.confidence || 'brak')}"></span></div>`;
}
export function assetRowHtml(a, ctx) {
  const sel = ctx.selId === a.id;
  return `<div class="tcon trow${sel ? ' sel' : ''}" data-id="${e(a.id)}" role="treeitem" aria-selected="${sel}" tabindex="-1"><span class="tsym">${a.sidc ? symbolSvg(a.sidc, { size: 18 }).svg : ''}</span><span class="tname">${e(a.name || a.id)}<em>${a.pos ? 'w terenie' : 'gotowy'}</em></span></div>`;
}
