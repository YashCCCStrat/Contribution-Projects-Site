/* Contribution plans viewer: several plan areas on one map, linked to one table of their projects.
   Data: window.PLANS (each built by tools/build_*.py via tools/appdata.write_app). Libraries: MapLibre GL JS, SheetJS. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const money = v => v == null || v === '' ? '' : '$' + Math.round(v).toLocaleString('en-AU');
const fmtv = (v, t) => v == null || v === '' ? '' : t === 'money' ? money(v) : t === 'num' ? (+v).toLocaleString('en-AU', {maximumFractionDigits: 4}) : t === 'ha' ? v + ' ha' : t === 'm' ? v + ' m' : t === 'pct' ? v + '%' : v;
const SNAP = window.SNAPSHOT || null;   // a Snapshot file (made with the Snapshot button): read-only, nothing kept in the browser
const MEM = {};
const store = SNAP ? {get: (k, d) => MEM[k] ?? d, set: (k, v) => { MEM[k] = v; }}
  : {get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }};

// ---------- merge the plan areas (ids prefixed with the area) ----------
const PL = window.PLANS || [];
const AREAS = PL.map(P => ({id: P.meta.id, name: P.meta.plan, short: P.meta.short, colour: P.meta.colour, source: P.meta.source, note: P.export.note}));
const D = {maps: [], images: {}, classes: {}, features: [], rows: [], tables: {}, columns: [], detail: {}, totals: [], export: PL[0].export};
const addUnique = (arr, items) => items.forEach(c => { if (!arr.some(x => x.k === c.k)) arr.push(c); });
for (const P of PL) {
  const a = P.meta.id, pre = x => x ? a + ':' + x : '';
  P.maps.forEach(m => D.maps.push({...m, id: pre(m.id), area: a}));
  Object.entries(P.images).forEach(([k, v]) => D.images[pre(k)] = v);
  Object.entries(P.classes).forEach(([k, c]) => D.classes[pre(k)] = {...c, map: pre(c.map), area: a});
  P.features.forEach(f => D.features.push({...f, properties: {...f.properties, cls: pre(f.properties.cls), map: pre(f.properties.map), area: a, ...(f.properties.key ? {key: a + ':' + f.properties.key.split('|')[0] + '|' + pre(f.properties.key.split('|')[1])} : {})}}));
  P.rows.forEach(r => D.rows.push({...r, rid: a + ':' + r.rid, map: pre(r.map), area: a, area_name: P.meta.short}));
  Object.entries(P.tables || {}).forEach(([k, t]) => D.tables[P.meta.short + ' ' + k] = t);
  addUnique(D.columns, P.columns); D.detail[a] = P.detail; addUnique(D.totals, (P.totals || []).map(t => t.k === 'total_cost_aud' ? {...t, label: 'total cost'} : t));
}
D.columns.splice(1, 0, {k: 'area_name', label: 'Plan area'});
D.columns.sort((x, y) => (x.t === 'edit') - (y.t === 'edit'));   // Land acquired and Status last
const AREA = Object.fromEntries(AREAS.map(x => [x.id, x]));
const SK = 'casey-fields-blvd-edits-v1';
let EDITS = store.get(SK, null);
if (!EDITS) { EDITS = {}; PL.forEach(P => Object.entries(store.get(P.meta.storage_key, {})).forEach(([k, v]) => EDITS[P.meta.id + ':' + k] = v)); }   // carry over earlier per-plan edits
const ROWS = D.rows.map(r => ({...r, key: r.area + ':' + r.project_id + '|' + r.map}));
// Plan figures are never edited (CLAUDE.md): on a plan's own rows only these columns can change; rows the user added are fully editable
const OWN = new Set(['acquired', 'status', 'corridor_segment']);
const canEdit = (r, k) => !!r && (r.isNew || OWN.has(k));
const val = (r, k) => (canEdit(r, k) && EDITS[r.rid] && k in EDITS[r.rid]) ? EDITS[r.rid][k] : (r[k] ?? (k === 'acquired' ? '' : r[k]));   // edits made in the app win (editable columns only)
const edited = (r, k) => canEdit(r, k) && !!EDITS[r.rid] && k in EDITS[r.rid] && String(EDITS[r.rid][k] ?? '') !== String(r[k] ?? '');
// edits to plan figures made before they were locked: set aside (not lost) and no longer applied
{ const moved = {}; let n = 0;
  for (const [rid, e] of Object.entries(EDITS)) { const r = D.rows.find(x => x.rid === rid); if (!r) continue;   // added features are not in D.rows: their edits stay
    for (const k of Object.keys(e)) if (!OWN.has(k)) { (moved[rid] ??= {})[k] = e[k]; delete e[k]; n++; }
    if (!Object.keys(e).length) delete EDITS[rid]; }
  if (n) { store.set('cfb-locked-edits-backup', {...store.get('cfb-locked-edits-backup', {}), ...moved}); store.set(SK, EDITS);
    setTimeout(() => alert(`${n} earlier edits to figures from the plans are no longer applied: plan figures are now locked. They are kept in this browser (cfb-locked-edits-backup).`), 500); } }
let EDIT = false;
D.features.forEach((f, i) => { f.id = i; });
const FBYKEY = {}; D.features.forEach(f => { if (f.properties.key) (FBYKEY[f.properties.key] ??= []).push(f); });
const rowsFor = key => ROWS.filter(r => r.key === key);
const CLS = D.classes, clsOfKey = k => (FBYKEY[k] || [])[0]?.properties.cls;
const colorOf = r => CLS[clsOfKey(r.key)]?.color || '#888';
const SINGLE = AREAS.length === 1;   // a plan's own page (croskell.html …) loads one data.js; index.html loads all of them
const AON = new Set(SINGLE ? [AREAS[0].id] : store.get('cfb-areas', AREAS.map(a => a.id)).filter(a => AREA[a]));
if (!AON.size) AREAS.forEach(a => AON.add(a.id));
// pages: one per plan, plus all plans together (add a plan here when its page is added)
const PAGES = [['croskell.html', 'Croskell ICP', 'croskell'], ['collison.html', 'Collison Estate DCP', 'collison'], ['cranbourne-east.html', 'Cranbourne East DCP', 'cranbourneeast'], ['botanic-ridge.html', 'Botanic Ridge DCP', 'botanicridge'], ['index.html', 'All plans', '']];
if (!AON.size) AREAS.forEach(a => AON.add(a.id));
const IMGON = new Set();                                   // plan maps shown as printed (image)
const MAPON = new Set(D.maps.map(m => m.id));              // plans switched on: their legend items and rows

// ---------- page ----------
document.title = 'Casey Fields Boulevard Plans';
document.body.innerHTML = `
<header class="top"><div class="brand"><div class="logo"></div><div><h1>Casey Fields Boulevard – contribution plans</h1><p>Plan maps placed on the ground, linked to each plan's project tables</p></div></div>
  <nav class="pages" id="pages"></nav><div class="areas" id="areas"></div><div class="sp"></div><span class="aibadge" title="Prepared with generative AI assistance (Claude Code, Anthropic) from public plan documents and open data, and reviewed by the owner. Shapes are approximate: check them against the gazetted plan; not for levy, works-in-kind or land-acquisition decisions. See docs/AI_USE.md.">AI-assisted · check against the gazetted plan</span>

</header>
<div id="wrap">
  <div id="map">
    <aside id="panel" class="card"><div class="hd" id="phd"><span>Plan maps &amp; layers</span><span class="chev">▾</span></div><div class="bd">
      <div class="row" style="margin-top:8px"><span class="muted" style="width:70px">Basemap</span><select id="base" style="flex:1"><option value="imagery">Imagery</option><option value="hybrid">Imagery + street names</option><option value="streets">Streets</option><option value="none">None</option></select></div>
      <div class="row" style="margin-top:8px"><span class="muted" style="width:70px" title="Transparency of the printed plans: 0% = solid, 100% = invisible">Transparency</span><input type="range" id="opac" min="0" max="95" value="35"><span id="opacV" style="width:34px;text-align:right">35%</span></div>
      <div id="lyr"></div>
      <label class="lyr" style="margin-top:8px"><input type="checkbox" id="lblOn" checked> Project ID labels</label>
    </div></aside>
    <aside id="detail" class="card hidden"></aside>
    <div id="drawbar" class="card">
      <span class="dl">Filter by drawing</span><button data-d="filter:polygon" title="Draw areas: double-click to finish each one; keep drawing to add more (a project in any of them is shown); Esc to stop">▱ Area</button><button data-d="filter:line" title="Draw lines (projects within the buffer): double-click to finish each one; keep drawing to add more; Esc to stop">⟋ Line</button>
      <label class="buf" title="Buffer around a drawn line">± <input id="bufM" type="number" value="50" min="5" step="5"> m</label>
      <span class="sep"></span><span class="dl">Add feature</span><button data-d="add:point" title="Click once">• Point</button><button data-d="add:line" title="Double-click to finish">⟋ Line</button><button data-d="add:polygon" title="Double-click to finish">▱ Polygon</button>
      <span id="drawhint" class="hint"></span></div>
    <div id="shapechip" class="card" hidden><span>Filtered by drawn shape</span><button id="shapeU" title="Remove the last drawn shape">↶</button><button id="shapeX" title="Clear all drawn shapes">✕</button></div>
  </div>
  <div id="resizer" title="Drag to resize"></div>
  <section id="bottom">
    <div class="toolbar">
      <div class="search">🔎<input id="q" placeholder="Project ID (e.g. IN02)"></div>
      <select id="mapF" title="Show the projects of one plan map"><option value="">All plan maps</option></select>
      <div class="chips" id="chips"></div>
      <div class="brk"></div>
      <label class="toggle"><input type="checkbox" id="fView"> only projects in map view</label>
      <button class="btn" id="bClear">Reset</button>
      <label class="toggle switch" title="Edit Status, Land acquired and Corridor segment (and every field of features you added). Figures from the plans are locked. Changes are kept in this browser and go into the exports."><input type="checkbox" id="editOn"><span class="sl"></span> Edit table</label>
      <button class="btn" id="bUndo" title="Discard all edits made in this browser" hidden>Discard edits</button>
      <span class="summary" id="summary"></span>
      <div class="pop" id="colPop"><button class="btn" id="bCols">Columns ▾</button><div class="menu" id="colMenu"></div></div>
      <button class="btn primary" id="bExpF" title="Excel in your register schema: the rows the table shows now (search, plan map, categories, map view and drawn-shape filters, in table order). With no filter, every row of the plan areas switched on.">Export to Excel</button>
      <button class="btn" id="bImp" title="Restore edits from a file this app made: an Excel export (all edited columns, matched by Row ID) or a Changes for repo file (edits and added shapes)">Import edits</button><input type="file" id="fImp" accept=".xlsx,.geojson,.json" hidden>
      <button class="btn" id="bChg" title="Download your edits and added features for the repository: save into gis/edit/inbox/ and push (see docs/EDITING.md)">Changes for repo</button>
      <button class="btn" id="bPdf" title="A printable map (PDF) of the rows shown – imagery, street names, the printed plan faintly underneath, your drawn shapes, legend, scale and a table of the rows – and the matching Excel file, linked">Map PDF</button>
      <button class="btn" id="bSnap" title="Save one HTML file with the map and table of the rows shown now (your drawn features and edits included), read-only, for colleagues: it opens in any browser, no repository or website needed">Snapshot</button>
      <button class="btn" id="bGis" title="Download the shapes of the rows shown, with their table attributes and your edits, as GeoJSON (opens in QGIS; save as shapefile or GeoPackage there)">GIS export</button>
    </div>
    <div id="tablewrap"><table><thead id="th"></thead><tbody id="tb"></tbody></table></div>
  </section>
</div>`;

// ---------- map ----------
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
maplibregl.addProtocol('glyphs', async p => { const k = p.url.split('/').pop().replace('.pbf', ''); return {data: window.GLYPHS?.[k] ? b64(window.GLYPHS[k]) : new ArrayBuffer(0)}; });
const ESRI = n => `https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`;
const map = new maplibregl.Map({container: 'map', attributionControl: {compact: true}, center: [145.33, -38.10], zoom: 13.5, maxZoom: 19,
  style: {version: 8, glyphs: 'glyphs://{fontstack}/{range}', sources: {
    imagery: {type: 'raster', tiles: [ESRI('World_Imagery')], tileSize: 256, maxzoom: 19, attribution: 'Esri World Imagery'},
    imageryhd: {type: 'raster', tiles: [ESRI('World_Imagery')], tileSize: 128, maxzoom: 19, attribution: 'Esri World Imagery'},   // Map PDF only: tiles one zoom level deeper (twice the detail)
    streets: {type: 'raster', tiles: [ESRI('World_Street_Map')], tileSize: 256, maxzoom: 19, attribution: 'Esri, © OpenStreetMap contributors'},
    // "Imagery + street names": Esri's reference overlays (roads with names; suburbs and places) over the imagery, as in Esri's Hybrid basemap
    roads: {type: 'raster', tiles: [ESRI('Reference/World_Transportation')], tileSize: 256, maxzoom: 19, attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors'},
    places: {type: 'raster', tiles: [ESRI('Reference/World_Boundaries_and_Places')], tileSize: 256, maxzoom: 19, attribution: 'Esri'}},
    layers: [{id: 'bg', type: 'background', paint: {'background-color': '#eef0ec'}}, {id: 'imagery', type: 'raster', source: 'imagery'}, {id: 'imageryhd', type: 'raster', source: 'imageryhd', layout: {visibility: 'none'}}, {id: 'streets', type: 'raster', source: 'streets', layout: {visibility: 'none'}},
      {id: 'roads', type: 'raster', source: 'roads', layout: {visibility: 'none'}}, {id: 'places', type: 'raster', source: 'places', layout: {visibility: 'none'}}]}});
map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
map.addControl(new maplibregl.ScaleControl({unit: 'metric'}), 'bottom-right');
const canvasImage = (draw, w = 28, h = 28) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c.getContext('2d').getImageData(0, 0, w, h); };
const ICONS = {   // plan-legend symbols: [draw, w, h, legend svg]
  cu: [x => { x.strokeStyle = '#111'; x.lineWidth = 3.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(3, 7); x.lineTo(10, 13); x.lineTo(30, 13); x.lineTo(37, 7); x.moveTo(3, 27); x.lineTo(10, 21); x.lineTo(30, 21); x.lineTo(37, 27); x.stroke(); }, 40, 34,
       '<svg width="22" height="16" viewBox="0 0 40 34"><path d="M3 7L10 13H30L37 7M3 27L10 21H30L37 27" stroke="#111" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>'],
  ped: [x => { x.fillStyle = '#fff'; x.fillRect(5, 5, 18, 18); x.fillStyle = '#a5a831'; x.fillRect(7, 7, 14, 14); x.fillStyle = '#fff'; x.fillRect(11, 11, 6, 6); }, 28, 28,
        '<svg width="16" height="16" viewBox="0 0 28 28"><rect x="5" y="5" width="18" height="18" fill="#a5a831"/><rect x="11" y="11" width="6" height="6" fill="#fff"/></svg>'],
  xing: [x => { x.strokeStyle = '#fff'; x.lineWidth = 9; x.beginPath(); x.moveTo(6, 6); x.lineTo(24, 24); x.moveTo(24, 6); x.lineTo(6, 24); x.stroke(); x.strokeStyle = '#f7941d'; x.lineWidth = 5; x.beginPath(); x.moveTo(7, 7); x.lineTo(23, 23); x.moveTo(23, 7); x.lineTo(7, 23); x.stroke(); }, 30, 30,
         '<svg width="16" height="16" viewBox="0 0 30 30"><path d="M6 6L24 24M24 6L6 24" stroke="#fff" stroke-width="9"/><path d="M7 7L23 23M23 7L7 23" stroke="#f7941d" stroke-width="5"/></svg>'],
  star: [x => { x.strokeStyle = '#e2dd23'; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; x.moveTo(17 + 13 * Math.cos(a), 17 + 13 * Math.sin(a)); x.lineTo(17 - 13 * Math.cos(a), 17 - 13 * Math.sin(a)); } x.stroke(); }, 34, 34,
         '<svg width="16" height="16" viewBox="0 0 34 34"><path d="M30 17H4M26 26L8 8M17 30V4M26 8L8 26" stroke="#e2dd23" stroke-width="5" stroke-linecap="round"/></svg>']};
const DASH = {dots: [0.1, 2], dash: [2, 1.4], long: [3, 2]};
function swatch(c) {
  if (c.kind === 'point') return ICONS[c.icon]?.[3] || `<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="${c.color}"/></svg>`;
  if (c.kind === 'line') { const da = c.dash === 'dots' ? 'stroke-dasharray="0.1 5" stroke-linecap="round"' : c.dash ? 'stroke-dasharray="5 3"' : '';
    return `<svg width="26" height="12"><path d="M2 6H24" stroke="${c.color}" stroke-width="${c.dash === 'dots' ? 4 : 3}" ${da}/>${c.arrow ? `<path d="M19 2L24 6L19 10" stroke="${c.color}" stroke-width="2" fill="none"/>` : ''}</svg>`; }
  const bg = c.pattern === 'hatch' ? `repeating-linear-gradient(135deg,${c.color} 0 4px,#111 4px 6px)` : c.color;
  return `<span style="display:block;width:24px;height:14px;border-radius:3px;background:${bg};border:1.5px solid ${c.outline || c.color}${c.style === 'outline' ? ';background:transparent;border-style:dashed' : ''}"></span>${c.icon ? `<span style="margin-left:-20px">${ICONS[c.icon][3]}</span>` : ''}`;
}
const VIS = Object.fromEntries(Object.entries(CLS).map(([k, c]) => [k, c.on !== false]));
let READY = false, SEL = null, HOV = null, DRAW = null, INSHAPE = null, SHAPES = [];   // SHAPES: the filter's drawn areas and lines (a project in any of them is shown)
const LIDS = [];   // [layer id, class]
map.on('load', () => {
  map.addSource('f', {type: 'geojson', data: {type: 'FeatureCollection', features: D.features}});
  for (const [k, im] of Object.entries(D.images)) { map.addSource('img-' + k, {type: 'image', url: im.img, coordinates: im.coords}); map.addLayer({id: 'img-' + k, type: 'raster', source: 'img-' + k, layout: {visibility: 'none'}, paint: {'raster-opacity': .65, 'raster-fade-duration': 0}}); }
  for (const [k, [draw, w, h]] of Object.entries(ICONS)) map.addImage(k, canvasImage(draw, w, h));
  const hov = ['boolean', ['feature-state', 'hover'], false], sel = ['boolean', ['feature-state', 'sel'], false], is = c => ['==', ['get', 'cls'], c];
  const hl = (n, h) => ['case', sel, h + 2, hov, h, n], hc = base => ['case', sel, '#ffb000', hov, '#2f7fbf', base];
  const rank = {fill: 0, line: 1, point: 2};
  for (const [k, c] of Object.entries(CLS).sort((a, b) => rank[a[1].kind] - rank[b[1].kind])) {
    const add = l => { map.addLayer(l); LIDS.push([l.id, k]); };
    if (c.kind === 'fill') {
      if (c.pattern === 'hatch') map.addImage('hatch-' + k, canvasImage((x, w, h) => { x.fillStyle = c.color; x.globalAlpha = .7; x.fillRect(0, 0, w, h); x.globalAlpha = 1; x.strokeStyle = '#111'; x.lineWidth = 3; for (let i = -h; i < w; i += 9) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); } }, 18, 18));
      if (c.style !== 'outline') add({id: 'c-' + k, type: 'fill', source: 'f', filter: is(k), paint: c.pattern === 'hatch' ? {'fill-pattern': 'hatch-' + k} : {'fill-color': c.color, 'fill-opacity': ['case', sel, .95, hov, .9, .78]}});
      add({id: 'c-' + k + '-o', type: 'line', source: 'f', filter: is(k), paint: {'line-color': hc(c.outline || c.color), 'line-width': hl(c.style === 'outline' ? 2 : .8, 3.5), ...(c.style === 'outline' ? {'line-dasharray': [2, 1]} : {})}});
    } else if (c.kind === 'line') {
      add({id: 'c-' + k + '-h', type: 'line', source: 'f', filter: is(k), layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': ['case', sel, '#ffb000', '#2f7fbf'], 'line-width': (c.width || 3) + 8, 'line-opacity': ['case', sel, .9, hov, .7, 0]}});
      add({id: 'c-' + k, type: 'line', source: 'f', filter: is(k), layout: {'line-cap': c.dash === 'dots' ? 'round' : 'butt', 'line-join': 'round'}, paint: {'line-color': c.color, 'line-width': c.width || 3, ...(c.dash ? {'line-dasharray': DASH[c.dash]} : {})}});
    } else {
      add({id: 'c-' + k + '-h', type: 'circle', source: 'f', filter: is(k), paint: {'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': ['case', sel, 3, hov, 3, 0], 'circle-stroke-color': ['case', sel, '#ffb000', '#2f7fbf']}});
      if (!c.icon) add({id: 'c-' + k, type: 'circle', source: 'f', filter: is(k), paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 9], 'circle-color': c.color, 'circle-stroke-color': c.outline || '#ffffff', 'circle-stroke-width': 2}});   // plain dot (e.g. pedestrian signals, added points)
      else add({id: 'c-' + k, type: 'symbol', source: 'f', filter: is(k), layout: {'icon-image': c.icon, 'icon-allow-overlap': true, 'icon-rotate': ['coalesce', ['get', 'rot'], 0], 'icon-rotation-alignment': 'map', 'icon-size': ['interpolate', ['linear'], ['zoom'], 13, .7, 16, 1.1, 18, 2]}});
    }
    if (c.icon && c.kind === 'fill') add({id: 'c-' + k + '-i', type: 'symbol', source: 'f', filter: is(k), layout: {'icon-image': c.icon, 'icon-allow-overlap': true}});
  }
  map.addLayer({id: 'labels', type: 'symbol', source: 'f', filter: ['all', ['has', 'project_id'], ['!', ['in', ['get', 'cls'], ['literal', Object.keys(CLS).filter(k => CLS[k].nolabel)]]]],   // classes marked nolabel (e.g. printed symbols) carry no label of their own
    layout: {'text-field': ['get', 'project_id'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-padding': 3}, paint: {'text-color': '#17222b', 'text-halo-color': '#fff', 'text-halo-width': 2}});
  READY = true; applyVis(); fitAll(); if (SNAP?.view) map.jumpTo(SNAP.view);
  const pickable = () => LIDS.filter(([id, k]) => !CLS[k].context && map.getLayoutProperty(id, 'visibility') !== 'none' && !id.endsWith('-i')).map(([id]) => id);
  const tip = new maplibregl.Popup({closeButton: false, closeOnClick: false, offset: 14, maxWidth: '320px'});
  map.on('mousemove', e => { if (DRAW) return;
    const f = map.queryRenderedFeatures(e.point, {layers: pickable()}).find(x => x.properties.key);
    const k = f?.properties.key || null; map.getCanvas().style.cursor = k ? 'pointer' : '';
    if (k !== HOV) setHover(k);
    if (k) { const rs = rowsFor(k); tip.setLngLat(e.lngLat).setHTML(`<b>${esc(rs[0]?.project_id)}</b> · ${esc(rs[0]?.title || '')}<div style="color:var(--muted)">${esc(rs[0]?.area_name)}</div>${rs.map(r => `<div style="color:var(--muted)">${esc(r.component)}${r.total_cost_aud ? ' · ' + money(r.total_cost_aud) : r.land_ha ? ' · ' + r.land_ha + ' ha' : ''}</div>`).join('')}`).addTo(map); }
    else tip.remove();
  });
  map.on('mouseout', () => { setHover(null); tip.remove(); });
  map.on('click', e => { if (DRAW) return; const f = map.queryRenderedFeatures(e.point, {layers: pickable()}).find(x => x.properties.key); select(f ? f.properties.key : null, {zoom: false, scroll: true}); });
  map.on('moveend', () => { if ($('fView').checked) render(); });
});
const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
const classShown = k => VIS[k] && AON.has(CLS[k].area) && (!CLS[k].map || MAPON.has(CLS[k].map));
function applyVis() {
  if (READY) { LIDS.forEach(([id, k]) => vis(id, classShown(k))); Object.keys(D.images).forEach(m => vis('img-' + m, IMGON.has(m) && MAPON.has(m) && AON.has(m.split(':')[0]))); vis('labels', $('lblOn').checked); }
  buildAreas(); buildLayerList(); buildMapFilter(); buildChips(); render();
}
// plan-area switches in the header
function buildPages() {
  if (SNAP) { $('pages').innerHTML = `<span class="snapnote" title="${esc(SNAP.note || '')}">Snapshot ${esc(SNAP.made)} · read-only${SNAP.title ? ' · ' + esc(SNAP.title) : ''}</span>`; document.title = (SNAP.title || 'Snapshot') + ' – ' + SNAP.made; return; }
  const here = SINGLE ? AREAS[0].id : '';
  $('pages').innerHTML = PAGES.map(([href, label, id]) => `<a href="${href}" class="${id === here ? 'on' : ''}" ${id === here ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  if (SINGLE) document.title = AREAS[0].name + ' – Casey Fields Boulevard';
}
buildPages();
function buildAreas() {
  if (SINGLE) { $('areas').style.display = 'none'; return; }
  $('areas').innerHTML = AREAS.map(a => { const n = ROWS.filter(r => r.area === a.id).length;
    return `<button class="area ${AON.has(a.id) ? 'on' : ''}" data-a="${a.id}" title="Show / hide ${esc(a.name)} (${n} rows: one per project and levy component)"><span class="tick" style="--c:${a.colour}">${AON.has(a.id) ? '✓' : ''}</span>${esc(a.name)}<span class="n">${n}</span></button>`; }).join('');
  $('areas').querySelectorAll('.area').forEach(b => b.onclick = () => { const a = b.dataset.a; AON.has(a) ? AON.delete(a) : AON.add(a); store.set('cfb-areas', [...AON]);
    if (SEL && !AON.has(SEL.split(':')[0])) select(null); applyVis(); fitAll(); });
}
function buildLayerList() {
  const count = k => new Set(D.features.filter(f => f.properties.cls === k && f.properties.key).map(f => f.properties.key)).size;
  const row = k => CLS[k].user && !count(k) ? '' : `<div class="lyr ${VIS[k] ? '' : 'off'} ${CLS[k].map && !MAPON.has(CLS[k].map) ? 'dis' : ''}" data-k="${k}"><span class="sw">${swatch(CLS[k])}</span><span>${esc(CLS[k].label)}</span>${count(k) ? `<span class="n">${count(k)}</span>` : ''}</div>`;
  $('lyr').innerHTML = AREAS.filter(a => AON.has(a.id)).map(a => `<div class="areahd"><span class="dot" style="background:${a.colour}"></span>${esc(a.name)}</div>` +
    D.maps.filter(m => m.area === a.id).map(m => `<div class="maphd"><label class="pm" title="Switch this plan's projects on or off (map and table)"><input type="checkbox" data-m="${m.id}" ${MAPON.has(m.id) ? 'checked' : ''}><span>${esc(m.title)}</span></label>${D.images[m.id] && MAPON.has(m.id) ? `<button class="printed ${IMGON.has(m.id) ? 'on' : ''}" data-i="${m.id}" title="Show the plan as printed, placed on the ground">🗺 ${IMGON.has(m.id) ? 'Hide' : 'Show'} printed plan</button>` : ''}${IMGON.has(m.id) && MAPON.has(m.id) ? `<div class="fit">${esc(D.images[m.id].fit.replace('boundary pixels: ', 'Placed by its boundary: ').replace(/ \(\d+ px\)/, ''))}</div>` : ''}</div>` +
      Object.keys(CLS).filter(k => CLS[k].map === m.id).map(row).join('')).join('') +
    Object.keys(CLS).filter(k => CLS[k].area === a.id && !CLS[k].map).map(row).join('')).join('') || '<div class="fit">Turn on a plan area at the top.</div>';
  $('lyr').querySelectorAll('.lyr:not(.dis)').forEach(el => el.onclick = () => { VIS[el.dataset.k] = !VIS[el.dataset.k]; applyVis(); });
  $('lyr').querySelectorAll('.printed').forEach(b => b.onclick = () => { const m = b.dataset.i; IMGON.has(m) ? IMGON.delete(m) : IMGON.add(m); applyVis(); });
  $('lyr').querySelectorAll('.pm input').forEach(cb => cb.onchange = () => { cb.checked ? MAPON.add(cb.dataset.m) : MAPON.delete(cb.dataset.m);
    if (SEL && !MAPON.has(SEL.split('|')[1])) select(null); applyVis(); });
}
function buildMapFilter() {
  const v = $('mapF').value;
  $('mapF').innerHTML = '<option value="">All plan maps</option>' + D.maps.filter(m => AON.has(m.area) && MAPON.has(m.id)).map(m => `<option value="${m.id}">${esc(AREA[m.area].short)} · ${esc(m.title)}</option>`).join('');
  $('mapF').value = [...$('mapF').options].some(o => o.value === v) ? v : '';
}
$('lblOn').onchange = applyVis;
$('phd').onclick = () => $('panel').classList.toggle('closed');
$('opac').oninput = e => {
  if (![...IMGON].some(m => MAPON.has(m) && AON.has(m.split(':')[0]))) {   // nothing printed shown yet: show the first ticked plan of each area
    AREAS.filter(a => AON.has(a.id)).forEach(a => { const m = D.maps.find(x => x.area === a.id && MAPON.has(x.id) && D.images[x.id]); if (m) IMGON.add(m.id); }); applyVis(); }
  $('opacV').textContent = e.target.value + '%'; Object.keys(D.images).forEach(m => map.setPaintProperty('img-' + m, 'raster-opacity', 1 - e.target.value / 100)); };
$('base').onchange = e => { const b = e.target.value; vis('imagery', b === 'imagery' || b === 'hybrid'); vis('streets', b === 'streets'); vis('roads', b === 'hybrid'); vis('places', b === 'hybrid'); store.set('cfb-base', b); };
{ const b = store.get('cfb-base', 'imagery'); if ([...$('base').options].some(o => o.value === b) && b !== 'imagery') { $('base').value = b; map.once('load', () => $('base').onchange({target: $('base')})); } }   // remember the basemap
function bboxOf(fs) { let b = [180, 90, -180, -90]; const w = c => typeof c[0] === 'number' ? (b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]) : c.forEach(w); fs.forEach(f => w(f.geometry.coordinates)); return b; }
function fitAll() { if (!READY) return; const fs = D.features.filter(f => f.properties.key && AON.has(f.properties.area)); if (!fs.length) return; const b = bboxOf(fs); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: {top: 40, bottom: 40, left: 320, right: 60}, duration: 500}); }

// ---------- selection ----------
const setState = (key, st, on) => (FBYKEY[key] || []).forEach(f => map.setFeatureState({source: 'f', id: f.id}, {[st]: on}));
function setHover(key) {
  if (HOV) setState(HOV, 'hover', false); HOV = key; if (key) setState(key, 'hover', true);
  document.querySelectorAll('#tb tr').forEach(tr => tr.classList.toggle('hov', !!key && tr.dataset.key === key));
}
function select(key, {zoom = true, scroll = false} = {}) {
  if (SEL) setState(SEL, 'sel', false); SEL = key; if (key) setState(key, 'sel', true);
  document.querySelectorAll('#tb tr').forEach(tr => tr.classList.toggle('sel', !!key && tr.dataset.key === key));
  if (!key) { $('detail').classList.add('hidden'); return; }
  const k = clsOfKey(key); if (k && !VIS[k]) { VIS[k] = true; applyVis(); }
  showDetail(key);
  const tr = document.querySelector(`#tb tr[data-key="${CSS.escape(key)}"]`); if (scroll && tr) tr.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  const fs = FBYKEY[key] || []; if (zoom && fs.length) { const b = bboxOf(fs); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: {top: 80, bottom: 80, left: 340, right: 420}, maxZoom: 17.5, duration: 700}); }
}
function showDetail(key) {
  const rs = rowsFor(key); if (!rs.length) return; const r = rs[0], c = CLS[clsOfKey(key)] || {}, light = ['#ffdf87', '#e2dd23', '#f7941d'].includes(c.color);
  const m = D.maps.find(x => x.id === r.map);
  $('detail').innerHTML = `<button class="x" id="dx" title="Close">✕</button><div class="dar"><span class="dot" style="background:${AREA[r.area].colour}"></span>${esc(AREA[r.area].name)}</div>
    <span class="pid" style="background:${c.color || '#555'};${light ? 'color:#222' : ''}">${esc(r.project_id)}</span> <span class="tag">${esc(r.category)}</span>
    <h2>${esc(val(r, 'title'))}</h2><div class="desc">${esc(val(r, 'description') || '')}</div>` +
    rs.map(x => `<dl>${D.detail[x.area].map(f => { const v = val(x, f.k); return v == null || v === '' ? '' : `<dt>${esc(f.label)}</dt><dd>${esc(fmtv(v, f.t))}</dd>`; }).join('')}
      <dt>Land acquired</dt><dd>${esc(val(x, 'acquired')) || '<span style="color:var(--muted)">–</span>'}</dd><dt>Status</dt><dd style="text-align:left">${esc(val(x, 'status'))}</dd></dl>`).join('') +
    `<div class="actions"><button class="btn" id="dz">Zoom to</button>${m && D.images[m.id] ? `<button class="btn" id="dm">${IMGON.has(m.id) ? 'Hide' : 'Show'} plan map</button>` : ''}${NEW.some(n => n.key === key) ? '<button class="btn" id="ddel" style="color:#b0103d">Delete added shape</button>' : ''}</div>
    <div class="fit" style="margin-top:8px">${esc(m ? m.title : '')}${(FBYKEY[key] || []).length ? '' : ' · not drawn on the plan map'}</div>`;
  $('detail').classList.remove('hidden'); $('dx').onclick = () => select(null); $('dz').onclick = () => select(key, {zoom: true});
  if ($('ddel')) $('ddel').onclick = () => { if (confirm('Delete the shape(s) you added for ' + r.project_id + '?')) delNew(key); };
  if ($('dm')) $('dm').onclick = () => { IMGON.has(m.id) ? IMGON.delete(m.id) : IMGON.add(m.id); MAPON.add(m.id); applyVis(); showDetail(key); };
}

// ---------- table, filters, columns ----------
const COLS = D.columns.map(c => ({...c, show: store.get('cfb-cols', null)?.[c.k] ?? (c.show !== false)}));
let CATON = new Set();
function buildChips() {
  const cats = [...new Set(ROWS.filter(r => AON.has(r.area)).map(r => r.category))];
  CATON = new Set([...CATON].filter(c => cats.includes(c)));
  $('chips').innerHTML = cats.map(c => `<button class="chip ${CATON.has(c) ? 'on' : ''}" data-c="${esc(c)}"><span class="dot" style="background:${colorOf(ROWS.find(x => x.category === c && AON.has(x.area)))}"></span>${esc(c)}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(b => b.onclick = () => { const c = b.dataset.c; CATON.has(c) ? CATON.delete(c) : CATON.add(c); b.classList.toggle('on'); render(); });
}
function colMenu() {
  $('colMenu').innerHTML = COLS.map((c, i) => `<label><input type="checkbox" data-i="${i}" ${c.show ? 'checked' : ''}> ${esc(c.label)}</label>`).join('');
  $('colMenu').querySelectorAll('input').forEach(cb => cb.onchange = () => { COLS[cb.dataset.i].show = cb.checked; store.set('cfb-cols', Object.fromEntries(COLS.map(c => [c.k, c.show]))); render(); });
}
$('bCols').onclick = e => { e.stopPropagation(); colMenu(); const r = $('bCols').getBoundingClientRect(), m = $('colMenu'); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.min(r.left, window.innerWidth - 236) + 'px'; m.style.maxHeight = (window.innerHeight - r.bottom - 20) + 'px'; $('colPop').classList.toggle('open'); };
document.addEventListener('click', e => { if (!$('colPop').contains(e.target)) $('colPop').classList.remove('open'); });
let SORT = {k: null, dir: 1};
function filtered() {
  const q = $('q').value.trim().toLowerCase(), mf = $('mapF').value; let inView = null;
  if ($('fView').checked && READY) { const b = map.getBounds(); inView = new Set(); D.features.forEach(f => { if (!f.properties.key) return; const x = bboxOf([f]); if (x[2] >= b.getWest() && x[0] <= b.getEast() && x[3] >= b.getSouth() && x[1] <= b.getNorth()) inView.add(f.properties.key); }); }
  let rs = ROWS.filter(r => AON.has(r.area) && MAPON.has(r.map) && (!q || r.project_id.toLowerCase().includes(q)) && (!CATON.size || CATON.has(r.category)) && (!mf || r.map === mf) && (!inView || inView.has(r.key)) && (!INSHAPE || INSHAPE.has(r.key)));
  if (SORT.k) rs = rs.slice().sort((a, b) => { const x = val(a, SORT.k), y = val(b, SORT.k); return (typeof x === 'number' || typeof y === 'number' ? (x ?? -1) - (y ?? -1) : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true})) * SORT.dir; });
  return rs;
}
function render() {
  const rs = filtered(); shapeChip(); const keys = [...new Set(rs.map(r => r.key))], cols = COLS.filter(c => c.show);
  $('th').innerHTML = '<tr>' + cols.map(c => `<th data-k="${c.k}" class="${['money', 'num'].includes(c.t) ? 'num' : ''}">${esc(c.label)}${SORT.k === c.k ? (SORT.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>';
  $('th').querySelectorAll('th').forEach(th => th.onclick = () => { SORT = {k: th.dataset.k, dir: SORT.k === th.dataset.k ? -SORT.dir : 1}; render(); });
  $('tb').innerHTML = rs.length ? rs.map(r => `<tr data-key="${esc(r.key)}" data-rid="${esc(r.rid)}" class="${r.key === SEL ? 'sel' : ''}">` + cols.map(c =>
      (c.t === 'edit' || EDIT) && c.k !== 'area_name' && canEdit(r, c.k) ? `<td class="edit ${edited(r, c.k) ? 'chg' : ''} ${['money', 'num'].includes(c.t) ? 'num' : ''}" title="${edited(r, c.k) ? 'Edited – plan value: ' + esc(fmtv(r[c.k], c.t)) : ''}"><input data-f="${c.k}" data-t="${c.t || ''}" value="${esc(val(r, c.k) ?? '')}" placeholder="${c.k === 'acquired' ? (r.land_ha != null ? 'Yes / No / part' : '') : ''}"></td>`
      : c.t === 'id' ? `<td class="id"><i style="background:${colorOf(r)}"></i>${esc(r.project_id)}</td>`
      : c.k === 'area_name' ? `<td><span class="atag" style="--c:${AREA[r.area].colour}">${esc(r.area_name)}</span></td>`
      : c.k === 'component' ? `<td><span class="tag">${esc(r.component)}</span></td>`
      : `<td class="${['money', 'num'].includes(c.t) ? 'num' : ''} ${edited(r, c.k) ? 'chg' : ''} ${EDIT && c.k !== 'area_name' && c.t !== 'id' ? 'locked' : ''}" ${EDIT && c.k !== 'area_name' ? 'title="From the plan – not editable"' : ''}>${esc(fmtv(val(r, c.k), c.t))}</td>`).join('') + '</tr>').join('')
    : `<tr><td class="empty" colspan="${cols.length}">${AON.size ? 'No projects match. <a href="#" id="rst">Reset filters</a>' : 'Turn on Croskell or Collison Estate at the top.'}</td></tr>`;
  // a project's total cost is printed on each of its levy rows (Croskell CK-RD-01: standard and supplementary), so it is counted once per project
  const sumOf = k => { const seen = new Set(); return rs.reduce((a, r) => { if (k === 'total_cost_aud') { const u = r.area + '|' + r.project_id + '|' + r.map; if (seen.has(u)) return a; seen.add(u); } return a + (+val(r, k) || 0); }, 0); };
  const tot = (D.totals || []).filter(t => rs.some(r => r[t.k] != null)).map(t => `${t.label} <b>${fmtv(sumOf(t.k), t.t)}</b>`).join(' · ');
  const nEd = Object.values(EDITS).reduce((a, e) => a + Object.keys(e).length, 0); $('bUndo').hidden = !nEd; $('bUndo').textContent = `Discard edits (${nEd})`;
  $('summary').innerHTML = `<b>${rs.length}</b> of ${ROWS.filter(r => AON.has(r.area)).length} rows${tot ? ' · ' + tot : ''}`;
  if (READY) LIDS.concat([['labels', null]]).forEach(([id, k]) => { if (k && CLS[k].context) return; const base = k ? ['==', ['get', 'cls'], k] : ['has', 'project_id'];
    map.setFilter(id, ['all', base, ['any', ['!', ['has', 'key']], ['in', ['get', 'key'], ['literal', keys]]], ...(k ? [] : [['in', ['get', 'cls'], ['literal', Object.keys(CLS).filter(c => classShown(c) && !CLS[c].nolabel)]]])]); });
  $('tb').querySelectorAll('tr[data-key]').forEach(tr => {
    tr.onmouseenter = () => setHover(tr.dataset.key); tr.onmouseleave = () => setHover(null);
    tr.onclick = e => { if (e.target.tagName !== 'INPUT') select(tr.dataset.key === SEL ? null : tr.dataset.key); };
    tr.querySelectorAll('input').forEach(inp => inp.onchange = () => { const r = ROWS.find(x => x.rid === tr.dataset.rid), k = inp.dataset.f;
      let v = inp.value.trim(); if (['money', 'num'].includes(inp.dataset.t)) { const n = parseFloat(v.replace(/[$,\s%]/g, '')); v = v === '' ? null : isNaN(n) ? v : n; }
      if (String(v ?? '') === String(r[k] ?? '')) { if (EDITS[r.rid]) { delete EDITS[r.rid][k]; if (!Object.keys(EDITS[r.rid]).length) delete EDITS[r.rid]; } } else (EDITS[r.rid] ??= {})[k] = v;
      store.set(SK, EDITS); render(); if (SEL === tr.dataset.key) showDetail(SEL); });
  });
  $('rst')?.addEventListener('click', e => { e.preventDefault(); reset(); });
}
function reset() { clearShape(); $('q').value = ''; $('mapF').value = ''; CATON = new Set(); $('fView').checked = false; select(null); buildChips(); render(); fitAll(); }
$('editOn').onchange = e => { EDIT = e.target.checked; document.body.classList.toggle('editing', EDIT); render(); };
$('bUndo').onclick = () => { if (confirm('Discard all edits made in this browser? (Export to Excel first if you want to keep them.)')) { EDITS = {}; store.set(SK, EDITS); render(); if (SEL) showDetail(SEL); } };
$('q').oninput = render; $('fView').onchange = render; $('mapF').onchange = render; $('bClear').onclick = reset;
(() => { const bt = $('bottom'), h0 = store.get('cfb-h', null); if (h0) bt.style.height = h0 + 'px'; let y0, hh;
  $('resizer').onmousedown = e => { y0 = e.clientY; hh = bt.offsetHeight; const mv = ev => { bt.style.height = Math.max(110, Math.min(window.innerHeight - 220, hh - (ev.clientY - y0))) + 'px'; map.resize(); };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); store.set('cfb-h', bt.offsetHeight); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); }; })();

// ---------- Excel ----------
function printedTwice(rows) {   // a project printed in full in more than one table (e.g. Croskell CK-RD-01, standard and supplementary levy): warn, figures stay as printed
  const g = {}; rows.forEach(r => { if (r.total_cost_aud == null) return; (g[r.area + '|' + r.project_id + '|' + r.map] ??= []).push(r); });
  const dup = Object.values(g).filter(rs => rs.length > 1 && rs.every(r => +r.total_cost_aud === +rs[0].total_cost_aud));
  if (!dup.length) return [];
  const all = rows.reduce((a, r) => a + (+val(r, 'construction_cost_aud') || 0), 0), extra = dup.reduce((a, rs) => a + (rs.length - 1) * (+rs[0].construction_cost_aud || 0), 0);
  return [['Printed twice', dup.map(rs => `${rs[0].project_id} is printed in full in ${rs.length} tables (${rs.map(r => r.table).join(', ')}): ${money(rs[0].total_cost_aud)} on each row, as printed. It is one project – count it once.`).join(' ')],
          ['Construction sum', `Adding the Construction cost column gives ${money(all)}; counting each project once gives ${money(all - extra)}.`]];
}
function exportXlsx(rows, label, opt = {}) {   // opt: {file, map: 'Map 1 – title', pdf: 'file.pdf'} when made with a Map PDF
  // the owner's register layout, plus "Construction / land" after "Levy component" (owner's request, 2026-11-12)
  const E = D.export, at = E.fields.indexOf('component') + 1, ins = (a, x) => [...a.slice(0, at), x, ...a.slice(at)];
  const aoa = [ins(E.columns, 'Construction / land')], today = new Date().toISOString().slice(0, 10);
  const fieldsOf = r => ins(PL.find(P => P.meta.id === r.area).export.fields, 'type');
  rows.forEach(r => aoa.push(fieldsOf(r).map(f => { const v = f.includes('{') ? f.replace(/\{(\w+)\}/g, (_, k) => val(r, k) ?? '').replace(/ – $/, '') : val(r, f); return v === '' || v == null ? null : v; })));
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = ins(E.widths, 18).map(w => ({wch: w}));
  const colOf = f => XLSX.utils.encode_col(fieldsOf(rows[0] || {area: PL[0].meta.id}).indexOf(f));   // number formats follow the columns
  for (let i = 2; i <= aoa.length; i++) { for (const c of [colOf('land_cost_aud'), colOf('construction_cost_aud')]) if (ws[c + i]) ws[c + i].z = '"$"#,##0.00'; if (ws[colOf('land_ha') + i]) ws[colOf('land_ha') + i].z = '0.0000'; }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, ('project-register-' + today).slice(0, 31));
  const det = rows.map(r => Object.fromEntries([['Row ID', r.rid], ...D.columns.map(c => [c.label, val(r, c.k)])]));
  const wd = XLSX.utils.json_to_sheet(det); wd['!cols'] = Object.keys(det[0] || {}).map(k => ({wch: Math.max(10, Math.min(40, k.length + 4))})); XLSX.utils.book_append_sheet(wb, wd, 'Details');
  const areasIn = new Set(rows.map(r => r.area_name));
  for (const [k, t] of Object.entries(D.tables)) if ([...areasIn].some(a => k.startsWith(a + ' '))) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t), k.slice(0, 31));
  const n = XLSX.utils.aoa_to_sheet([['Casey Fields Boulevard – contribution plans: project register export'], ['Exported', today], ['Rows', rows.length + ' (' + label + ')'],
    ['Plan areas', [...areasIn].join(', ')],
    ['Filters', filterText() || 'none'],
    ...(opt.map ? [['Map', opt.map], ['Map PDF', opt.pdf + ' (same rows; keep the two files together in one folder – the link opens it)']] : []),
    ...AREAS.filter(a => [...areasIn].includes(a.short)).map(a => [a.short, a.source + (a.note ? ' – ' + a.note : '')]),
    ['AI use', 'Prepared with generative AI assistance (Claude Code, Anthropic) from public plan documents and open data, and reviewed by the owner. Shapes are approximate: check them against the gazetted plan; not for levy, works-in-kind or land-acquisition decisions. See docs/AI_USE.md.'],
    ...printedTwice(rows),
    ['Edits', 'Values edited in the app are used throughout (Details sheet shows every column). "Import edits" restores them from this file.']]);
  n['!cols'] = [{wch: 14}, {wch: 120}]; XLSX.utils.book_append_sheet(wb, n, 'About');
  if (opt.pdf) for (const [addr, cell] of Object.entries(n)) if (addr[0] === 'B' && typeof cell.v === 'string' && cell.v.startsWith(opt.pdf)) cell.l = {Target: opt.pdf, Tooltip: 'Open the map PDF'};
  XLSX.writeFile(wb, opt.file || `casey-fields-blvd-projects-${today}.xlsx`);
}
function filterText() {   // the table's filters in words (Excel About sheet, map PDF)
  const off = D.maps.filter(m => AON.has(m.area) && !MAPON.has(m.id)).map(m => m.title.split(' · ')[0]);
  const nA = SHAPES.filter(x => !x.line).length, nL = SHAPES.length - nA;
  return [$('q').value && 'ID "' + $('q').value + '"', $('mapF').value && 'plan map: ' + $('mapF').selectedOptions[0].text, CATON.size && 'categories: ' + [...CATON].join(', '), $('fView').checked && 'in map view',
    SHAPES.length && 'drawn on the map: ' + [nA && nA + ' area' + (nA > 1 ? 's' : ''), nL && nL + ' line' + (nL > 1 ? 's' : '') + ' (± ' + [...new Set(SHAPES.filter(x => x.line).map(x => x.buf))].join(' / ') + ' m)'].filter(Boolean).join(' and ') + ' – projects touching any of them',
    off.length && 'plan maps off: ' + off.join(', ')].filter(Boolean).join('; ');
}
$('bExpF').onclick = () => { const rs = filtered(); exportXlsx(rs, rs.length === ROWS.filter(r => AON.has(r.area)).length ? 'all rows of the plan areas shown' : 'rows shown by the table filters'); };
$('bGis').onclick = () => {   // GeoJSON: every project shape with its table attributes (edits included), one feature per table row; opens in QGIS
  const rows = filtered(), today = new Date().toISOString().slice(0, 10), out = [];
  rows.forEach(r => (FBYKEY[r.key] || []).forEach(f => { const p = {plan_area: AREA[r.area].name, plan_map: D.maps.find(m => m.id === r.map)?.title || '', legend: CLS[f.properties.cls]?.label, row_id: r.rid.split(':').slice(1).join(':')};
    D.columns.forEach(c => { if (c.k !== 'area_name') p[c.k] = val(r, c.k) ?? null; }); out.push({type: 'Feature', properties: p, geometry: f.geometry}); }));
  const blob = new Blob([JSON.stringify({type: 'FeatureCollection', name: 'casey_fields_blvd_projects', crs: {type: 'name', properties: {name: 'urn:ogc:def:crs:OGC:1.3:CRS84'}}, features: out})], {type: 'application/geo+json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `casey-fields-blvd-projects-${today}.geojson`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('bImp').onclick = () => $('fImp').click();
$('fImp').onchange = async e => { const f = e.target.files[0]; if (!f) return;
  if (/\.(geo)?json$/i.test(f.name)) { importChanges(JSON.parse(await f.text()), f.name); e.target.value = ''; return; }
  const wb = XLSX.read(await f.arrayBuffer()); let n = 0, miss = 0, locked = 0;
  if (!wb.Sheets.Details) { alert(`${f.name} has no "Details" sheet: only Excel files exported from this app can be imported.`); e.target.value = ''; return; }
  (wb.Sheets.Details ? XLSX.utils.sheet_to_json(wb.Sheets.Details) : []).forEach(r => { let rid = r['Row ID']; if (rid && !ROWS.some(x => x.rid === rid)) rid = ROWS.find(x => x.rid.endsWith(':' + rid))?.rid;
    const row = ROWS.find(x => x.rid === rid); if (!row) { miss++; return; } const e = {};
    D.columns.forEach(c => { if (!(c.label in r) || c.k === 'area_name') return; if (!canEdit(row, c.k)) { if (String(r[c.label] ?? '') !== String(row[c.k] ?? '')) locked++; return; } let v = r[c.label]; if (v === '' ) v = null; if (String(v ?? '') !== String(row[c.k] ?? '')) e[c.k] = v; });
    if (Object.keys(e).length) { EDITS[rid] = e; n++; } });
  store.set(SK, EDITS); render(); if (SEL) showDetail(SEL); alert(`${n} rows with edits restored from ${f.name}` + (miss ? ` · ${miss} rows not found here (e.g. added features: import their Changes for repo file instead)` : '') + (locked ? ` · ${locked} changed plan figures ignored (figures from the plans are locked)` : '')); e.target.value = ''; };
// ---------- drawing: filter by a drawn shape, add new features ----------
const NEWK = 'cfb-new-features-v1'; let NEW = store.get(NEWK, []);
function addNew(n) {
  const a = n.area, key = n.key = `${a}:${n.row.project_id}|${n.map}`, exists = ROWS.find(r => r.key === key);
  if (!exists) ROWS.push({...n.row, rid: n.rid, map: n.map, area: a, area_name: AREA[a].short, key, isNew: true});
  const f = {type: 'Feature', id: D.features.length, properties: {cls: n.cls, map: n.map, area: a, project_id: n.row.project_id, key, isNew: 1}, geometry: n.geometry};
  D.features.push(f); (FBYKEY[key] ??= []).push(f);
}
NEW.forEach(addNew);
function delNew(key) {   // removes shapes added in this browser for the key, and the row if it was new
  NEW = NEW.filter(n => n.key !== key); store.set(NEWK, NEW);
  for (let i = D.features.length - 1; i >= 0; i--) if (D.features[i].properties.isNew && D.features[i].properties.key === key) D.features.splice(i, 1);
  D.features.forEach((f, i) => { f.id = i; }); FBYKEY[key] = (FBYKEY[key] || []).filter(f => !f.properties.isNew); if (!FBYKEY[key].length) delete FBYKEY[key];
  for (let i = ROWS.length - 1; i >= 0; i--) if (ROWS[i].isNew && ROWS[i].key === key) { delete EDITS[ROWS[i].rid]; ROWS.splice(i, 1); }
  store.set(SK, EDITS); map.removeFeatureState({source: 'f'}); map.getSource('f').setData({type: 'FeatureCollection', features: D.features}); select(null); buildLayerList(); buildChips(); render();
}
map.on('load', () => {
  map.addSource('drawn', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  // filter shapes: bright cyan on a dark outline – no plan layer uses cyan (boundaries are navy, added features magenta), and the outline keeps it clear over imagery, printed plans and labels
  map.addLayer({id: 'drawn-fill', type: 'fill', source: 'drawn', filter: ['==', ['geometry-type'], 'Polygon'], paint: {'fill-color': '#00e5ff', 'fill-opacity': .16}});
  map.addLayer({id: 'drawn-buf', type: 'line', source: 'drawn', filter: ['has', 'buf'], paint: {'line-color': '#00b8d4', 'line-width': 1.5}});
  map.addLayer({id: 'drawn-case', type: 'line', source: 'drawn', filter: ['!', ['has', 'buf']], layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {'line-color': '#062a33', 'line-width': 6, 'line-opacity': .85}});
  map.addLayer({id: 'drawn-line', type: 'line', source: 'drawn', filter: ['!', ['has', 'buf']], layout: {'line-join': 'round'}, paint: {'line-color': '#00e5ff', 'line-width': 3, 'line-dasharray': [2.2, 1.2]}});
  map.addLayer({id: 'drawn-pt', type: 'circle', source: 'drawn', filter: ['==', ['geometry-type'], 'Point'], paint: {'circle-radius': 5, 'circle-color': '#00e5ff', 'circle-stroke-color': '#062a33', 'circle-stroke-width': 2.5}});
  if (NEW.length) map.getSource('f').setData({type: 'FeatureCollection', features: D.features});
});
const showDrawn = fs => map.getSource('drawn') && map.getSource('drawn').setData({type: 'FeatureCollection', features: fs});
function sketch(cursor) {
  if (!DRAW) return showDrawn(shapeFs()); const p = DRAW.pts.concat(cursor ? [cursor] : []), fs = p.map(c => turf.point(c));
  if (DRAW.kind === 'polygon' && p.length >= 3) fs.push(turf.polygon([[...p, p[0]]])); else if (p.length >= 2) fs.push(turf.lineString(p));
  showDrawn([...shapeFs(), ...fs]);
}
function startDraw(mode, kind) {
  cancelDraw(); DRAW = {mode, kind, pts: []}; map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair';
  document.querySelectorAll('#drawbar button').forEach(b => b.classList.toggle('on', b.dataset.d === mode + ':' + kind));
  $('drawhint').textContent = kind === 'point' ? 'Click on the map · Esc to cancel' : `Click to add points · double-click or Enter to finish · Esc to cancel`;
}
function cancelDraw() { DRAW = null; map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; document.querySelectorAll('#drawbar button').forEach(b => b.classList.remove('on')); $('drawhint').textContent = ''; showDrawn(shapeFs()); }
function finishDraw() {
  const d = DRAW; if (!d) return; const p = d.pts;
  if ((d.kind === 'line' && p.length < 2) || (d.kind === 'polygon' && p.length < 3)) return;
  const geom = d.kind === 'point' ? {type: 'Point', coordinates: p[0]} : d.kind === 'line' ? {type: 'LineString', coordinates: p} : {type: 'Polygon', coordinates: [[...p, p[0]]]};
  cancelDraw();
  if (d.mode === 'filter') { applyShape(geom); startDraw('filter', d.kind); $('drawhint').textContent = `${SHAPES.length} drawn · draw another ${d.kind === 'line' ? 'line' : 'area'} to add to the filter · Esc to stop drawing`; }   // stays on: several shapes in a row
  else addForm(geom, d.kind);
}
document.querySelectorAll('#drawbar button').forEach(b => b.onclick = () => { const [m, k] = b.dataset.d.split(':'); DRAW && b.classList.contains('on') ? cancelDraw() : startDraw(m, k); });
map.on('click', e => { if (!DRAW) return; DRAW.pts.push([e.lngLat.lng, e.lngLat.lat]); if (DRAW.kind === 'point') finishDraw(); else sketch(); });
map.on('dblclick', e => { if (DRAW) { e.preventDefault(); DRAW.pts.pop(); finishDraw(); } });
map.on('mousemove', e => { if (DRAW && DRAW.pts.length) sketch([e.lngLat.lng, e.lngLat.lat]); });
document.addEventListener('keydown', e => { if (!DRAW) return; if (e.key === 'Escape') cancelDraw(); if (e.key === 'Enter') finishDraw(); });
function shapeFs() { return SHAPES.flatMap(x => x.line ? [{...x.area, properties: {buf: 1}}, x.line] : [x.area]); }   // a line's buffer is drawn lighter than the line
function applyShapes() {   // projects touching any drawn shape
  if (!SHAPES.length) { INSHAPE = null; $('shapechip').hidden = true; showDrawn(DRAW ? [] : shapeFs()); return; }
  INSHAPE = new Set(D.features.filter(f => f.properties.key && AON.has(f.properties.area) && SHAPES.some(x => turf.booleanIntersects(f, x.area))).map(f => f.properties.key));
  showDrawn(shapeFs()); $('shapechip').hidden = false;
}
// the chip names the drawn shapes only; the table bar gives the count (owner: counts here were confusing)
function shapeChip() {
  if (!SHAPES.length) return;
  const nA = SHAPES.filter(x => !x.line).length, nL = SHAPES.length - nA, pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  $('shapechip').querySelector('span').textContent = SHAPES.length === 1 ? `Filtered by drawn ${nL ? 'line (± ' + SHAPES[0].buf + ' m)' : 'area'}` : `Filtered by ${[nA && pl(nA, 'area'), nL && pl(nL, 'line')].filter(Boolean).join(' and ')}`;
}

function applyShape(geom) {
  const buf = Math.max(1, +$('bufM').value || 50);
  SHAPES.push(geom.type === 'LineString' ? {area: turf.buffer(turf.lineString(geom.coordinates), buf, {units: 'meters'}), line: turf.lineString(geom.coordinates), buf} : {area: turf.polygon(geom.coordinates)});
  applyShapes(); render();
}
function clearShape() { SHAPES = []; INSHAPE = null; $('shapechip').hidden = true; showDrawn([]); }
$('shapeX').onclick = () => { clearShape(); render(); };
$('shapeU').onclick = () => { SHAPES.pop(); applyShapes(); render(); };
const KIND = {point: 'point', line: 'line', polygon: 'fill'}, GT = {point: 'points', line: 'lines', polygon: 'polygons'};
function addForm(geom, kind) {
  const areas = AREAS.filter(a => AON.has(a.id)); if (!areas.length) return alert('Turn on a plan area first.');
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const dl = (id, k) => `<datalist id="${id}">${[...new Set(ROWS.map(r => r[k]).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const m = document.createElement('div'); m.id = 'modal'; m.innerHTML = `<div class="dlg card"><h2>New ${kind}: project details</h2><p class="fit">A new row is added to the table. It is kept in this browser until you send it to the repository with “Changes for repo”.</p>
    <div class="grid"><label>Plan area<select id="nA">${areas.map(a => opt(a.id, a.name)).join('')}</select></label><label>Plan map<select id="nM"></select></label>
    <label>Legend class<select id="nC"></select></label><label>Project ID *<input id="nId" placeholder="e.g. RD07 or CK-RD-02" list="dlId"></label>
    <label>Category<input id="nCat" list="dlCat"></label><label>Levy component<input id="nComp" list="dlComp"></label>
    <label class="w">Title *<input id="nT"></label><label class="w">Description<input id="nD"></label>
    <label>Land (ha)<input id="nHa" type="number" step="0.0001"></label><label>Total cost ($)<input id="nCost" type="number" step="1"></label>
    <label>Land acquired<input id="nAcq" placeholder="Yes / No / part"></label><label>Status<input id="nSt" value="Proposed – added by user"></label></div>
    ${dl('dlCat', 'category')}${dl('dlComp', 'component')}${dl('dlId', 'project_id')}<p class="fit" id="nMsg"></p>
    <div class="actions" style="justify-content:flex-end"><button class="btn" id="nCancel">Cancel</button><button class="btn primary" id="nSave">Add to table</button></div></div>`;
  document.body.appendChild(m);
  const fillMaps = () => { const a = $('nA').value; $('nM').innerHTML = D.maps.filter(x => x.area === a).map(x => opt(x.id, x.title)).join(''); fillCls(); };
  const fillCls = () => { const mp = $('nM').value, ks = Object.keys(CLS).filter(k => CLS[k].map === mp && CLS[k].kind === KIND[kind] && !CLS[k].context);
    $('nC').innerHTML = ks.map(k => opt(k, CLS[k].label, CLS[k].user)).join(''); };
  $('nA').onchange = fillMaps; $('nM').onchange = fillCls; fillMaps();
  $('nId').oninput = () => { const a = $('nA').value, r = ROWS.find(x => x.area === a && x.project_id === $('nId').value.trim());
    $('nMsg').textContent = r ? `${r.project_id} already exists (${r.title}) – this shape will be added to it${r.map !== $('nM').value ? ' on a different plan map, as a new row' : ''}.` : ''; if (r && !$('nT').value) { $('nT').value = r.title || ''; $('nCat').value = r.category || ''; } };
  $('nCancel').onclick = () => { m.remove(); };
  $('nSave').onclick = () => {
    const a = $('nA').value, mp = $('nM').value, id = $('nId').value.trim(), t = $('nT').value.trim();
    if (!id || !t) { $('nMsg').textContent = 'Project ID and title are required.'; return; }
    const num = v => v === '' ? null : +v;
    const row = {project_id: id, title: t, description: $('nD').value.trim(), category: $('nCat').value.trim() || 'Added feature', component: $('nComp').value.trim() || 'To be confirmed',
      land_ha: num($('nHa').value), total_cost_aud: num($('nCost').value), construction_cost_aud: num($('nCost').value), status: $('nSt').value.trim(), plan: AREA[a].name, table: 'Added by user'};
    const n = {area: a, map: mp, cls: $('nC').value || `${mp}_added_${GT[kind]}`, rid: `${a}:${id}|${mp.split(':')[1]}|added`, row, geometry: geom};
    if ($('nAcq').value.trim()) (EDITS[n.rid] ??= {}).acquired = $('nAcq').value.trim(), store.set(SK, EDITS);
    NEW.push(n); store.set(NEWK, NEW); addNew(n); map.getSource('f').setData({type: 'FeatureCollection', features: D.features});
    m.remove(); buildLayerList(); buildChips(); applyVis(); render(); select(`${a}:${id}|${mp}`, {zoom: false, scroll: true});
  };
  $('nId').focus();
}
function importChanges(fc, name) {   // a "Changes for repo" file: restores edits and added shapes (e.g. in another browser)
  let ne = 0, nn = 0, skip = 0, lockd = 0;
  (fc.features || []).forEach(ft => { const p = {...ft.properties}, a = p.area, kind = p.change; if (!AREA[a]) { skip++; return; }
    if (kind === 'edit') { const rid = a + ':' + p.rid; if (!ROWS.some(r => r.rid === rid)) { skip++; return; }
      ['change', 'area', 'rid'].forEach(k => delete p[k]); const row = ROWS.find(r => r.rid === rid);
      Object.keys(p).forEach(k => { if (!canEdit(row, k)) { delete p[k]; lockd++; } }); if (Object.keys(p).length) { EDITS[rid] = {...(EDITS[rid] || {}), ...p}; ne++; } return; }
    if (kind === 'new' && ft.geometry) { const rid = a + ':' + p.rid; if (NEW.some(n => n.rid === rid && JSON.stringify(n.geometry) === JSON.stringify(ft.geometry))) { skip++; return; }
      const map = a + ':' + p.map, cls = a + ':' + p.cls; ['change', 'area', 'rid', 'map', 'cls'].forEach(k => delete p[k]);
      const n = {area: a, map, cls: CLS[cls] ? cls : `${map}_added_${GT[{Point: 'point', LineString: 'line', Polygon: 'polygon'}[ft.geometry.type]]}`, rid, row: p, geometry: ft.geometry};
      NEW.push(n); addNew(n); nn++; } else skip++; });
  store.set(SK, EDITS); store.set(NEWK, NEW); map.getSource('f').setData({type: 'FeatureCollection', features: D.features});
  buildLayerList(); buildChips(); applyVis(); render(); alert(`${name}: ${ne} edited rows and ${nn} added shapes restored` + (skip ? ` · ${skip} skipped (already here or not found)` : '') + (lockd ? ` · ${lockd} plan figures ignored (locked)` : ''));
}
$('bChg').onclick = () => {   // edits + added features, for gis/edit/inbox/ (applied to the GeoPackage by the GitHub Action)
  const out = [], today = new Date().toISOString().slice(0, 10), strip = rid => rid.split(':').slice(1).join(':');
  NEW.forEach(n => out.push({type: 'Feature', geometry: n.geometry, properties: {change: 'new', area: n.area, map: n.map.split(':')[1], cls: n.cls.split(':').slice(1).join(':'), rid: strip(n.rid), ...n.row, ...(EDITS[n.rid] || {})}}));
  Object.entries(EDITS).forEach(([rid, e0]) => { const row = ROWS.find(r => r.rid === rid), e = Object.fromEntries(Object.entries(e0).filter(([k]) => canEdit(row, k))); if (!NEW.some(n => n.rid === rid) && Object.keys(e).length) out.push({type: 'Feature', geometry: null, properties: {change: 'edit', area: rid.split(':')[0], rid: strip(rid), ...e}}); });
  if (!out.length) return alert('No edits or added features yet.');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({type: 'FeatureCollection', features: out}, null, 1)], {type: 'application/geo+json'}));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-') + '-' + Math.random().toString(36).slice(2, 6);   // unique: two people saving the same day do not collide
  a.download = `changes-${stamp}.geojson`; a.click();
  const site = /github\.io$/.test(location.hostname);   // the public website: visitors cannot push to the repository
  alert(`${out.length} changes saved in ${a.download}. ` + (site
    ? 'Send this file to the project owner (it holds only your status / land-acquired notes and any features you drew). Your changes stay in this browser; the website is not changed until the owner applies the file.'
    : 'Put the file in gis/edit/inbox/ in your copy of the repository and push it (GitHub Desktop): the repository applies them and rebuilds the app.'));
};
// ---------- Snapshot: one self-contained HTML file (map + table, read-only) of the rows shown now, for colleagues ----------
// The file carries the plan data of those rows (edits applied, drawn features as ordinary features) and the viewer's code
// and libraries (app/common/snapshot_kit.js, written by tools/build_snapshot_kit.py). Basemaps load from the internet.
function loadKit() { return window.SNAPKIT ? Promise.resolve(window.SNAPKIT) : new Promise((ok, no) => { const sc = document.createElement('script');
  sc.src = 'common/snapshot_kit.js'; sc.onload = () => window.SNAPKIT ? ok(window.SNAPKIT) : no(new Error('kit empty')); sc.onerror = () => no(new Error('common/snapshot_kit.js not found')); document.head.appendChild(sc); }); }
function snapshotPlans(rows, withImages) {
  const strip = (a, x) => x && x.startsWith(a + ':') ? x.slice(a.length + 1) : x, out = [];
  for (const P of PL) {
    const a = P.meta.id, rs = rows.filter(r => r.area === a); if (!rs.length) continue;
    const keys = new Set(rs.map(r => r.project_id + '|' + strip(a, r.map)));
    const lrows = rs.map(r => { const o = {}; Object.keys(r).forEach(k => { if (!['key', 'area', 'area_name', 'isNew'].includes(k)) o[k] = r[k]; });
      D.columns.forEach(c => { if (c.k !== 'area_name') o[c.k] = val(r, c.k) ?? null; }); o.rid = strip(a, r.rid); o.map = strip(a, r.map); return o; });
    const feats = P.features.filter(f => !f.properties.key || keys.has(f.properties.key));
    D.features.filter(f => f.properties.isNew && f.properties.area === a).forEach(f => { const k = f.properties.project_id + '|' + strip(a, f.properties.map);
      if (keys.has(k)) feats.push({type: 'Feature', properties: {cls: strip(a, f.properties.cls), map: strip(a, f.properties.map), project_id: f.properties.project_id, key: k, added: 1}, geometry: f.geometry}); });
    const maps = new Set(lrows.map(r => r.map));
    out.push({...P, rows: lrows, features: feats, images: withImages ? Object.fromEntries(Object.entries(P.images).filter(([k]) => maps.has(k))) : {}});
  }
  return out;
}
$('bSnap').onclick = () => {
  const rows = filtered(); if (!rows.length) return alert('No rows shown: nothing to put in a snapshot.');
  const nNew = rows.filter(r => r.isNew).length, nEd = rows.filter(r => EDITS[r.rid] && Object.keys(EDITS[r.rid]).some(k => canEdit(r, k))).length;
  const m = document.createElement('div'); m.id = 'modal'; m.innerHTML = `<div class="dlg card"><h2>Snapshot for colleagues</h2>
    <p class="fit">One HTML file with the map and the table of the <b>${rows.length} rows shown now</b> (${nNew} drawn by you, ${nEd} with your edits), as they are now. Colleagues open it in a browser (no install); they can search, filter, click and export to Excel, but not edit. It does not update: make a new one after changes.</p>
    <div class="grid"><label class="w">Title (optional)<input id="sT" placeholder="e.g. Botanic Ridge roads – for review"></label>
    <label class="w">Note for colleagues (optional)<input id="sN" placeholder="e.g. RD09 drawn by me, not in the plan"></label>
    <label class="w" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="sI" checked style="width:auto"> Include the printed plan maps (larger file)</label></div>
    <p class="fit"><b>Before sharing:</b> the file holds your edits (status, land acquired) and drawn features. Share it inside Council (Teams, SharePoint, email); do not put internal information in the repository or on the public website. It is a working aid, not an official record.</p>
    <p class="fit" id="sMsg"></p><div class="actions" style="justify-content:flex-end"><button class="btn" id="sCancel">Cancel</button><button class="btn primary" id="sSave">Save snapshot</button></div></div>`;
  document.body.appendChild(m); $('sCancel').onclick = () => m.remove(); $('sT').focus();
  $('sSave').onclick = async () => {
    $('sMsg').textContent = 'Preparing…';
    let K; try { K = await loadKit(); } catch (e) { $('sMsg').textContent = 'Could not load the snapshot kit (' + e.message + '). Run python tools/build_snapshot_kit.py.'; return; }
    const now = new Date(), made = now.toLocaleString('en-AU', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
    const c = map.getCenter(), snap = {made, title: $('sT').value.trim(), note: $('sN').value.trim(), rows: rows.length, added: nNew, edited: nEd, kit: K.v,
      view: {center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing()}, shapes: SHAPES, imgs: $('sI').checked ? [...IMGON] : []};
    const fix = t => t.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
    const plans = snapshotPlans(rows, $('sI').checked);
    const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(snap.title || 'Contribution plans snapshot')} – ${esc(made)}</title>\n`
      + `<!-- Snapshot of the Casey Fields Boulevard contribution plans viewer, ${esc(made)}: ${rows.length} rows (${nNew} drawn by the user, ${nEd} edited). Read-only. A working aid, not an official record: check against the gazetted plan. Prepared with generative AI assistance (Claude Code, Anthropic) from public plan documents and open data. Libraries: MapLibre GL JS (BSD-3-Clause), SheetJS CE (Apache-2.0), Turf.js (MIT). -->\n`
      + K.css.map(t => `<style>${fix(t)}</style>`).join('\n') + `\n</head><body>\n<script>window.SNAPSHOT = ${fix(JSON.stringify(snap))};\nwindow.PLANS = ${fix(JSON.stringify(plans))};</script>\n`
      + K.js.map(t => `<script>${fix(t)}</script>`).join('\n') + '\n</body></html>\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
    const slug = (snap.title || 'snapshot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'snapshot';
    a.download = `plans-${slug}-${now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    m.remove(); alert(`Saved ${a.download} (${(html.length / 1048576).toFixed(1)} MB, ${rows.length} rows). Send it to colleagues; it opens in any browser.`);
  };
};
if (SNAP) { document.body.classList.add('snapshot'); (SNAP.imgs || []).forEach(m => D.images[m] && IMGON.add(m)); applyVis();
  if (SNAP.shapes?.length) map.on('load', () => { SHAPES = SNAP.shapes.slice(); applyShapes(); render(); });   // the sender's drawn filter shapes
  if (SNAP.note) setTimeout(() => { const d = document.createElement('div'); d.className = 'snapbanner card'; d.innerHTML = `<b>Note from the sender:</b> ${esc(SNAP.note)} <button class="btn" title="Close">✕</button>`; d.querySelector('button').onclick = () => d.remove(); $('map').appendChild(d); }, 0); }
// ---------- Map PDF: a printable map of the rows shown, with the matching Excel file ----------
// One map page per plan map with rows (or one page for all), each over the basemap chosen (imagery + street names
// recommended) with that plan's printed map faintly underneath, the drawn filter shapes, legend, scale and north arrow;
// then a table of the rows (same rows and Row IDs as the Excel file). The browser's Print → Save as PDF makes the file.
const DRAWN = ['drawn-fill', 'drawn-buf', 'drawn-case', 'drawn-line', 'drawn-pt'];   // the drawn-shape layers, bottom to top
const PAPER = {a3: {w: 420, h: 297, label: 'A3 landscape'}, a4: {w: 297, h: 210, label: 'A4 landscape'}};
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
async function mapIdle(ms = 20000) {   // wait until tiles and images are drawn
  await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; map.once('idle', fin); map.triggerRepaint(); setTimeout(fin, ms); });
  await nextFrame();
}
const grab = () => new Promise(r => { map.once('render', () => r(map.getCanvas().toDataURL('image/jpeg', 0.95))); map.triggerRepaint(); });
const loadScript = src => new Promise(ok => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });   // missing file: carry on without it
function niceScale(mPerMm) {   // scale bar of about 40 mm, with a round length
  const target = 40 * mPerMm, p = Math.pow(10, Math.floor(Math.log10(target))), len = [1, 2, 5, 10].map(x => x * p).filter(x => x <= target).pop();
  return {len, mm: len / mPerMm, label: len >= 1000 ? len / 1000 + ' km' : len + ' m'};
}
async function mapPdf(o) {
  const rows = filtered(); if (!rows.length) throw new Error('No rows shown');
  const P = PAPER[o.paper] || PAPER.a3, pg = {w: P.w - 17, h: P.h - 17}, side = o.paper === 'a4' ? 78 : 96, head = 17, foot = o.paper === 'a4' ? 15 : 13;
  const fw = pg.w - side - 4, fh = pg.h - head - foot - 4;                  // map frame (mm)
  const pxW = 1150, pxH = Math.round(pxW * fh / fw);                         // map canvas (CSS px) with the frame's shape
  const maps = D.maps.filter(m => rows.some(r => r.map === m.id)), groups = o.perMap ? maps.map(m => [m]) : [maps];
  const keep = {mapon: new Set(MAPON), imgon: new Set(IMGON), sel: SEL, center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pr: map.getPixelRatio(), css: $('map').style.cssText,
    opac: Object.fromEntries(Object.keys(D.images).map(m => [m, map.getPaintProperty('img-' + m, 'raster-opacity')]))};
  const pages = [], areasIn = [...new Set(rows.map(r => r.area))], swapped = [], hdBase = ['imagery', 'hybrid'].includes($('base').value);
  if (!SNAP) await Promise.all(areasIn.filter(a => !window.PRINTIMG?.[a]).map(a => loadScript(a + '/print.js')));   // full-resolution plan images (app/<area>/print.js)
  try {
    // only the plans printed get the full-resolution image (a hidden one would still be loading when restored)
    for (const m of maps) { const hd = window.PRINTIMG?.[m.area]?.[m.id.split(':')[1]]; if (hd && D.images[m.id]) { map.getSource('img-' + m.id).updateImage({url: hd.img, coordinates: hd.coords}); swapped.push(m.id); } }
    if (hdBase) { vis('imageryhd', true); vis('imagery', false); }
    // print style (owner, 2026-11-13): filter shapes bold and on top – areas and line buffers as bold cyan-on-dark outlines; a line's
    // centre line is left out so it does not cover the project inside its buffer; light fill. Larger project labels.
    const POLY = ['==', ['geometry-type'], 'Polygon'];
    map.setFilter('drawn-case', POLY); map.setFilter('drawn-line', POLY); map.setLayoutProperty('drawn-buf', 'visibility', 'none'); map.setPaintProperty('drawn-fill', 'fill-opacity', .1);
    map.setLayoutProperty('labels', 'text-size', 15); map.setPaintProperty('labels', 'text-halo-width', 2.5);
    map.moveLayer('labels');   // project labels above the bold filter shapes, so the dashes do not cut through them
    map.setLayoutProperty('labels', 'text-allow-overlap', true); map.setLayoutProperty('labels', 'text-variable-anchor', ['top', 'bottom', 'left', 'right']); map.setLayoutProperty('labels', 'text-radial-offset', 1.1);   // every project's ID prints, even where projects share a spot
    select(null); $('map').style.cssText += `;position:fixed;left:0;top:0;width:${pxW}px;height:${pxH}px;z-index:-1`; map.setPixelRatio(2); map.resize();
    for (const g of groups) {
      const ids = new Set(g.map(m => m.id)), rs = rows.filter(r => ids.has(r.map));
      MAPON.clear(); g.forEach(m => MAPON.add(m.id)); IMGON.clear(); if (o.printed) g.forEach(m => D.images[m.id] && IMGON.add(m.id));
      g.forEach(m => D.images[m.id] && map.setPaintProperty('img-' + m.id, 'raster-opacity', 1 - o.transp / 100));
      applyVis();
      const fs = rs.flatMap(r => FBYKEY[r.key] || []).concat(SHAPES.map(x => x.area)), b = bboxOf(fs);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: {top: 80, right: 80, bottom: 130, left: 80}, duration: 0, bearing: 0}); await mapIdle(); await mapIdle(4000);   // more room at the bottom for the scale bar
      const img = await grab(), lat = map.getCenter().lat, mPerPx = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
      const mPerMm = mPerPx * pxW / fw, cls = [...new Set(rs.flatMap(r => (FBYKEY[r.key] || []).map(f => f.properties.cls)))].filter(k => CLS[k] && classShown(k));
      pages.push({g, rs, img, mPerMm, cls, scale: Math.round(mPerMm * 1000 / 500) * 500});
    }
  } finally {
    swapped.forEach(id => map.getSource('img-' + id).updateImage({url: D.images[id].img, coordinates: D.images[id].coords}));
    if (hdBase) { vis('imageryhd', false); vis('imagery', true); }
    map.setFilter('drawn-case', ['!', ['has', 'buf']]); map.setFilter('drawn-line', ['!', ['has', 'buf']]); map.setLayoutProperty('drawn-buf', 'visibility', 'visible'); map.setPaintProperty('drawn-fill', 'fill-opacity', .16);
    map.setLayoutProperty('labels', 'text-size', 11); map.setPaintProperty('labels', 'text-halo-width', 2);
    DRAWN.forEach(id => map.moveLayer(id));   // back to the screen order: drawn shapes above the labels
    map.setLayoutProperty('labels', 'text-allow-overlap', false); map.setLayoutProperty('labels', 'text-variable-anchor', undefined); map.setLayoutProperty('labels', 'text-radial-offset', undefined);
    MAPON.clear(); keep.mapon.forEach(m => MAPON.add(m)); IMGON.clear(); keep.imgon.forEach(m => IMGON.add(m));
    Object.entries(keep.opac).forEach(([m, v]) => map.setPaintProperty('img-' + m, 'raster-opacity', v));
    $('map').style.cssText = keep.css; map.setPixelRatio(keep.pr); map.resize(); map.jumpTo({center: keep.center, zoom: keep.zoom, bearing: keep.bearing}); applyVis(); if (keep.sel) select(keep.sel, {zoom: false});
  }
  // ---- the printout ----
  const made = new Date(), date = made.toLocaleDateString('en-AU', {day: 'numeric', month: 'long', year: 'numeric'});
  const areas = [...new Set(rows.map(r => r.area))], plans = areas.map(a => AREA[a].name).join(', ');
  const base = $('base').value, baseTxt = {hybrid: 'Esri World Imagery with Esri reference layers (roads, places)', imagery: 'Esri World Imagery', streets: 'Esri World Street Map', none: 'no basemap'}[base];
  const flt = filterText(), npg = pages.length + 1;
  const fig = (r, k) => fmtv(val(r, k), (D.columns.find(c => c.k === k) || {}).t);
  const head1 = (title, sub, i) => `<div class="ph"><div><h1>${esc(o.title)}</h1><p>${esc(sub)}</p></div><div class="pr"><b>${esc(o.ref)}</b><br>${esc(date)} · page ${i} of ${npg}</div></div>`;
  const footer = `<div class="pf"><p><b>Working aid, not an official record.</b> Projects and figures as printed in ${esc(plans)}; mapped shapes are approximate – check against the gazetted plan. Not for levy, works-in-kind or land-acquisition decisions.
    <b>Use of generative AI:</b> prepared with generative AI assistance (Claude Code, Anthropic) from public plan documents and open data, reviewed by the owner.</p>
    <p>Sources: ${esc(areas.map(a => AREA[a].source).join('; '))}; VPA precinct boundaries and Vicmap (CC BY 4.0); roads © OpenStreetMap contributors / Overture (ODbL); basemap: ${esc(baseTxt)} (Esri, Maxar, Earthstar Geographics, HERE, Garmin, © OpenStreetMap contributors). Linked file: <b>${esc(o.base)}.xlsx</b> (same rows; Row ID).</p></div>`;
  const legend = p => `<h3>Legend</h3>${p.cls.map(k => `<div class="lg"><span class="sw">${swatch(CLS[k])}</span>${esc(CLS[k].label)}</div>`).join('')}
    ${SHAPES.length ? `<div class="lg"><span class="sw"><svg width="22" height="12"><rect x="1" y="1" width="20" height="10" fill="#00e5ff" fill-opacity=".2" stroke="#062a33" stroke-width="2.5"/><rect x="1" y="1" width="20" height="10" fill="none" stroke="#00e5ff" stroke-width="1.4" stroke-dasharray="3 2"/></svg></span>Drawn filter shapes – lines shown by their ± buffer (projects touching them are shown)</div>` : ''}
    ${o.printed && p.g.some(m => D.images[m.id]) ? `<div class="lg"><span class="sw"><svg width="22" height="12"><rect x="1" y="1" width="20" height="10" fill="#c9b8a6" fill-opacity=".5" stroke="#999"/></svg></span>Printed plan underneath, ${o.transp}% transparent: ${esc(p.g.map(m => m.title.split(' · ')[0]).join(', '))}</div>` : ''}`;
  const plist = p => { const seen = new Set(); return `<h3>Projects on this map</h3>` + p.rs.filter(r => !seen.has(r.area + r.project_id) && seen.add(r.area + r.project_id)).map(r =>
    `<div class="pj"><b>${esc(r.project_id)}</b> ${esc(r.title || '')}<br><span>${esc([...new Set(p.rs.filter(x => x.project_id === r.project_id && x.area === r.area).map(x => [x.type, x.table].filter(Boolean).join(', ')))].join(' · '))}</span></div>`).join('') + `<p class="see">Figures: page ${npg} and the Excel file.</p>`; };
  const html = pages.map((p, i) => { const sb = niceScale(p.mPerMm);
    return `<section class="pp" style="width:${pg.w}mm;height:${pg.h}mm">${head1(o.title, `${plans} · ${p.g.map(m => m.title).join(' + ')}`, i + 1)}
    <div class="pb"><div class="mf" style="width:${fw}mm;height:${fh}mm"><img src="${p.img}">
      <div class="na"><svg width="26" height="34" viewBox="0 0 26 34"><path d="M13 2 L22 26 L13 21 L4 26 Z" fill="#17222b" stroke="#fff" stroke-width="1.2"/><text x="13" y="33" text-anchor="middle" font-size="8" font-weight="700" fill="#17222b" stroke="#fff" stroke-width=".5">N</text></svg></div>
      <div class="sb"><div class="bar" style="width:${sb.mm}mm"></div><span>0</span><span style="margin-left:${sb.mm - 3}mm">${sb.label}</span><em>about 1:${p.scale.toLocaleString('en-AU')} at ${PAPER[o.paper].label}</em></div></div>
      <aside class="ps" style="width:${side}mm;height:${fh}mm">${legend(p)}${plist(p)}${flt ? `<h3>Filter</h3><p>${esc(flt)}</p>` : ''}</aside></div>${footer}</section>`; }).join('');
  const cost = r => r.area === 'croskell' ? 'cost_to_icp_aud' : 'cost_to_mca_aud';
  const twice = printedTwice(rows).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('');
  const table = `<section class="pp" style="width:${pg.w}mm;height:${pg.h}mm">${head1(o.title, 'Rows on the maps – figures as printed in the plan tables', npg)}
    <table class="pt"><thead><tr><th>Project ID</th><th>Construction / land</th><th>Levy component</th><th>Table</th><th>Title</th><th>Land ha</th><th>Total cost</th><th>To ICP / MCA</th><th>Map page</th><th>Row ID (Excel)</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.project_id)}</b></td><td>${esc(r.type || '')}</td><td>${esc(r.component || '')}</td><td>${esc(r.table || '')}</td><td>${esc(r.title || '')}</td><td class="n">${fig(r, 'land_ha')}</td><td class="n">${fig(r, 'total_cost_aud')}</td><td class="n">${fig(r, cost(r))}</td><td class="n">${pages.findIndex(p => p.rs.includes(r)) + 1}</td><td class="rid">${esc(r.rid.split(':').slice(1).join(':'))}</td></tr>`).join('')}</tbody></table>
    <div class="nt">${twice}<p>${rows.length} rows${flt ? ' · filter: ' + esc(flt) : ''}. The Excel file <b>${esc(o.base)}.xlsx</b> has the same rows in the register layout, with every column on its Details sheet (Row ID).</p></div>${footer}</section>`;
  let po = $('printout'); if (!po) { po = document.createElement('div'); po.id = 'printout'; document.body.appendChild(po); }
  po.innerHTML = `<style>@page{size:${P.w}mm ${P.h}mm;margin:8mm}</style>` + html + table;
  await Promise.all([...po.querySelectorAll('img')].map(im => im.decode().catch(() => {})));
  return {pages: npg, rows: rows.length};
}
$('bPdf').onclick = () => {
  const rows = filtered(); if (!rows.length) return alert('No rows shown: nothing to map.');
  const maps = D.maps.filter(m => rows.some(r => r.map === m.id)), tr = Math.max(+$('opac').value, 55);
  const m = document.createElement('div'); m.id = 'modal'; m.innerHTML = `<div class="dlg card"><h2>Map PDF</h2>
    <p class="fit">A printable map of the <b>${rows.length} rows shown</b> (${maps.length} plan map${maps.length > 1 ? 's' : ''}), with your drawn shapes, on the basemap chosen now (<b>${esc($('base').selectedOptions[0].text)}</b>), and a table of the rows. The matching Excel file is saved at the same time; keep both in one folder.</p>
    <div class="grid"><label class="w">Title<input id="pT" placeholder="e.g. Casey Fields Boulevard – Thompsons Road to Linsell Boulevard"></label>
    <label>Map reference<input id="pR" value="Map 1"></label><label>Paper<select id="pP"><option value="a3">A3 landscape</option><option value="a4">A4 landscape</option></select></label>
    <label class="w" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pM" ${maps.length > 1 ? 'checked' : ''} style="width:auto"> One page per plan map (printed plans do not overlap)</label>
    <label class="w" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pI" checked style="width:auto"> Printed plan underneath, <input id="pTr" type="number" min="0" max="95" step="5" value="${tr}" style="width:64px"> % transparent</label></div>
    <p class="fit" id="pMsg"></p><div class="actions" style="justify-content:flex-end"><button class="btn" id="pCancel">Cancel</button><button class="btn primary" id="pGo">Make PDF + Excel</button></div></div>`;
  document.body.appendChild(m); $('pCancel').onclick = () => m.remove(); $('pT').focus();
  $('pGo').onclick = async () => {
    const title = $('pT').value.trim() || 'Contribution plan projects', ref = $('pR').value.trim() || 'Map';
    const slug = (ref + ' ' + title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110), baseName = `${slug}-${new Date().toISOString().slice(0, 10)}`;
    $('pMsg').textContent = 'Drawing the map… (a few seconds per page)'; $('pGo').disabled = true;
    try {
      const o = {title, ref, base: baseName, paper: $('pP').value, perMap: $('pM').checked, printed: $('pI').checked, transp: Math.min(95, Math.max(0, +$('pTr').value || 0))};
      await mapPdf(o);
      exportXlsx(rows, 'rows on ' + ref, {file: baseName + '.xlsx', map: `${ref} – ${title}`, pdf: baseName + '.pdf'});
      m.remove(); const t = document.title; document.title = baseName;   // the browser suggests the title as the PDF's file name
      setTimeout(() => { window.print(); document.title = t; }, 300);
    } catch (e) { $('pMsg').textContent = 'Could not make the map: ' + e.message + (/tainted|insecure/i.test(e.message) ? ' (the basemap server does not allow printing; choose another basemap)' : ''); $('pGo').disabled = false; }
  };
};
window.APP = {map, select, mapPdf, setShapes: g => { SHAPES = g; applyShapes(); render(); }, get SHAPES() { return SHAPES; }, get READY() { return READY; }, get SEL() { return SEL; }, FBYKEY, AON, IMGON, MAPON, applyVis};
applyVis();
})();
