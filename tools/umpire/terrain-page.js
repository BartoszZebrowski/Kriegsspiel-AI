// Skrypt strony renderowanej przez terrain-view.mjs (działa w przeglądarce, nie w Node).
// Konfiguracja w window.CFG; wynik w window.__done / window.__report / window.__tilesState().
(function () {
  const C = window.CFG;
  const W = C.size[0];
  const H = C.size[1];
  const NS = 'http://www.w3.org/2000/svg';

  const BASES = {
    topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxNativeZoom: 17 },
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxNativeZoom: 19 },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', subdomains: 'abc', maxNativeZoom: 19 },
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', subdomains: 'abcd', maxNativeZoom: 20 },
  };
  const HILLSHADE = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 15 };

  const mapEl = document.getElementById('map');
  mapEl.style.width = W + 'px';
  mapEl.style.height = H + 'px';
  const map = L.map(mapEl, {
    center: [C.center[1], C.center[0]], zoom: C.zoom, zoomControl: false, attributionControl: false,
    fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false, inertia: false, maxZoom: 20,
  });

  const layers = [];
  const b = BASES[C.base] || BASES.topo;
  const base = L.tileLayer(b.url, { subdomains: b.subdomains, maxNativeZoom: b.maxNativeZoom, maxZoom: 20, tileSize: 256, crossOrigin: true, updateWhenIdle: false, keepBuffer: 1 });
  base.addTo(map);
  layers.push(base);
  if (C.hillshade) {
    const hs = L.tileLayer(HILLSHADE.url, { maxNativeZoom: HILLSHADE.maxNativeZoom, maxZoom: 20, opacity: 0.5, className: 'hillshade', crossOrigin: true });
    hs.addTo(map);
    layers.push(hs);
  }

  // Ponowienie raz dla kafelka, który nie załadował się za pierwszym razem.
  layers.forEach((l) => l.on('tileerror', (e) => {
    const t = e.tile;
    if (t._retried) return;
    t._retried = true;
    t._pending = true;
    const src = t.src;
    const done = () => { t._pending = false; };
    t.addEventListener('load', done, { once: true });
    t.addEventListener('error', done, { once: true });
    setTimeout(() => { t.src = src + (src.includes('?') ? '&' : '?') + 'retry=1'; }, 600);
  }));

  window.__tilesState = function () {
    let total = 0;
    let loaded = 0;
    const missing = [];
    let busy = false;
    layers.forEach((l) => {
      Object.values(l._tiles || {}).forEach((t) => {
        if (!t.current) return;
        total++;
        const el = t.el;
        if (el._pending || !el.complete) { busy = true; return; }
        if (el.naturalWidth > 0) loaded++;
        else missing.push(el.src);
      });
      if (typeof l.isLoading === 'function' && l.isLoading()) busy = true;
    });
    return { total, loaded, missing, done: !busy && total > 0 };
  };

  // ---------- symbole ----------
  function symbol(sidc, size) {
    const s = new ms.Symbol(sidc, { size, outlineColor: 'white', outlineWidth: 3 });
    const sz = s.getSize();
    const a = s.getAnchor();
    return { svg: s.asSVG(), w: sz.width, h: sz.height, ax: a.x, ay: a.y };
  }

  const placed = [];
  C.units.forEach((u) => {
    const hi = !!u.highlight;
    const isContact = u.kind === 'contact';
    let sym;
    try {
      sym = symbol(u.sidc, hi ? 32 : 22);
    } catch (e) {
      sym = { svg: '<svg width="20" height="20"><circle cx="10" cy="10" r="8" fill="#888"/></svg>', w: 20, h: 20, ax: 10, ay: 10 };
    }
    const ll = [u.pos[1], u.pos[0]];
    if (isContact && u.unc) {
      L.circle(ll, { radius: u.unc, color: '#d00000', weight: 2, dashArray: '7 6', fillColor: '#d00000', fillOpacity: 0.07, interactive: false }).addTo(map);
    }
    const halo = hi
      ? '<div class="halo" style="left:' + (sym.ax - 25) + 'px;top:' + (sym.ay - 25) + 'px"></div>'
      : '';
    const cls = 'lbl' + (isContact ? ' lbl-c' : '') + (u.kind === 'enemy' ? ' lbl-e' : '') + (hi ? ' lbl-h' : '');
    const html = '<div class="u" style="width:' + sym.w + 'px;height:' + sym.h + 'px">' + halo + sym.svg +
      '<span class="' + cls + '" style="top:' + (sym.h + 1) + 'px">' + u.id + '</span></div>';
    const icon = L.divIcon({ className: 'uicon', html: html, iconSize: [sym.w, sym.h], iconAnchor: [sym.ax, sym.ay] });
    L.marker(ll, { icon: icon, interactive: false, keyboard: false, zIndexOffset: hi ? 1000 : isContact ? 500 : 0 }).addTo(map);
    placed.push(u);
  });

  // ---------- nakładki (siatka pikseli, skala, północ, strzałka frontu) ----------
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, str, x, y, anchor, size) {
    const t = el('text', { x: x, y: y, 'text-anchor': anchor || 'start', class: 'gl', style: 'font-size:' + (size || 12) + 'px' }, parent);
    t.textContent = str;
    return t;
  }

  const svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, id: 'ov' });
  document.body.appendChild(svg);
  const step = C.grid;
  if (step > 0) {
    const g = el('g', {}, svg);
    const line = (x1, y1, x2, y2, major) => {
      el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#fff', 'stroke-opacity': 0.28, 'stroke-width': major ? 2.6 : 2 }, g);
      el('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: major ? '#1a1a80' : '#2a2a90', 'stroke-opacity': major ? 0.6 : 0.34, 'stroke-width': major ? 1 : 0.7 }, g);
    };
    for (let x = 0; x <= W; x += step) line(x, 0, x, H, x % 100 === 0);
    for (let y = 0; y <= H; y += step) line(0, y, W, y, y % 100 === 0);
    const lab = el('g', {}, svg);
    for (let x = 100; x <= W; x += 100) {
      text(lab, String(x), x + 3, 13, 'start', 12);
      text(lab, String(x), x + 3, H - 5, 'start', 12);
    }
    for (let y = 100; y <= H; y += 100) {
      text(lab, String(y), 4, y - 4, 'start', 12);
      text(lab, String(y), W - 4, y - 4, 'end', 12);
    }
    text(lab, '0', 4, 13, 'start', 12);
  }

  // skala
  const mpp = C.mpp;
  const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  let len = nice[0];
  nice.forEach((n) => { if (n / mpp <= 220) len = n; });
  const lenPx = len / mpp;
  const sb = el('g', { transform: 'translate(16,' + (H - 40) + ')' }, svg);
  el('rect', { x: -6, y: -22, width: lenPx + 80, height: 34, fill: '#fff', 'fill-opacity': 0.78, rx: 3 }, sb);
  el('path', { d: 'M0,0 H' + lenPx + ' M0,-6 V6 M' + lenPx + ',-6 V6 M' + (lenPx / 2) + ',-4 V4', stroke: '#000', 'stroke-width': 2.2, fill: 'none' }, sb);
  const t1 = el('text', { x: lenPx / 2, y: -9, 'text-anchor': 'middle', style: 'font:bold 12px Consolas,monospace;fill:#000' }, sb);
  t1.textContent = len >= 1000 ? (len / 1000) + ' km' : len + ' m';
  const t2 = el('text', { x: lenPx + 6, y: 4, style: 'font:11px Consolas,monospace;fill:#000' }, sb);
  t2.textContent = mpp.toFixed(1) + ' m/px';

  // północ
  const na = el('g', { transform: 'translate(' + (W - 46) + ',58)' }, svg);
  el('circle', { r: 22, fill: '#fff', 'fill-opacity': 0.78, stroke: '#000', 'stroke-width': 1 }, na);
  el('path', { d: 'M0,-17 L7,8 L0,3 L-7,8 Z', fill: '#000' }, na);
  const nt = el('text', { x: 0, y: -26, 'text-anchor': 'middle', class: 'gl', style: 'font-size:13px' }, na);
  nt.textContent = 'N';

  // strzałka frontu / zagrożenia
  if (C.facing != null) {
    const a = (C.facing * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const cx = W / 2;
    const cy = H / 2;
    const r0 = 30;
    const r1 = Math.min(W, H) * 0.26;
    const x0 = cx + dx * r0;
    const y0 = cy + dy * r0;
    const x1 = cx + dx * r1;
    const y1 = cy + dy * r1;
    const px = -dy;
    const py = dx;
    const hx = 16;
    const head = (x1 - dx * hx + px * 9) + ',' + (y1 - dy * hx + py * 9) + ' ' + x1 + ',' + y1 + ' ' + (x1 - dx * hx - px * 9) + ',' + (y1 - dy * hx - py * 9);
    const fg = el('g', { opacity: 0.8 }, svg);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round' }, fg);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#c40000', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '10 6' }, fg);
    el('polygon', { points: head, fill: '#c40000', stroke: '#fff', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, fg);
    text(fg, 'front ' + C.facing + '°', x1 + dx * 10 + (dx >= 0 ? 6 : -6), y1 + dy * 10 + 4, dx >= 0 ? 'start' : 'end', 13);
  }

  // weryfikacja zgodności rzutowania Node ↔ Leaflet
  let maxErr = 0;
  placed.forEach((u) => {
    const p = map.latLngToContainerPoint([u.pos[1], u.pos[0]]);
    maxErr = Math.max(maxErr, Math.hypot(p.x - u.px[0], p.y - u.px[1]));
  });
  const nw = map.containerPointToLatLng([0, 0]);
  const se = map.containerPointToLatLng([W, H]);
  const po = map.getPixelOrigin();
  window.__report = { maxProjectionErrorPx: maxErr, bounds: [nw.lng, se.lat, se.lng, nw.lat], pixelOrigin: [po.x, po.y] };
  window.__done = true;
})();
