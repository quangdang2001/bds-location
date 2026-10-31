/* =============================================================
   Bản đồ phòng trọ — app.js
   Không framework, không backend. Dữ liệu ở trong localStorage.
   ============================================================= */
'use strict';

/* ───────────────────── 0. Hằng số & tiện ích ───────────────────── */

const LS = {
  rows:    'bds.rows.v1',
  mapping: 'bds.mapping.v1',
  weights: 'bds.weights.v1',
  marks:   'bds.marks.v1',
  anchor:  'bds.anchor.v1',
  geo:     'bds.geocache.v1',
  theme:   'bds.theme.v1',
  city:    'bds.city.v1',
};

const DEFAULT_CITY = 'TP. Hồ Chí Minh, Việt Nam';
const SCORE_BINS = ['--s1', '--s2', '--s3', '--s4', '--s5'];

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const debounce = (fn, ms = 180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const noAccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const key = (s) => noAccent(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "9tr5" → 9500000 · "3.5 triệu" → 3500000 · "3500k" → 3500000 · "4,2tr/tháng" → 4200000 */
function parsePrice(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 && v < 1000 ? v * 1e6 : v;
  let s = noAccent(String(v)).toLowerCase().replace(/\s+/g, '');
  s = s.split('/')[0];                                 // bỏ "/thang"
  // dạng "9tr5" = 9,5 triệu
  let m = s.match(/^(\d+)(?:tr|trieu|m)(\d)$/);
  if (m) return (+m[1] + +m[2] / 10) * 1e6;
  m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(n)) return null;
  if (/tr|trieu|\bm\b|million/.test(s)) return n * 1e6;
  if (/k$|nghin|ngan/.test(s))          return n * 1e3;
  if (n > 0 && n < 1000)                return n * 1e6;   // "9" ⇒ 9 triệu
  return n;
}

function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const m = noAccent(String(v)).replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(',', '.'));
  return isFinite(n) ? n : null;
}

const fmtPrice = (n) => n == null ? '—'
  : n >= 1e6 ? (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr'
  : n.toLocaleString('vi-VN') + ' đ';
const fmtDist = (km) => km == null ? '—' : km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
const median = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y);
  return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };

