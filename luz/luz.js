/* Luz (לוז) – weekly schedule story, rendered from the Arbox schedule API.
 *
 * Used by luz/index.html (wizard) and luz/embed.html, and injectable into any site:
 *   <div id="luz-schedule"></div>
 *   <script src="https://admin.yoga-house.co/luz/luz.js" data-luz data-target="#luz-schedule" data-c="…" async></script>
 *
 * All visual edits live in one compressed config string (`?c=` / `data-c`). Shape:
 *   { v, week, bg, color, logo, title, sub, range, fmt,
 *     rename: {category: label}, coach: {fullName: label},
 *     series: {seriesId: {new, hide, label}},   // every week
 *     one:    {scheduleId: {new, hide, label}}, // this occurrence only
 *     notes:  {"YYYY-MM-DD": text},
 *     extra:  [{date, time, label, new}] }
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const BASE = new URL('.', (script && script.src) || location.href).href;

  // ==================== CONFIG ====================
  const ARBOX_SCHEDULE_API = 'https://apiappv2.arboxapp.com/api/v2/site/schedule/betweenDates?XDEBUG_SESSION_START=PHPSTORM';
  const BOX_FK = '17885';
  const LOCATIONS_BOX_ID = 14927;

  const HIDDEN_CATEGORIES = new Set(['תרגול אונליין']);

  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const PALETTE = ['#beada6', '#a3a692', '#b8bea3', '#d9cbb6', '#4d4d4d'];
  // Pose cutouts placed in 1080×1920 design pixels
  const BGS = {
    'pose-1': { src: 'assets/pose-1.png', style: 'width:2450px;left:-470px;bottom:-10px;opacity:.3' },
    'pose-2': { src: 'assets/pose-2.png', style: 'width:1250px;left:-80px;bottom:-40px;opacity:.28' },
    'pose-3': { src: 'assets/pose-3.png', style: 'width:1000px;left:-120px;bottom:0;opacity:.28' },
    'plain': null
  };
  const DEFAULTS = { bg: 'pose-1', color: PALETTE[0], logo: true, sub: 'לוח שיעורים', title: 'בית של יוגה', fmt: 'cat-coach' };

  // ==================== DATE UTILS ====================
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const weekOf = d => iso(addDays(d, -d.getDay()));

  // From Friday 14:00 the "current" week is the upcoming one, ready for the weekend story post
  function defaultWeek(now = new Date()) {
    const roll = now.getDay() === 6 || (now.getDay() === 5 && now.getHours() >= 14);
    return weekOf(roll ? addDays(now, 7) : now);
  }

  function weekDates(sunIso) {
    const sun = parseISO(sunIso);
    return DAYS.map((_, i) => iso(addDays(sun, i)));
  }

  // "10-16/5" within a month, "26/4-1/5" across months
  function rangeLabel(sunIso) {
    const a = parseISO(sunIso), b = addDays(a, 6);
    const dm = d => `${d.getDate()}/${d.getMonth() + 1}`;
    return a.getMonth() === b.getMonth() ? `${a.getDate()}-${dm(b)}` : `${dm(a)}-${dm(b)}`;
  }

  // ==================== API ====================
  const cache = new Map();

  function normalize(it) {
    if (!it || it.status !== 'active') return null;
    return {
      id: String(it.id),
      series: it.series_fk ? String(it.series_fk) : '',
      date: it.date,
      time: String(it.time || '').slice(0, 5),
      end: String(it.end_time || '').slice(0, 5),
      cat: (it.box_categories && it.box_categories.name || '').trim(),
      coach: (it.coach && it.coach.full_name || '').trim(),
      coachFirst: (it.coach && it.coach.first_name || '').trim(),
      coachLast: (it.coach && it.coach.last_name || '').trim()
    };
  }

  function fetchWeek(sunIso, { force = false } = {}) {
    if (!force && cache.has(sunIso)) return cache.get(sunIso);
    const dates = weekDates(sunIso);
    const p = fetch(ARBOX_SCHEDULE_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'boxfk': BOX_FK,
        'identifier': 'yogahouse',
        'lang': 'en',
        'newsite': '1',
        'referername': 'plugin',
        'whitelabel': 'Arbox'
      },
      body: JSON.stringify({ from: dates[0], to: dates[6], locations_box_id: LOCATIONS_BOX_ID })
    })
      .then(res => { if (!res.ok) throw new Error(`Arbox ${res.status}`); return res.json(); })
      .then(payload => (Array.isArray(payload && payload.data) ? payload.data : [])
        .map(normalize).filter(c => c && !HIDDEN_CATEGORIES.has(c.cat))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    cache.set(sunIso, p);
    p.catch(() => cache.delete(sunIso));
    return p;
  }

  // ==================== CONFIG <-> URL ====================
  function b64uEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  async function pipeBytes(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  // Drop empty strings / objects / arrays and false flags so the URL stays short
  function prune(v) {
    if (Array.isArray(v)) {
      const a = v.map(prune).filter(x => x !== undefined);
      return a.length ? a : undefined;
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== undefined) o[k] = p; }
      return Object.keys(o).length ? o : undefined;
    }
    if (v === '' || v === null || v === undefined || v === false) return undefined;
    return v;
  }

  async function encode(cfg) {
    const pruned = prune(Object.assign({}, cfg, { v: 1 }));
    // keep explicit "logo off"
    if (cfg.logo === false) pruned.logo = 0;
    const bytes = new TextEncoder().encode(JSON.stringify(pruned));
    if (window.CompressionStream) return 'z' + b64uEncode(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    return 'j' + b64uEncode(bytes);
  }

  async function decode(str) {
    if (!str) return {};
    try {
      const bytes = b64uDecode(str.slice(1));
      const raw = str[0] === 'z' ? await pipeBytes(bytes, new DecompressionStream('deflate-raw')) : bytes;
      const cfg = JSON.parse(new TextDecoder().decode(raw));
      if (cfg.logo === 0) cfg.logo = false;
      return cfg && typeof cfg === 'object' ? cfg : {};
    } catch (e) {
      console.warn('luz: could not read config', e);
      return {};
    }
  }

  // ==================== MODEL ====================
  function overrideFor(cfg, c) {
    return Object.assign({}, c.series && cfg.series && cfg.series[c.series], cfg.one && cfg.one[c.id]);
  }

  // First names that belong to more than one coach this week get the last initial (טל א. / טל ר.)
  function sharedFirstNames(classes) {
    const byFirst = {};
    classes.forEach(c => { (byFirst[c.coachFirst] = byFirst[c.coachFirst] || new Set()).add(c.coach); });
    return new Set(Object.keys(byFirst).filter(f => byFirst[f].size > 1));
  }

  function coachLabel(cfg, c, shared) {
    if (cfg.coach && cfg.coach[c.coach]) return cfg.coach[c.coach];
    if (!shared.has(c.coachFirst)) return c.coachFirst;
    const last = c.coachLast || c.coach.slice(c.coachFirst.length).trim();
    return last ? `${c.coachFirst} ${last[0]}.` : c.coach;
  }

  function defaultText(cfg, c, shared) {
    const cat = (cfg.rename && cfg.rename[c.cat]) || c.cat;
    const coach = coachLabel(cfg, c, shared || sharedFirstNames([c]));
    if (cfg.fmt === 'coach') return coach || cat;
    if (cfg.fmt === 'coach-cat') return [coach, cat].filter(Boolean).join(' ');
    return [cat, coach].filter(Boolean).join(' - ');
  }

  function buildDays(cfg, classes, sunIso) {
    const dates = weekDates(sunIso);
    const shared = sharedFirstNames(classes);
    const days = dates.map((date, dow) => ({ date, dow, name: DAYS[dow], rows: [], note: (cfg.notes && cfg.notes[date]) || '' }));
    const byDate = Object.fromEntries(days.map(d => [d.date, d]));

    classes.forEach(c => {
      const day = byDate[c.date];
      if (!day) return;
      const o = overrideFor(cfg, c);
      if (o.hide) return;
      day.rows.push({ time: c.time, text: o.label || defaultText(cfg, c, shared), isNew: !!o.new });
    });
    (cfg.extra || []).forEach(e => {
      const day = byDate[e.date];
      if (day && (e.label || e.time)) day.rows.push({ time: e.time || '', text: e.label || '', isNew: !!e.new });
    });
    days.forEach(d => d.rows.sort((a, b) => a.time.localeCompare(b.time)));
    return days;
  }

  // ==================== RENDER ====================
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function dayHtml(d) {
    const rows = d.rows.map(r => `
      <div class="luz-row">
        <div class="luz-row-name">${r.isNew ? '<span class="luz-new">חדש!</span> ' : ''}${esc(r.text)}</div>
        <div class="luz-row-time">${esc(r.time)}</div>
      </div>`).join('');
    const note = d.note ? `<div class="luz-row luz-note">${esc(d.note)}</div>` : '';
    const empty = !rows && !note ? '<div class="luz-row luz-empty">—</div>' : '';
    return `
      <section class="luz-day${d.dow === 6 ? ' luz-sat' : ''}">
        <div class="luz-day-h">${esc(d.name)}</div>
        ${note}${rows}${empty}
      </section>`;
  }

  function storyHtml(cfg, days, sunIso, body) {
    const c = Object.assign({}, DEFAULTS, cfg);
    const bg = BGS[c.bg] === undefined ? BGS[DEFAULTS.bg] : BGS[c.bg];
    const range = cfg.range || (sunIso ? rangeLabel(sunIso) : '');
    return `
      <img class="luz-paper" src="${BASE}assets/paper.jpg" alt="">
      ${bg ? `<img class="luz-pose" src="${BASE}${bg.src}" style="${bg.style}" alt="">` : ''}
      <div class="luz-veil"></div>
      <div class="luz-content">
        <header class="luz-head">
          ${c.logo !== false ? `<img class="luz-logo" src="${BASE}assets/logo.png" alt="">` : ''}
          ${c.sub ? `<div class="luz-sub">${esc(c.sub)}</div>` : ''}
          ${c.title ? `<div class="luz-title">${esc(c.title)}</div>` : ''}
          ${range ? `<div class="luz-range">${esc(range)}</div>` : ''}
        </header>
        ${body != null ? `<div class="luz-msg">${esc(body)}</div>` : `<div class="luz-grid">${days.map(dayHtml).join('')}</div>`}
      </div>`;
  }

  // Shrink the day grid until it fits inside the 1920px canvas, then shrink any class name that overflows its one line
  function fit(el) {
    const grid = el.querySelector('.luz-grid');
    if (!grid) return;
    const names = grid.querySelectorAll('.luz-row-name');
    names.forEach(n => { n.style.fontSize = ''; });
    if (el.classList.contains('luz-fixed')) {
      let k = 1;
      el.style.setProperty('--k', k);
      while (grid.scrollHeight > grid.clientHeight + 1 && k > 0.55) {
        k = Math.round((k - 0.03) * 100) / 100;
        el.style.setProperty('--k', k);
      }
    }
    names.forEach(n => {
      if (n.scrollWidth <= n.clientWidth) return;
      const size = parseFloat(getComputedStyle(n).fontSize);
      n.style.fontSize = Math.floor(size * n.clientWidth / n.scrollWidth * 10) / 10 + 'px';
    });
  }

  function fluidSize(el) {
    const w = el.clientWidth || 1080;
    const one = w < 640;
    el.classList.toggle('luz-one', one);
    el.style.setProperty('--u', Math.min(1, w / (one ? 560 : 1080)) + 'px');
  }

  function prepare(el, cfg, mode) {
    el.classList.add('luz-story', mode === 'fluid' ? 'luz-fluid' : 'luz-fixed');
    el.classList.remove(mode === 'fluid' ? 'luz-fixed' : 'luz-fluid');
    el.style.setProperty('--head', cfg.color || DEFAULTS.color);
    if (mode === 'fluid' && !el._luzRO && window.ResizeObserver) {
      el._luzRO = new ResizeObserver(() => { fluidSize(el); fit(el); });
      el._luzRO.observe(el);
    }
    if (mode === 'fluid') fluidSize(el);
  }

  // Synchronous render once the classes are known
  function render(el, cfg, classes, sunIso, { mode = 'fixed' } = {}) {
    prepare(el, cfg, mode);
    el.innerHTML = storyHtml(cfg, buildDays(cfg, classes, sunIso), sunIso);
    fit(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit(el));
    el.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', () => fit(el), { once: true }); });
  }

  function renderMessage(el, cfg, sunIso, msg, { mode = 'fixed' } = {}) {
    prepare(el, cfg, mode);
    el.innerHTML = storyHtml(cfg, [], sunIso, msg);
  }

  // Fetch + render. Returns the classes so callers (the wizard) can reuse them.
  async function mount(el, cfg, opts = {}) {
    const sunIso = cfg.week || defaultWeek();
    renderMessage(el, cfg, sunIso, 'טוען…', opts);
    try {
      const classes = await fetchWeek(sunIso, opts);
      render(el, cfg, classes, sunIso, opts);
      return classes;
    } catch (e) {
      console.error('luz:', e);
      renderMessage(el, cfg, sunIso, 'לא הצלחנו לטעון את לוח השיעורים', opts);
      return null;
    }
  }

  function ensureStyles() {
    if (!document.querySelector('link[data-luz-font]')) {
      const f = document.createElement('link');
      f.rel = 'stylesheet';
      f.crossOrigin = 'anonymous';
      f.href = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&display=swap';
      f.setAttribute('data-luz-font', '');
      document.head.appendChild(f);
    }
    if (!document.querySelector('link[data-luz-css]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = BASE + 'luz.css';
      l.setAttribute('data-luz-css', '');
      document.head.appendChild(l);
    }
  }

  window.LUZ = {
    BASE, DAYS, PALETTE, BGS, DEFAULTS,
    iso, parseISO, addDays, weekOf, defaultWeek, weekDates, rangeLabel,
    fetchWeek, encode, decode, prune,
    overrideFor, sharedFirstNames, coachLabel, defaultText, buildDays,
    render, renderMessage, mount, fit, ensureStyles
  };

  // ==================== SCRIPT-INJECT MODE ====================
  if (script && script.hasAttribute('data-luz')) {
    const run = async () => {
      ensureStyles();
      const sel = script.getAttribute('data-target');
      let el = sel && document.querySelector(sel);
      if (!el) {
        el = document.createElement('div');
        script.parentNode.insertBefore(el, script);
      }
      const code = script.getAttribute('data-c') || new URL(script.src).searchParams.get('c') || '';
      mount(el, await decode(code), { mode: script.getAttribute('data-mode') || 'fluid' });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})();