function haversine(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (c - a) * r, dLo = (d - b) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Gỡ link bọc của Facebook (l.php?u=…) và lấy toạ độ nếu link là Google Maps */
function cleanLink(url) {
  if (!url) return '';
  let u = String(url).trim();
  try {
    const p = new URL(u);
    if (/facebook\.com$/.test(p.hostname.replace(/^l\./, '')) && p.searchParams.get('u'))
      u = decodeURIComponent(p.searchParams.get('u'));
  } catch {}
  return u;
}
function coordsFromLink(url) {
  if (!url) return null;
  const s = decodeURIComponent(String(url));
  const m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)      // .../data=...!3d10.8!4d106.7
         || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)                      // .../@10.8,106.7,15z
         || s.match(/[?&](?:q|ll|daddr|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

/** Lấy tên địa điểm từ link Google Maps: /maps/place/Binh+Loi/... → "Binh Loi".
    Link dạng place-ID (…!19sChIJ…) không chứa toạ độ, nên phải tra tên qua Nominatim. */
function placeFromLink(url) {
  const m = String(url || '').match(/\/maps(?:\/[a-z]+)*\/place\/([^/?#]+)/i)
         || String(url || '').match(/[?&](?:q|query)=([^&]+)/);
  if (!m) return '';
  let t = m[1];
  try { t = decodeURIComponent(t); } catch {}
  t = t.replace(/\+/g, ' ').trim();
  return /^-?\d+\.\d+,/.test(t) ? '' : t;
}
function linkHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'liên kết'; } }

/* ───────────────────── 1. Trạng thái ứng dụng ───────────────────── */

window.S = {
  raw: [],            // [{...bản ghi gốc}]
  cols: [],           // tên cột
  mapping: {},        // vai trò → tên cột
  reviewCols: [],     // các cột cho điểm
  rows: [],           // đã chuẩn hoá + chấm điểm
  weights: {},
  marks: load(LS.marks, {}),       // id → 'fav' | 'out'
  anchor: load(LS.anchor, null),   // {lat,lng,label}
  geo: load(LS.geo, {}),
  city: load(LS.city, DEFAULT_CITY),
  view: 'cards',
  hot: null,
  filters: { q: '', price: null, area: null, radius: 0, fav: false, hideOut: true, status: '', sort: 'score' },
};

const ROLES = [
  ['title',   'Tên / tiêu đề'],
  ['address', 'Địa chỉ / khu vực'],
  ['price',   'Giá thuê'],
  ['area',    'Diện tích (m²)'],
  ['status',  'Trạng thái'],
  ['contact', 'Liên hệ'],
  ['link',    'Link tin'],
  ['geo',     'Link bản đồ (Google Maps)'],
  ['linkHref','Link tin (hyperlink của ô)'],
  ['due',     'Ngày đến hạn'],
  ['note',    'Ghi chú'],
  ['lat',     'Vĩ độ (lat)'],
  ['lng',     'Kinh độ (lng)'],
];

const DETECT = {
  title:   ['ten', 'tieu de', 'title', 'name', 'phong', 'nha'],
  address: ['dia chi', 'address', 'location', 'vi tri', 'khu vuc', 'duong', 'quan'],
  price:   ['gia', 'price', 'thue', 'tien', 'rent', 'chi phi'],
  area:    ['dien tich', 'area', 'm2', 'size', 'rong'],
  status:  ['trang thai', 'status', 'tinh trang'],
  contact: ['contact', 'lien he', 'sdt', 'so dien thoai', 'dien thoai', 'phone', 'zalo'],
  link:    ['link', 'url', 'nguon', 'source', 'tin', 'bai'],
  geo:     ['maps', 'map', 'ban do', 'geo', 'toa do'],
  due:     ['ngay den han', 'den han', 'deadline', 'due', 'ngay'],
  note:    ['ghi chu', 'note', 'nhan xet', 'comment', 'remark'],
  lat:     ['lat', 'latitude', 'vi do'],
  lng:     ['lng', 'lon', 'long', 'longitude', 'kinh do'],
};

function detectMapping(cols) {
  const m = {}, used = new Set();
  for (const [role, keys] of Object.entries(DETECT)) {
    let best = null, bestScore = 0;
    for (const c of cols) {
      if (used.has(c)) continue;
      const k = key(c);
      if (!k) continue;
      for (const kw of keys) {
        let sc = 0;
        if (k === kw) sc = 100;
        else if (k.startsWith(kw) || k.endsWith(kw)) sc = 60;
        else if (k.includes(kw)) sc = 40;
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
    }
    if (best) { m[role] = best; used.add(best); }
  }
  // Google Sheets xuất .xlsx giữ hyperlink của ô dưới dạng cột "<Tên cột> (link)".
  // Nếu ô địa chỉ có hyperlink, đó chính là link bản đồ.
  if (!m.geo && m.address && cols.includes(m.address + ' (link)')) {
    m.geo = m.address + ' (link)'; used.add(m.geo);
  }
  if (m.link && cols.includes(m.link + ' (link)') && !used.has(m.link + ' (link)')) {
    m.linkHref = m.link + ' (link)'; used.add(m.linkHref);
  }
  return m;
}

/** Cột “review”: tên chứa review/diem/danh gia/rating/sao, hoặc “<Tên người> - Review” */
function detectReviewCols(cols, mapping) {
  const taken = new Set(Object.values(mapping));
  return cols.filter((c) => !taken.has(c) && !/ \(link\)$/.test(c)
    && /review|diem|danh gia|rating|sao|cham/.test(key(c)));
}
const reviewLabel = (c) => String(c).replace(/[-–—]?\s*(review|đánh giá|danh gia|điểm|diem|rating)\s*$/i, '').replace(/[-–—]\s*$/, '').trim() || c;

/* ───────────────────── 2. Nạp dữ liệu ───────────────────── */

function isBlankRow(r) {
  return Object.entries(r).every(([k, v]) => {
    const s = String(v ?? '').trim();
    if (s === '') return true;
    if (parseNum(s) === 0 && /^[\d.,\s]+$/.test(s)) return true;      // 0 / 0.0 / 0,0
    return /^(sdt|chua bat dau|n\/a|na|-|0)$/.test(key(s));
  });
}

function ingest(records, note = '') {
  const cols = [...new Set(records.flatMap((r) => Object.keys(r)))].filter((c) => c && c.trim());
  const rows = records.filter((r) => !isBlankRow(r));
  if (!rows.length) { status('Không tìm thấy dòng nào có dữ liệu.', 'bad'); return false; }

  S.raw = rows; S.cols = cols;
  const saved = load(LS.mapping, null);
  const auto = detectMapping(cols);
  S.mapping = saved && saved.__cols === cols.join('|') ? saved : auto;
  S.reviewCols = detectReviewCols(cols, S.mapping);
  save(LS.rows, { records: rows, cols });

  renderMappingUI();
  buildWeights();
  apply();
  status(`Đã nạp ${rows.length} dòng${note ? ' · ' + note : ''}. Kiểm tra phần “Gán cột” bên dưới.`, 'ok');
  const missing = S.rows.filter((r) => r.lat == null).length;
  if (missing) setTimeout(() => geoStatus(`${missing} dòng chưa có toạ độ — bấm “Định vị địa chỉ còn thiếu”.`), 0);
  return true;
}

function parseDelimited(text) {
  const out = Papa.parse(text.trim(), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
  return out.data.filter((r) => r && typeof r === 'object');
}

const XLSX_SRC = ['vendor/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];

/** SheetJS ~880 KB nên chỉ nạp khi thật sự mở file .xlsx. */
function ensureXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(true);
  if (ensureXLSX._p) return ensureXLSX._p;
  const tryOne = (i) => i >= XLSX_SRC.length ? Promise.resolve(false) : new Promise((res) => {
    const el = document.createElement('script');
    el.src = XLSX_SRC[i];
    el.onload  = () => res(typeof XLSX !== 'undefined' ? true : tryOne(i + 1));
    el.onerror = () => { el.remove(); res(tryOne(i + 1)); };
    document.head.appendChild(el);
  });
  return (ensureXLSX._p = tryOne(0));
}

/** Giống sheet_to_json nhưng giữ thêm hyperlink của từng ô thành cột "<Tên cột> (link)". */
function sheetToRecords(ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  if (!grid.length) return [];
  const head = grid[0].map((h, j) => String(h ?? '').trim() || `Cột ${j + 1}`);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const links = {};                                  // "r,c" → url
  for (let R = range.s.r; R <= range.e.r; R++)
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.l && cell.l.Target) links[R + ',' + C] = cell.l.Target;
    }
  return grid.slice(1).map((row, n) => {
    const rec = {};
    head.forEach((h, C) => {
      rec[h] = row[C] ?? '';
      const url = links[(n + 1) + ',' + C];
      if (url) rec[h + ' (link)'] = url;
    });
    return rec;
  });
}

function readFile(file) {
  const name = file.name.toLowerCase();
  const fr = new FileReader();
  if (/\.xlsx?$/.test(name)) {
    fr.onload = async () => {
      status('Đang nạp bộ đọc Excel…');
      if (!(await ensureXLSX())) {
        status('Không nạp được bộ đọc Excel (cần mạng ở lần đầu). Hãy lưu bảng thành .csv rồi thử lại, hoặc dán dữ liệu ở mục 1.', 'bad');
        return;
      }
      try {
        const wb = XLSX.read(fr.result, { type: 'array', cellStyles: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        ingest(sheetToRecords(ws), `sheet “${wb.SheetNames[0]}”`);
      } catch (e) { status('Không đọc được file Excel: ' + e.message, 'bad'); }
    };
    fr.readAsArrayBuffer(file);
  } else {
    fr.onload = () => ingest(parseDelimited(fr.result), file.name);
    fr.readAsText(file, 'utf-8');
  }
}

async function loadUrl(url) {
  status('Đang tải…');
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    ingest(parseDelimited(await r.text()), 'từ link');
  } catch (e) {
    status('Không tải được: ' + e.message + ' — Google Sheets phải được “Xuất bản lên web → CSV”, hoặc dán trực tiếp ở mục 1.', 'bad');
  }
}

/* ───────────────────── 3. Chuẩn hoá + chấm điểm ───────────────────── */

function normalize() {
  const m = S.mapping;
  S.rows = S.raw.map((r, i) => {
    const link    = cleanLink(r[m.linkHref] || r[m.link]);
    const geoLink = String(r[m.geo] ?? '').trim();
    const addr    = String(r[m.address] ?? '').trim();

    let lat = parseNum(r[m.lat]), lng = parseNum(r[m.lng]);
    if (lat == null || lng == null) {
      const hit = coordsFromLink(geoLink) || coordsFromLink(link);
      if (hit) ({ lat, lng } = hit);
    }
    // câu truy vấn để tra toạ độ: tên trong link bản đồ > chữ trong ô địa chỉ
    const geoQuery = placeFromLink(geoLink) || addr;
    if (lat == null && geoQuery) {
      const c = S.geo[geoKey(geoQuery)];
      if (c) ({ lat, lng } = c);
    }

    const title = String(r[m.title] ?? '').trim() || addr || geoQuery || (link ? linkHost(link) : `Tin #${i + 1}`);
    const row = {
      id: 'r' + i, i, raw: r,
      title, addr: addr || geoQuery, link, geoLink, geoQuery,
      price:   parsePrice(r[m.price]),
      area:    parseNum(r[m.area]),
      status:  String(r[m.status] ?? '').trim(),
      contact: String(r[m.contact] ?? '').trim(),
      due:     String(r[m.due] ?? '').trim(),
      note:    String(r[m.note] ?? '').trim(),
      lat, lng,
      reviews: {},
      dist: null, score: null,
    };
    for (const c of S.reviewCols) {
      const v = parseNum(r[c]);
      row.reviews[c] = v === 0 ? null : v;      // 0 = chưa ai đánh giá, không phải "điểm 0"
    }
    if (S.anchor && lat != null) row.dist = haversine(S.anchor.lat, S.anchor.lng, lat, lng);
    return row;
  });
  scoreAll();
}

function criteria() {
  const out = [];
  if (S.mapping.price) out.push({ k: 'price', label: 'Giá thuê (thấp hơn tốt hơn)', dir: -1, get: (r) => r.price });
  if (S.mapping.area)  out.push({ k: 'area',  label: 'Diện tích (rộng hơn tốt hơn)', dir: 1, get: (r) => r.area });
  if (S.anchor)        out.push({ k: 'dist',  label: 'Gần điểm neo', dir: -1, get: (r) => r.dist });
  for (const c of S.reviewCols)
    out.push({ k: 'rev:' + c, label: 'Điểm của ' + reviewLabel(c), dir: 1, get: (r) => r.reviews[c] });
  return out;
}

function defaultWeights() {
  const cs = criteria(), w = {};
  const base = { price: 30, area: 15, dist: 25 };
  const revs = cs.filter((c) => c.k.startsWith('rev:'));
  const fixed = cs.filter((c) => !c.k.startsWith('rev:')).reduce((s, c) => s + base[c.k], 0);
  const per = revs.length ? Math.max(5, Math.round((100 - fixed) / revs.length)) : 0;
  for (const c of cs) w[c.k] = c.k.startsWith('rev:') ? per : base[c.k];
  return w;
}

function buildWeights() {
  const saved = load(LS.weights, {});
  const def = defaultWeights();
  S.weights = {};
  for (const c of criteria()) S.weights[c.k] = saved[c.k] != null ? saved[c.k] : def[c.k];
  renderWeightsUI();
}

function scoreAll() {
  const cs = criteria().filter((c) => (S.weights[c.k] ?? 0) > 0);
  const stats = {};
  for (const c of cs) {
    const vals = S.rows.map(c.get).filter((v) => v != null && isFinite(v));
    stats[c.k] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }
  const total = cs.reduce((s, c) => s + S.weights[c.k], 0) || 1;
  for (const r of S.rows) {
    let sum = 0, known = 0;
    for (const c of cs) {
      const st = stats[c.k], v = c.get(r), w = S.weights[c.k];
      let n = 0.5;
      if (st && v != null && isFinite(v)) {
        n = st.max === st.min ? 0.5 : (v - st.min) / (st.max - st.min);
        if (c.dir < 0) n = 1 - n;
        known += w;
      }
      sum += w * n;
    }
    r.confidence = known / total;          // 1 = đủ dữ liệu cho mọi tiêu chí
    r.score = r.confidence === 0 ? null : Math.round(100 * sum / total);
  }
}

const scoreBin = (s) => s == null ? 0 : Math.min(4, Math.floor(s / 20));
const scoreText = (s) => s == null ? '?' : String(s);
const scoreColor = (s) => `var(${SCORE_BINS[scoreBin(s)]})`;
const scoreIsPale = (s) => scoreBin(s) <= 1;

/* ───────────────────── 4. Lọc & sắp xếp ───────────────────── */

function visible() {
  const f = S.filters, q = key(f.q);
  let out = S.rows.filter((r) => {
    if (f.hideOut && S.marks[r.id] === 'out') return false;
    if (f.fav && S.marks[r.id] !== 'fav') return false;
    if (f.status && r.status !== f.status) return false;
    if (f.price != null && r.price != null && r.price > f.price) return false;
    if (f.area  != null && r.area  != null && r.area  < f.area)  return false;
    if (f.radius > 0 && (r.dist == null || r.dist > f.radius)) return false;
    if (q) {
      const hay = key([r.title, r.addr, r.note, r.status, r.contact].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    area:  (a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity),
    dist:  (a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity),
  };
  return out.sort(by[f.sort] || by.score);
}

/* ───────────────────── 5. Bản đồ ───────────────────── */

let map, layer, anchorMarker, markers = new Map(), tileLight, tileDark;

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([10.776, 106.701], 12);
  L.control.zoom({ position: 'topright' }).addTo(map);   // tránh đè lên ô “Điểm neo”
  const attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  tileLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: attr });
  tileDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { maxZoom: 20, attribution: attr });
  layer = L.layerGroup().addTo(map);
  applyTiles();
  map.on('click', (e) => setAnchor(e.latlng.lat, e.latlng.lng, 'Điểm đã chọn trên bản đồ'));
}

function applyTiles() {
  if (!map) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (document.documentElement.getAttribute('data-theme') !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  (dark ? tileDark : tileLight).addTo(map);
  map.removeLayer(dark ? tileLight : tileDark);
}

function pinIcon(r, hot) {
  const pale = scoreIsPale(r.score) ? ' is-pale' : '';
  return L.divIcon({
    className: 'pin' + (hot ? ' is-hot' : ''),
    html: `<div class="pin-dot${pale}" style="background:${r.score == null ? 'var(--axis)' : scoreColor(r.score)}">${scoreText(r.score)}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
  });
}

function popupHtml(r) {
  const facts = [
    ['Giá', fmtPrice(r.price) + (r.price ? '/tháng' : '')],
    r.area ? ['Diện tích', r.area + ' m²'] : null,
    r.dist != null ? ['Cách điểm neo', fmtDist(r.dist)] : null,
    ...Object.entries(r.reviews).filter(([, v]) => v != null).map(([c, v]) => [reviewLabel(c), String(v)]),
    r.contact ? ['Liên hệ', r.contact] : null,
    r.due ? ['Đến hạn', r.due] : null,
  ].filter(Boolean);
  return `<div class="pop-name">${esc(r.title)}</div>
    ${r.addr ? `<div class="pop-addr">${esc(r.addr)}</div>` : ''}
    <div class="pop-facts">${facts.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>
    ${r.note ? `<div class="pop-addr" style="margin-top:6px">${esc(r.note)}</div>` : ''}
    <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">
      ${r.link ? `<a class="pop-link" href="${esc(r.link)}" target="_blank" rel="noopener">Mở tin trên ${esc(linkHost(r.link))} ↗</a>` : ''}
      ${r.geoLink ? `<a class="pop-link" href="${esc(r.geoLink)}" target="_blank" rel="noopener">Xem trên Google Maps ↗</a>` : ''}
    </div>`;
}

function drawMap(rows) {
  if (!map) return;
  layer.clearLayers(); markers.clear();
  const pts = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const mk = L.marker([r.lat, r.lng], { icon: pinIcon(r, false), title: r.title, riseOnHover: true })
      .bindPopup(popupHtml(r), { maxWidth: 290 })
      .on('mouseover', () => setHot(r.id, false))
      .on('click', () => setHot(r.id, true));
    mk.addTo(layer); markers.set(r.id, mk); pts.push([r.lat, r.lng]);
  }
  if (S.anchor) {
    if (anchorMarker) map.removeLayer(anchorMarker);
    anchorMarker = L.marker([S.anchor.lat, S.anchor.lng], {
      draggable: true, zIndexOffset: 1000,
      icon: L.divIcon({ className: 'pin pin-anchor', html: '<div class="pin-dot">★</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).bindTooltip(S.anchor.label || 'Điểm neo').addTo(map);
    anchorMarker.on('dragend', (e) => { const p = e.target.getLatLng(); setAnchor(p.lat, p.lng, 'Điểm neo đã kéo'); });
    pts.push([S.anchor.lat, S.anchor.lng]);
  }
  if (pts.length && !drawMap._fitted) { map.fitBounds(pts, { padding: [52, 52], maxZoom: 15 }); drawMap._fitted = true; }

  const noCoords = S.rows.length && !S.rows.some((r) => r.lat != null);
  $('#mapEmpty').hidden = !noCoords;
  if (noCoords) $('#mapEmptyCount').textContent = S.rows.filter((r) => r.geoQuery).length;
}

function setHot(id, fly) {
  S.hot = id;
  $$('.card').forEach((el) => el.classList.toggle('is-hot', el.dataset.id === id));
  for (const [rid, mk] of markers) {
    const r = S.rows.find((x) => x.id === rid);
    if (r) mk.setIcon(pinIcon(r, rid === id));
  }
  const el = $(`.card[data-id="${id}"]`);
  if (el && fly) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function focusRow(id) {
  const r = S.rows.find((x) => x.id === id);
  setHot(id, false);
  if (r && r.lat != null) { map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 15), { duration: .5 }); markers.get(id)?.openPopup(); }
}

/* ───────────────────── 6. Điểm neo + geocode ───────────────────── */

const geoKey = (s) => key(s) + '|' + key(S.city);

function setAnchor(lat, lng, label) {
  S.anchor = { lat, lng, label };
  save(LS.anchor, S.anchor);
  $('#anchorHint').textContent = `${label} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  buildWeights();
  apply();
}

async function nominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q); u.searchParams.set('format', 'json'); u.searchParams.set('limit', '1');
  const r = await fetch(u, { headers: { 'Accept-Language': 'vi' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j[0] ? { lat: +j[0].lat, lng: +j[0].lon, name: j[0].display_name } : null;
}

async function geocodeAnchor() {
  const q = $('#anchorInput').value.trim();
  if (!q) { $('#anchorHint').textContent = 'Nhập địa chỉ, hoặc bấm trực tiếp lên bản đồ.'; return; }
  $('#anchorHint').textContent = 'Đang tìm…';
  try {
    const hit = await nominatim(`${q}, ${S.city}`);
    if (!hit) { $('#anchorHint').textContent = 'Không tìm thấy địa chỉ này.'; return; }
    setAnchor(hit.lat, hit.lng, q);
    map.flyTo([hit.lat, hit.lng], 14, { duration: .6 });
  } catch (e) { $('#anchorHint').textContent = 'Lỗi tra cứu: ' + e.message; }
}

async function geocodeMissing() {
  const todo = S.rows.filter((r) => r.lat == null && r.geoQuery);
  if (!todo.length) { geoStatus('Mọi dòng có địa chỉ đều đã có toạ độ.'); return; }
  const btn = $('#btnGeocode'); btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    geoStatus(`Đang định vị ${i + 1}/${todo.length}: ${r.geoQuery}…`);
    try {
      const hit = await nominatim(`${r.geoQuery}, ${S.city}`);
      if (hit) { S.geo[geoKey(r.geoQuery)] = { lat: hit.lat, lng: hit.lng, name: hit.name }; ok++; }
      else S.geo[geoKey(r.geoQuery)] = null;
    } catch (e) { geoStatus('Lỗi: ' + e.message, 'bad'); break; }
    await new Promise((res) => setTimeout(res, 1100));   // tôn trọng giới hạn 1 req/s của Nominatim
  }
  save(LS.geo, S.geo);
  btn.disabled = false;
  drawMap._fitted = false;
  apply();
  geoStatus(`Xong — định vị được ${ok}/${todo.length} địa chỉ.`, ok ? 'ok' : 'bad');
}

/* ───────────────────── 7. Vẽ giao diện ───────────────────── */

function statusBadge(s) {
  const k = key(s);
  const tone = /xong|hoan thanh|da thue|done|ok/.test(k) ? 'var(--good)'
    : /dang|thuc hien|lien he|cho/.test(k)                ? 'var(--warning)'
    : /loai|bo|huy|khong/.test(k)                         ? 'var(--critical)'
    : 'var(--axis)';
  const ink = /dang|thuc hien|lien he|cho/.test(k) ? '#0b0b0b' : '#fff';
  return `<span class="mini" style="background:${tone};color:${ink};border-color:transparent">${esc(s)}</span>`;
}

function renderCards(rows) {
  const box = $('#sideCards');
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><b>Không có phòng nào khớp</b>Nới bộ lọc, hoặc nạp thêm dữ liệu.</div>`;
    return;
  }
  box.innerHTML = rows.map((r) => {
    const facts = [
      `<span>Giá <b>${fmtPrice(r.price)}</b></span>`,
      r.area != null ? `<span>DT <b>${r.area} m²</b></span>` : '',
      r.dist != null ? `<span>Cách <b>${fmtDist(r.dist)}</b></span>` : '',
      ...Object.entries(r.reviews).filter(([, v]) => v != null).map(([c, v]) => `<span>${esc(reviewLabel(c))} <b>${v}</b></span>`),
      r.lat == null ? `<span style="color:var(--critical)">chưa có toạ độ</span>` : '',
    ].filter(Boolean).join('');
    const mark = S.marks[r.id];
    return `<article class="card${mark === 'out' ? ' is-out' : ''}${S.hot === r.id ? ' is-hot' : ''}"
      data-id="${r.id}" style="--card-accent:${scoreColor(r.score)}" tabindex="0">
      <div class="card-top">
        <div>
          <div class="card-name">${esc(r.title)}</div>
          ${r.addr && r.addr !== r.title ? `<div class="card-addr">${esc(r.addr)}</div>` : ''}
        </div>
        <div class="score${scoreIsPale(r.score) ? ' is-pale' : ''}" style="--score-bg:${r.score == null ? 'var(--axis)' : scoreColor(r.score)}"
             title="${r.score == null ? 'Chưa có dữ liệu để chấm điểm' : `Điểm tổng hợp ${r.score}/100` + (r.confidence < 1 ? ' — còn thiếu dữ liệu ở một số tiêu chí' : '')}">${r.score ?? '—'}</div>
      </div>
      <div class="card-facts">${facts}</div>
      ${r.note ? `<div class="card-note">${esc(r.note)}</div>` : ''}
      <div class="card-acts">
        ${r.status ? statusBadge(r.status) : ''}
        <button class="mini" data-act="fav" aria-pressed="${mark === 'fav'}">★ Thích</button>
        <button class="mini is-off" data-act="out" aria-pressed="${mark === 'out'}">Loại</button>
        ${r.link ? `<a class="mini" href="${esc(r.link)}" target="_blank" rel="noopener">Mở tin ↗</a>` : ''}
        ${r.geoLink ? `<a class="mini" href="${esc(r.geoLink)}" target="_blank" rel="noopener">Maps ↗</a>` : ''}
        ${r.contact && /\d{6}/.test(r.contact) ? `<a class="mini" href="tel:${esc(r.contact.replace(/\s/g, ''))}">${esc(r.contact)}</a>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderTable(rows) {
  const revs = S.reviewCols;
  const head = ['Điểm', 'Tên', 'Khu vực', 'Giá', 'm²', 'Cách', ...revs.map(reviewLabel), 'Trạng thái'];
  $('#sideTable').innerHTML = `<table class="tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr data-id="${r.id}">
      <td class="num"><b>${r.score ?? '—'}</b></td>
      <td>${esc(r.title)}</td><td>${esc(r.addr)}</td>
      <td class="num">${fmtPrice(r.price)}</td>
      <td class="num">${r.area ?? '—'}</td>
      <td class="num">${fmtDist(r.dist)}</td>
      ${revs.map((c) => `<td class="num">${r.reviews[c] ?? '—'}</td>`).join('')}
      <td>${esc(r.status || '—')}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderTiles(rows) {
  $('#statCount').textContent = rows.length;
  $('#statCountFoot').textContent = `trên tổng ${S.rows.length}`;
  const mp = median(rows.map((r) => r.price));
  $('#statPrice').textContent = fmtPrice(mp);
  const known = rows.filter((r) => r.price != null).length;
  $('#statPriceFoot').textContent = known < rows.length ? `${known}/${rows.length} tin có giá` : 'mỗi tháng';
  const ma = median(rows.map((r) => r.area));
  $('#statArea').textContent = ma == null ? '—' : ma.toLocaleString('vi-VN');
  const md = median(rows.map((r) => r.dist));
  $('#statDist').textContent = fmtDist(md);
  $('#statDistFoot').textContent = S.anchor ? (S.anchor.label || 'từ điểm neo') : 'chưa đặt điểm neo';
  const best = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
  $('#statBest').textContent = best && best.score != null ? best.score : '—';
  $('#statBestFoot').textContent = best && best.score != null ? best.title : 'chưa đủ dữ liệu';
}

function renderFilterRange() {
  const prices = S.rows.map((r) => r.price).filter((v) => v != null);
  const areas  = S.rows.map((r) => r.area).filter((v) => v != null);
  const pEl = $('#fPrice'), aEl = $('#fArea');
  if (prices.length) {
    const lo = Math.floor(Math.min(...prices) / 5e5) * 5e5, hi = Math.ceil(Math.max(...prices) / 5e5) * 5e5;
    pEl.min = lo; pEl.max = Math.max(hi, lo + 5e5); pEl.step = 5e5; pEl.disabled = false;
    if (S.filters.price == null) pEl.value = pEl.max;
  } else { pEl.disabled = true; }
  if (areas.length) {
    aEl.min = 0; aEl.max = Math.ceil(Math.max(...areas)); aEl.step = 1; aEl.disabled = false;
  } else { aEl.disabled = true; }
  $('#fPriceOut').textContent = pEl.disabled ? 'không có cột giá' : fmtPrice(+pEl.value);
  $('#fAreaOut').textContent  = aEl.disabled ? 'không có cột m²' : (+aEl.value || 0) + ' m²';
  $('#fRadiusOut').textContent = !S.anchor ? 'cần điểm neo' : (+$('#fRadius').value > 0 ? (+$('#fRadius').value) + ' km' : 'không giới hạn');
  $('#fRadius').disabled = !S.anchor;
}

function renderLegend() {
  $('#legendScale').innerHTML = SCORE_BINS.map((v) => `<i style="background:var(${v})"></i>`).join('');
}

function apply() {
  normalize();
  renderFilterRange();
  S.filters.price  = $('#fPrice').disabled ? null : +$('#fPrice').value;
  S.filters.area   = $('#fArea').disabled  ? null : +$('#fArea').value;
  S.filters.radius = +$('#fRadius').value || 0;
  const rows = visible();
  renderTiles(rows);
  renderCards(rows);
  renderTable(rows);
  drawMap(rows);
  $('#datasetLine').textContent = S.rows.length
    ? `${S.rows.length} tin · ${S.rows.filter((r) => r.lat != null).length} có toạ độ · ${S.reviewCols.length} người đánh giá`
    : 'Chưa có dữ liệu — mở “Dữ liệu” để dán từ Google Sheets';
}

/* ───────────────────── 8. Hộp thoại ───────────────────── */

const status    = (m, c = '') => { const e = $('#dataStatus'); e.textContent = m; e.className = 'status' + (c ? ' is-' + c : ''); };
const geoStatus = (m, c = '') => { const e = $('#geoStatus');  e.textContent = m; e.className = 'status' + (c ? ' is-' + c : ''); };

function renderMappingUI() {
  $('#mapBlock').hidden = false;
  const opts = (sel) => ['<option value="">— không có —</option>',
    ...S.cols.map((c) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`)].join('');
  $('#mapGrid').innerHTML = ROLES.map(([role, label]) =>
    `<label>${esc(label)}<select data-role="${role}">${opts(S.mapping[role])}</select></label>`).join('') +
    `<label>Thành phố (giúp định vị)<input id="cityInput" type="text" value="${esc(S.city)}"></label>`;
  const revs = S.reviewCols.length ? S.reviewCols.map(reviewLabel).join(', ') : 'không có';
  geoStatus(`Cột cho điểm nhận được: ${revs}.`);
}

function applyMapping() {
  const m = {};
  $$('#mapGrid select').forEach((s) => { if (s.value) m[s.dataset.role] = s.value; });
  if (!m.geo && m.address && S.cols.includes(m.address + ' (link)')) m.geo = m.address + ' (link)';
  if (!m.linkHref && m.link && S.cols.includes(m.link + ' (link)')) m.linkHref = m.link + ' (link)';
  m.__cols = S.cols.join('|');
  S.mapping = m; save(LS.mapping, m);
  S.city = $('#cityInput').value.trim() || DEFAULT_CITY; save(LS.city, S.city);
  S.reviewCols = detectReviewCols(S.cols, m);
  buildWeights();
  drawMap._fitted = false;
  apply();
  status('Đã áp dụng cách gán cột.', 'ok');
  renderMappingUI();
}

function renderWeightsUI() {
  const cs = criteria();
  if (!cs.length) { $('#weightGrid').innerHTML = '<p class="muted">Chưa có tiêu chí nào — hãy nạp dữ liệu và gán cột giá / diện tích / điểm.</p>'; return; }
  const total = cs.reduce((s, c) => s + (S.weights[c.k] || 0), 0) || 1;
  const hint = S.reviewCols.length
    ? '<p class="muted sm">Ô điểm để trống hoặc bằng 0 được hiểu là “chưa đánh giá”, không phải điểm 0.</p>' : '';
  $('#weightGrid').innerHTML = hint + cs.map((c) => {
    const w = S.weights[c.k] || 0;
    return `<div class="wrow">
      <div class="wrow-top"><span>${esc(c.label)}</span><b>${Math.round(100 * w / total)}%</b></div>
      <input type="range" min="0" max="50" step="1" value="${w}" data-w="${esc(c.k)}">
      <small>${w === 0 ? 'bỏ qua tiêu chí này' : 'trọng số thô ' + w}</small>
    </div>`;
  }).join('');
}

/* ───────────────────── 9. Xuất CSV ───────────────────── */

function exportCsv() {
  const rows = visible();
  if (!rows.length) return;
  const extra = ['Điểm tổng hợp', 'Khoảng cách (km)', 'lat', 'lng', 'Đánh dấu'];
  const head = [...S.cols, ...extra];
  const body = rows.map((r) => [
    ...S.cols.map((c) => r.raw[c] ?? ''),
    r.score, r.dist == null ? '' : r.dist.toFixed(2),
    r.lat ?? '', r.lng ?? '',
    S.marks[r.id] === 'fav' ? 'Yêu thích' : S.marks[r.id] === 'out' ? 'Đã loại' : '',
  ]);
  const csv = '﻿' + Papa.unparse({ fields: head, data: body });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'phong-tro-da-cham-diem.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

/* ───────────────────── 10. Dữ liệu mẫu ───────────────────── */

const SAMPLE = `Link,Trạng thái,Contact,Giá,Location,Ngày đến hạn,Hy -  Review,Khoa - Review,Quang - Review,Ghi chú
https://example.com/t1,Đang thực hiện,038 548 6855,4tr5,"Bình Lợi, Bình Thạnh",2026-11-10,5,4,4,Gác lửng, có cửa sổ
https://example.com/t2,Chưa bắt đầu,090 111 2233,3tr2,"Phạm Văn Đồng, Gò Vấp",,4,3,5,Hơi xa chợ
https://example.com/t3,Đang thực hiện,091 222 3344,6tr,"Nguyễn Thị Minh Khai, Quận 3",2026-11-05,3,5,4,Trung tâm, giá cao
https://example.com/t4,Chưa bắt đầu,097 333 4455,2tr8,"Tân Sơn Nhì, Tân Phú",,3,2,3,Phòng nhỏ
https://example.com/t5,Đã xong,098 444 5566,5tr,"Thảo Điền, Quận 2",2026-11-20,5,5,3,Đẹp nhưng xa chỗ làm
https://example.com/t6,Chưa bắt đầu,039 555 6677,3tr9,"Lê Văn Việt, Quận 9",,2,3,4,Gần ĐH
https://example.com/t7,Đang thực hiện,035 666 7788,4tr2,"Cộng Hòa, Tân Bình",2026-11-12,4,4,4,Yên tĩnh
https://example.com/t8,Chưa bắt đầu,036 777 8899,7tr5,"Phú Mỹ Hưng, Quận 7",,5,3,2,Vượt ngân sách`;

/* ───────────────────── 11. Gắn sự kiện ───────────────────── */

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  save(LS.theme, t);
  applyTiles();
}

function wire() {
  // theme
  applyTheme(load(LS.theme, 'auto'));
  $('#btnTheme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark');
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTiles);

  // dialogs
  $('#btnData').onclick    = () => $('#dlgData').showModal();
  $('#btnWeights').onclick = () => { renderWeightsUI(); $('#dlgWeights').showModal(); };
  $('#btnExport').onclick  = exportCsv;

  // data sources
  $('#btnPaste').onclick = () => {
    const t = $('#pasteBox').value;
    if (!t.trim()) { status('Chưa có gì để nạp — dán dữ liệu vào ô trên.', 'bad'); return; }
    if (ingest(parseDelimited(t), 'dán tay')) drawMap._fitted = false;
  };
  $('#fileInput').onchange = (e) => { if (e.target.files[0]) { drawMap._fitted = false; readFile(e.target.files[0]); } };
  $('#btnUrl').onclick  = () => { const u = $('#urlInput').value.trim(); if (u) { drawMap._fitted = false; loadUrl(u); } };
  $('#btnSample').onclick = () => { drawMap._fitted = false; ingest(parseDelimited(SAMPLE), 'dữ liệu mẫu'); };
  $('#btnApplyMap').onclick = applyMapping;
  $('#btnGeocode').onclick     = geocodeMissing;
  $('#btnGeocode2').onclick    = () => { geocodeMissing(); $('#btnGeocode2').textContent = 'Đang định vị…'; };
  $('#btnOpenData').onclick    = () => $('#dlgData').showModal();

  // anchor
  $('#btnAnchor').onclick = geocodeAnchor;
  $('#anchorInput').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); geocodeAnchor(); } };

  // filters
  $('#fSearch').oninput = debounce((e) => { S.filters.q = e.target.value; apply(); });
  for (const id of ['fPrice', 'fArea', 'fRadius']) $('#' + id).oninput = debounce(apply, 60);
  $('#fSort').onchange = (e) => { S.filters.sort = e.target.value; apply(); };
  $('#fFav').onclick = (e) => { S.filters.fav = !S.filters.fav; e.currentTarget.setAttribute('aria-pressed', S.filters.fav); apply(); };
  $('#fHideOut').onclick = (e) => { S.filters.hideOut = !S.filters.hideOut; e.currentTarget.setAttribute('aria-pressed', S.filters.hideOut); apply(); };
  $('#btnReset').onclick = () => {
    S.filters = { ...S.filters, q: '', radius: 0, fav: false, hideOut: true, sort: 'score' };
    $('#fSearch').value = ''; $('#fRadius').value = 0; $('#fArea').value = 0; $('#fSort').value = 'score';
    if (!$('#fPrice').disabled) $('#fPrice').value = $('#fPrice').max;
    $('#fFav').setAttribute('aria-pressed', 'false'); $('#fHideOut').setAttribute('aria-pressed', 'true');
    apply();
  };

  // tabs
  $('#tabCards').onclick = () => switchView('cards');
  $('#tabTable').onclick = () => switchView('table');

  // card interactions (delegated)
  $('#sideCards').addEventListener('click', (e) => {
    const card = e.target.closest('.card'); if (!card) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      const want = act.dataset.act;
      S.marks[card.dataset.id] = S.marks[card.dataset.id] === want ? undefined : want;
      save(LS.marks, S.marks); apply(); return;
    }
    if (e.target.closest('a')) return;
    focusRow(card.dataset.id);
  });
  $('#sideCards').addEventListener('mouseover', (e) => {
    const card = e.target.closest('.card'); if (card && card.dataset.id !== S.hot) setHot(card.dataset.id, false);
  });
  $('#sideCards').addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); focusRow(card.dataset.id); }
  });
  $('#sideTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) focusRow(tr.dataset.id); });

  // weights
  $('#weightGrid').addEventListener('input', debounce((e) => {
    const el = e.target.closest('[data-w]'); if (!el) return;
    S.weights[el.dataset.w] = +el.value;
    save(LS.weights, S.weights);
    renderWeightsUI(); apply();
  }, 80));
  $('#btnWeightReset').onclick = () => { S.weights = defaultWeights(); save(LS.weights, S.weights); renderWeightsUI(); apply(); };
}

function switchView(v) {
  S.view = v;
  $('#tabCards').classList.toggle('is-on', v === 'cards');
  $('#tabTable').classList.toggle('is-on', v === 'table');
  $('#tabCards').setAttribute('aria-selected', v === 'cards');
  $('#tabTable').setAttribute('aria-selected', v === 'table');
  $('#sideCards').classList.toggle('is-hidden', v !== 'cards');
  $('#sideTable').classList.toggle('is-hidden', v !== 'table');
}

/* ───────────────────── 12. Khởi động ───────────────────── */

function boot() {
  if (typeof L === 'undefined' || typeof Papa === 'undefined') {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:14px 18px;background:#d03b3b;color:#fff;margin:0">Không tải được thư viện bản đồ (Leaflet / PapaParse) — trang cần kết nối mạng lần đầu.</p>');
    return;
  }
  renderLegend();
  initMap();
  wire();

  const cached = load(LS.rows, null);
  if (cached && cached.records && cached.records.length) {
    ingest(cached.records, 'phiên trước');
  } else if (window.__BDS_DATA && window.__BDS_DATA.records) {
    ingest(window.__BDS_DATA.records, 'data/BDS.xlsx');
  } else if (window.__BDS_CSV) {
    ingest(parseDelimited(window.__BDS_CSV), 'CSV nhúng sẵn');
  } else {
    $('#dlgData').showModal();
  }
  const need = S.rows.filter((r) => r.lat == null && r.geoQuery);
  if (need.length && need.length <= 50 && !S.rows.some((r) => r.lat != null)) {
    geocodeMissing();                       // 1 yêu cầu/giây, kết quả lưu lại cho lần sau
  }
  if (S.anchor) $('#anchorHint').textContent = `${S.anchor.label || 'Điểm neo'} · ${S.anchor.lat.toFixed(4)}, ${S.anchor.lng.toFixed(4)}`;
}

document.addEventListener('DOMContentLoaded', boot);
