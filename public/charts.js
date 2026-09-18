/* ==========================================================================
   IT-ME Ticketing — tiny SVG chart kit (no dependencies, works offline)

   Viz.line(el, opts)      time series (crosshair + tooltip, optional area)
   Viz.bars(el, opts)      horizontal bars; stacked / 100% via opts.series
   Viz.columns(el, opts)   vertical columns; stacked via opts.series
   Viz.donut(el, opts)     part-to-whole (<= 6 slices) with legend
   Viz.heatmap(el, opts)   rows × cols on a single-hue sequential ramp

   Conventions (see the dataviz method): one axis, thin marks, 4px rounded
   data-ends, 2px surface gaps, hairline solid grid, legend for >= 2 series,
   selective direct labels, text in ink tokens (never the series colour),
   every mark reachable by pointer AND keyboard, clicks call opts.onSelect.
   Colours come from CSS custom properties so light/dark are both selected.
   ========================================================================== */
'use strict';
const Viz = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const css = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  const series = (i) => css(`--series-${(i % 5) + 1}`, '#2a78d6');
  const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }));
  const compact = (v) => {
    const n = Math.abs(v);
    if (n >= 1e6) return (v / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return (v / 1e3).toFixed(0) + 'K';
    return fmtNum(v);
  };

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, attrs = {}) {
    const t = el('text', { x, y, ...attrs }, parent);
    t.textContent = str;
    return t;
  }
  // Rough text width (system sans ≈ 0.56em per char) — good enough to avoid collisions.
  const textW = (s, size = 11) => String(s).length * size * 0.56;
  const truncate = (s, maxW, size = 12) => {
    s = String(s);
    if (textW(s, size) <= maxW) return s;
    const n = Math.max(1, Math.floor(maxW / (size * 0.56)) - 1);
    return s.slice(0, n) + '…';
  };

  // Nice ticks: 0..max in ~n steps of 1/2/5 × 10^k
  function niceTicks(max, n = 4) {
    if (!(max > 0)) return [0, 1];
    const raw = max / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }
  // Integer-only ticks for counts.
  function countTicks(max, n = 4) {
    const t = niceTicks(Math.max(max, 1), n).map((v) => Math.round(v));
    return [...new Set(t)];
  }

  // Path for a bar with 4px rounded data-end, square at the baseline.
  function barPath(x, y, w, h, dir, r = 4) {
    if (w <= 0 || h <= 0) return '';
    if (dir === 'right') {
      r = Math.min(r, h / 2, w);
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }
    // up
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ---- tooltip (one for the page) -----------------------------------------
  let tip;
  function tooltip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  // rows: [{ color, label, value, shape: 'line'|'box' }]
  function showTip(clientX, clientY, title, rows, foot) {
    const t = tooltip();
    t.textContent = '';
    if (title) {
      const h = document.createElement('div');
      h.className = 'viz-tip-title';
      h.textContent = title;
      t.appendChild(h);
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'viz-tip-row';
      const key = document.createElement('i');
      key.className = 'viz-key ' + (r.shape === 'line' ? 'is-line' : 'is-box');
      key.style.setProperty('--k', r.color || 'transparent');
      const v = document.createElement('b');
      v.textContent = r.value;
      const l = document.createElement('span');
      l.textContent = r.label;
      row.append(key, v, l);
      t.appendChild(row);
    }
    if (foot) {
      const f = document.createElement('div');
      f.className = 'viz-tip-foot';
      f.textContent = foot;
      t.appendChild(f);
    }
    t.hidden = false;
    const pad = 14;
    const r = t.getBoundingClientRect();
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  window.addEventListener('scroll', hideTip, { passive: true });

  // Anchor a tooltip to an element (keyboard focus).
  function tipAtElement(node, title, rows, foot) {
    const r = node.getBoundingClientRect();
    showTip(r.left + r.width / 2, r.top, title, rows, foot);
  }

  // Legend (HTML, above the plot).
  function legend(host, items, shape) {
    const lg = document.createElement('div');
    lg.className = 'viz-legend';
    for (const it of items) {
      const s = document.createElement('span');
      s.className = 'viz-legend-item';
      const k = document.createElement('i');
      k.className = 'viz-key ' + (shape === 'line' ? 'is-line' : 'is-box');
      k.style.setProperty('--k', it.color);
      const l = document.createElement('span');
      l.textContent = it.label;
      s.append(k, l);
      lg.appendChild(s);
    }
    host.appendChild(lg);
  }

  // Mount: clears the host, re-renders on resize, returns { svg, width }.
  const observers = new WeakMap();
  function mount(host, render) {
    if (!observers.has(host)) {
      let last = 0;
      let raf = 0;
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (!w || Math.abs(w - last) < 4) return;
        last = w;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => host._vizRender && host._vizRender());
      });
      ro.observe(host);
      observers.set(host, ro);
    }
    host._vizRender = () => {
      hideTip();
      host.textContent = '';
      const width = Math.max(240, Math.floor(host.clientWidth));
      render(width);
    };
    host._vizRender();
  }
  function empty(host, msg) {
    const p = document.createElement('p');
    p.className = 'viz-empty';
    p.textContent = msg || 'No data for these filters';
    host.appendChild(p);
  }
  function selectable(node, fn) {
    if (!fn) return;
    node.classList.add('is-selectable');
    node.addEventListener('click', fn);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }

  // ---- line --------------------------------------------------------------
  // opts: { labels[], tipLabels[], series: [{ name, values[], color }], height,
  //         format(v), area, onSelect(index) }
  function line(host, opts) {
    mount(host, (W) => {
      const S = opts.series.map((s, i) => ({ ...s, color: s.color || series(i) }));
      const n = opts.labels.length;
      const max = Math.max(0, ...S.flatMap((s) => s.values));
      if (!n || (max === 0 && opts.hideEmpty)) return empty(host, opts.emptyText);
      if (S.length > 1) legend(host, S.map((s) => ({ label: s.name, color: s.color })), 'line');
      const H = opts.height || 240;
      const ticks = countTicks(max, 4);
      const top = ticks[ticks.length - 1] || 1;
      const fmt = opts.format || fmtNum;
      const m = { t: 14, r: 44, b: 28, l: Math.max(28, textW(compact(top)) + 14) };
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
      const y = (v) => m.t + ih - (v / top) * ih;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': opts.aria || 'Line chart', tabindex: 0 }, host);
      const grid = el('g', { class: 'viz-grid' }, svg);
      for (const t of ticks) {
        el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'viz-base' : 'viz-gridline' }, grid);
        text(grid, m.l - 8, y(t) + 4, compact(t), { class: 'viz-tick', 'text-anchor': 'end' });
      }
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
      for (let i = 0; i < n; i += every) {
        text(grid, x(i), H - 8, opts.labels[i], { class: 'viz-tick', 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : 'middle' });
      }
      for (const s of S) {
        const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        if (opts.area) {
          el('polygon', { points: `${x(0)},${y(0)} ${pts.join(' ')} ${x(n - 1)},${y(0)}`, fill: s.color, class: 'viz-area' }, svg);
        }
        el('polyline', { points: pts.join(' '), stroke: s.color, class: 'viz-line' }, svg);
      }
      // End markers + selective end labels (skip when they would collide).
      const ends = S.map((s) => ({ s, v: s.values[n - 1], yy: y(s.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
      const collide = ends.some((e, i) => i && Math.abs(e.yy - ends[i - 1].yy) < 14);
      for (const e of ends) {
        el('circle', { cx: x(n - 1), cy: e.yy, r: 4, fill: e.s.color, class: 'viz-dot' }, svg);
        if (!collide && S.length <= 4) text(svg, x(n - 1) + 8, e.yy + 4, compact(e.v), { class: 'viz-label' });
      }
      // Crosshair layer
      const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'viz-cross', visibility: 'hidden' }, svg);
      const hot = S.map((s) => el('circle', { r: 4, fill: s.color, class: 'viz-dot', visibility: 'hidden' }, svg));
      const hit = el('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent', class: opts.onSelect ? 'is-selectable' : '' }, svg);
      let current = n - 1;
      const at = (i, cx, cy) => {
        current = i;
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
        cross.setAttribute('visibility', 'visible');
        S.forEach((s, k) => { hot[k].setAttribute('cx', x(i)); hot[k].setAttribute('cy', y(s.values[i])); hot[k].setAttribute('visibility', 'visible'); });
        const rows = S.map((s) => ({ color: s.color, label: s.name, value: fmt(s.values[i]), shape: 'line' }));
        const title = (opts.tipLabels || opts.labels)[i];
        if (cx == null) { const r = svg.getBoundingClientRect(); showTip(r.left + x(i), r.top + m.t, title, rows, opts.onSelect ? 'Click to filter to this period' : ''); }
        else showTip(cx, cy, title, rows, opts.onSelect ? 'Click to filter to this period' : '');
      };
      const off = () => { cross.setAttribute('visibility', 'hidden'); hot.forEach((h) => h.setAttribute('visibility', 'hidden')); hideTip(); };
      const idxAt = (clientX) => {
        const r = svg.getBoundingClientRect();
        const px = ((clientX - r.left) / r.width) * W;
        return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      };
      hit.addEventListener('pointermove', (e) => at(idxAt(e.clientX), e.clientX, e.clientY));
      hit.addEventListener('pointerleave', off);
      if (opts.onSelect) hit.addEventListener('click', (e) => opts.onSelect(idxAt(e.clientX)));
      svg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          at(Math.max(0, Math.min(n - 1, current + (e.key === 'ArrowRight' ? 1 : -1))));
        } else if ((e.key === 'Enter' || e.key === ' ') && opts.onSelect) { e.preventDefault(); opts.onSelect(current); }
      });
      svg.addEventListener('focus', () => at(current));
      svg.addEventListener('blur', off);
    });
  }

  // ---- horizontal bars -----------------------------------------------------
  // opts: { items: [{ key, label, value | values[], note, selectable }],
  //         series?: [{ name, color }], percent?, format(v), onSelect(item),
  //         labelWidth, color, tipFoot }
  function bars(host, opts) {
    mount(host, (W) => {
      const items = opts.items || [];
      if (!items.length || items.every((it) => (it.values ? it.values.reduce((a, b) => a + b, 0) : it.value) === 0)) return empty(host, opts.emptyText);
      const stacked = Array.isArray(opts.series);
      const S = stacked ? opts.series.map((s, i) => ({ ...s, color: s.color || series(i) })) : [{ name: opts.valueName || 'Tickets', color: opts.color || series(0) }];
      if (stacked && S.length > 1) legend(host, S.map((s) => ({ label: s.name, color: s.color })), 'box');
      const totals = items.map((it) => (stacked ? it.values.reduce((a, b) => a + b, 0) : it.value));
      const fmt = opts.format || fmtNum;
      const labelW = Math.min((opts.labelWidth || 150) * (W > 760 ? 1.5 : 1), Math.max(70, W * 0.36));
      const valueW = opts.percent ? 48 : Math.max(34, textW(fmt(Math.max(...totals))) + 14);
      const rowH = opts.rowHeight || 30;
      const barH = Math.min(18, rowH - 10);
      const H = items.length * rowH + 6;
      const iw = W - labelW - valueW - 8;
      const max = opts.percent ? 1 : Math.max(1, ...totals);
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'list', 'aria-label': opts.aria || 'Bar chart' }, host);
      el('line', { x1: labelW, x2: labelW, y1: 0, y2: H, class: 'viz-base' }, svg);
      items.forEach((it, r) => {
        const y0 = r * rowH + (rowH - barH) / 2 + 3;
        const total = totals[r];
        const g = el('g', { class: 'viz-row', tabindex: 0, role: 'listitem', 'aria-label': `${it.label}: ${fmt(total)}` }, svg);
        el('rect', { x: 0, y: r * rowH + 2, width: W, height: rowH - 2, class: 'viz-hitrow' }, g);
        text(g, labelW - 8, y0 + barH / 2 + 4, truncate(it.label, labelW - 12), { class: 'viz-cat', 'text-anchor': 'end' });
        const vals = stacked ? it.values : [it.value];
        let x0 = labelW;
        const segs = vals.map((v, k) => ({ v, k })).filter((s) => s.v > 0);
        segs.forEach((s, idx) => {
          const share = opts.percent ? (total ? s.v / total : 0) : s.v / max;
          let w = share * iw;
          const last = idx === segs.length - 1;
          const gap = last ? 0 : 2;
          w = Math.max(0, w - gap);
          el('path', { d: last ? barPath(x0, y0, w, barH, 'right') : `M${x0},${y0}h${w}v${barH}h${-w}Z`, fill: S[s.k].color, class: 'viz-bar' }, g);
          x0 += w + gap;
        });
        const valText = opts.percent ? (it.pct == null ? '—' : `${it.pct}%`) : fmt(total);
        text(g, (opts.percent ? labelW + iw : x0) + 6, y0 + barH / 2 + 4, valText, { class: 'viz-label' });
        const rows = stacked
          ? S.map((s, k) => ({ color: s.color, label: s.name, value: opts.percent && total ? `${fmt(vals[k])} (${Math.round((vals[k] / total) * 100)}%)` : fmt(vals[k]) }))
          : [{ color: S[0].color, label: S[0].name, value: fmt(total) }];
        const canSelect = opts.onSelect && it.selectable !== false;
        const foot = [it.note, canSelect ? (opts.tipFoot || 'Click to filter') : ''].filter(Boolean).join(' · ');
        g.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, it.tipLabel || it.label, rows, foot));
        g.addEventListener('pointerleave', hideTip);
        g.addEventListener('focus', () => tipAtElement(g, it.tipLabel || it.label, rows, foot));
        g.addEventListener('blur', hideTip);
        if (canSelect) selectable(g, () => opts.onSelect(it));
      });
    });
  }

  // ---- vertical columns ------------------------------------------------------
  // opts: { labels[], tipLabels[], series: [{ name, values[], color }], stacked, format, onSelect(i), height }
  function columns(host, opts) {
    mount(host, (W) => {
      const S = opts.series.map((s, i) => ({ ...s, color: s.color || series(i) }));
      const n = opts.labels.length;
      const totals = opts.labels.map((_, i) => S.reduce((a, s) => a + (s.values[i] || 0), 0));
      if (!n || totals.every((v) => !v)) return empty(host, opts.emptyText);
      if (S.length > 1) legend(host, S.map((s) => ({ label: s.name, color: s.color })), 'box');
      const H = opts.height || 220;
      const fmt = opts.format || fmtNum;
      const max = Math.max(...totals);
      const ticks = countTicks(max, 4);
      const top = ticks[ticks.length - 1] || 1;
      const m = { t: 18, r: 8, b: 30, l: Math.max(28, textW(compact(top)) + 14) };
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const band = iw / n;
      const bw = Math.max(4, Math.min(24, band * 0.62));
      const y = (v) => m.t + ih - (v / top) * ih;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'list', 'aria-label': opts.aria || 'Column chart' }, host);
      for (const t of ticks) {
        el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'viz-base' : 'viz-gridline' }, svg);
        text(svg, m.l - 8, y(t) + 4, compact(t), { class: 'viz-tick', 'text-anchor': 'end' });
      }
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
      const labelEach = n <= 12 && S.length === 1 && band > 26;
      opts.labels.forEach((lab, i) => {
        const cx = m.l + band * i + band / 2;
        const g = el('g', { class: 'viz-row', tabindex: 0, role: 'listitem', 'aria-label': `${lab}: ${fmt(totals[i])}` }, svg);
        el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, class: 'viz-hitrow' }, g);
        let yTop = y(0);
        const segs = S.map((s, k) => ({ v: s.values[i] || 0, k })).filter((s) => s.v > 0);
        segs.forEach((s, idx) => {
          const last = idx === segs.length - 1;
          const h = Math.max(0, (s.v / top) * ih - (last ? 0 : 2));
          yTop -= h;
          el('path', { d: last ? barPath(cx - bw / 2, yTop, bw, h, 'up') : `M${cx - bw / 2},${yTop}h${bw}v${h}h${-bw}Z`, fill: S[s.k].color, class: 'viz-bar' }, g);
          if (!last) yTop -= 2;
        });
        if (labelEach && totals[i]) text(g, cx, yTop - 5, compact(totals[i]), { class: 'viz-label', 'text-anchor': 'middle' });
        if (i % every === 0) text(svg, cx, H - 10, truncate(lab, band * every - 4, 11), { class: 'viz-tick', 'text-anchor': 'middle' });
        const rows = S.map((s) => ({ color: s.color, label: s.name, value: fmt(s.values[i] || 0) }));
        const title = (opts.tipLabels || opts.labels)[i];
        const foot = opts.onSelect ? (opts.tipFoot || 'Click to filter') : '';
        if (S.length > 1) rows.push({ color: 'transparent', label: 'Total', value: fmt(totals[i]) });
        g.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, title, rows, foot));
        g.addEventListener('pointerleave', hideTip);
        g.addEventListener('focus', () => tipAtElement(g, title, rows, foot));
        g.addEventListener('blur', hideTip);
        if (opts.onSelect) selectable(g, () => opts.onSelect(i));
      });
    });
  }

  // ---- donut ---------------------------------------------------------------
  // opts: { items: [{ key, label, value, color }], centerLabel, format, onSelect(item) }
  function donut(host, opts) {
    mount(host, (W) => {
      const items = opts.items.filter((it) => it.value > 0);
      const total = items.reduce((a, b) => a + b.value, 0);
      if (!total) return empty(host, opts.emptyText);
      const fmt = opts.format || fmtNum;
      const wrap = document.createElement('div');
      wrap.className = 'viz-donut';
      host.appendChild(wrap);
      const size = Math.min(180, Math.max(140, W * 0.42));
      const R = size / 2;
      const r = R - 22;
      const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'viz-svg', role: 'list', 'aria-label': opts.aria || 'Donut chart' }, wrap);
      let a0 = -Math.PI / 2;
      const gap = items.length > 1 ? 0.03 : 0;
      const arc = (a1, a2) => {
        const large = a2 - a1 > Math.PI ? 1 : 0;
        const p = (a, rad) => `${R + rad * Math.cos(a)},${R + rad * Math.sin(a)}`;
        return `M${p(a1, R - 2)}A${R - 2},${R - 2} 0 ${large} 1 ${p(a2, R - 2)}L${p(a2, r)}A${r},${r} 0 ${large} 0 ${p(a1, r)}Z`;
      };
      const list = document.createElement('div');
      list.className = 'viz-donut-legend';
      items.forEach((it) => {
        const span = (it.value / total) * Math.PI * 2;
        const a1 = a0 + gap / 2;
        const a2 = a0 + span - gap / 2;
        const g = el('g', { class: 'viz-row', tabindex: 0, role: 'listitem', 'aria-label': `${it.label}: ${fmt(it.value)}` }, svg);
        const d = span >= Math.PI * 2 - 0.001
          ? `M${R},2A${R - 2},${R - 2} 0 1 1 ${R - 0.01},2L${R - 0.01},${R - r}A${r},${r} 0 1 0 ${R},${R - r}Z`
          : arc(a1, Math.max(a1 + 0.001, a2));
        el('path', { d, fill: it.color, class: 'viz-bar' }, g);
        a0 += span;
        const pct = Math.round((it.value / total) * 1000) / 10;
        const rows = [{ color: it.color, label: it.label, value: `${fmt(it.value)} (${pct}%)` }];
        const foot = opts.onSelect ? 'Click to filter' : '';
        g.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, '', rows, foot));
        g.addEventListener('pointerleave', hideTip);
        g.addEventListener('focus', () => tipAtElement(g, '', rows, foot));
        g.addEventListener('blur', hideTip);
        // Legend row doubles as the direct label.
        const row = document.createElement(opts.onSelect ? 'button' : 'div');
        if (opts.onSelect) row.type = 'button';
        row.className = 'viz-donut-row';
        const k = document.createElement('i');
        k.className = 'viz-key is-box';
        k.style.setProperty('--k', it.color);
        const l = document.createElement('span');
        l.textContent = it.label;
        const v = document.createElement('b');
        v.textContent = fmt(it.value);
        const p = document.createElement('em');
        p.textContent = `${pct}%`;
        row.append(k, l, v, p);
        list.appendChild(row);
        if (opts.onSelect) {
          selectable(g, () => opts.onSelect(it));
          row.addEventListener('click', () => opts.onSelect(it));
        }
      });
      text(svg, R, R - 2, compact(total), { class: 'viz-center', 'text-anchor': 'middle' });
      text(svg, R, R + 16, opts.centerLabel || 'total', { class: 'viz-center-sub', 'text-anchor': 'middle' });
      wrap.appendChild(list);
    });
  }

  // ---- heatmap -------------------------------------------------------------
  // opts: { rows[], cols[], values[][], format, rowTitle, colTitle }
  function heatmap(host, opts) {
    mount(host, (W) => {
      const max = Math.max(0, ...opts.values.flat());
      if (!max) return empty(host, opts.emptyText);
      const fmt = opts.format || fmtNum;
      const ramp = [1, 2, 3, 4, 5, 6, 7].map((i) => css(`--seq-${i}`, '#2a78d6'));
      const zero = css('--viz-zero', '#eef1f7');
      const nr = opts.rows.length;
      const nc = opts.cols.length;
      const m = { t: 6, r: 4, b: 24, l: 40 };
      const cw = Math.max(8, (W - m.l - m.r) / nc);
      const ch = Math.min(26, Math.max(16, cw * 0.9));
      const H = m.t + nr * ch + m.b;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'grid', 'aria-label': opts.aria || 'Heatmap' }, host);
      opts.rows.forEach((rl, r) => {
        text(svg, m.l - 8, m.t + r * ch + ch / 2 + 4, rl, { class: 'viz-tick', 'text-anchor': 'end' });
        opts.cols.forEach((cl, c) => {
          const v = opts.values[r][c] || 0;
          const step = v ? Math.min(ramp.length - 1, Math.floor((v / max) * (ramp.length - 0.001))) : -1;
          const g = el('g', { class: 'viz-row', tabindex: c === 0 ? 0 : -1, role: 'gridcell', 'aria-label': `${rl} ${cl}: ${fmt(v)}` }, svg);
          el('rect', { x: m.l + c * cw + 1, y: m.t + r * ch + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 3, fill: step < 0 ? zero : ramp[step], class: 'viz-cell' }, g);
          const rows = [{ color: step < 0 ? zero : ramp[step], label: 'tickets', value: fmt(v) }];
          const title = `${rl} · ${cl}${opts.colSuffix || ''}`;
          g.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, title, rows));
          g.addEventListener('pointerleave', hideTip);
          g.addEventListener('focus', () => tipAtElement(g, title, rows));
          g.addEventListener('blur', hideTip);
          g.addEventListener('keydown', (e) => {
            const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
            const mv = moves[e.key];
            if (!mv) return;
            e.preventDefault();
            const cells = svg.querySelectorAll('g.viz-row');
            const nr2 = Math.max(0, Math.min(nr - 1, r + mv[0]));
            const nc2 = Math.max(0, Math.min(nc - 1, c + mv[1]));
            const target = cells[nr2 * nc + nc2];
            if (target) { target.setAttribute('tabindex', 0); target.focus(); }
          });
        });
      });
      const every = cw < 22 ? 3 : cw < 34 ? 2 : 1;
      opts.cols.forEach((cl, c) => {
        if (c % every === 0) text(svg, m.l + c * cw + cw / 2, H - 8, cl, { class: 'viz-tick', 'text-anchor': 'middle' });
      });
      // Scale legend
      const sc = document.createElement('div');
      sc.className = 'viz-scale';
      const lo = document.createElement('span'); lo.textContent = '0';
      const bar = document.createElement('i');
      bar.style.background = `linear-gradient(90deg, ${zero}, ${ramp.join(', ')})`;
      const hi = document.createElement('span'); hi.textContent = fmt(max);
      sc.append(lo, bar, hi);
      host.appendChild(sc);
    });
  }

  // ---- data helpers ----------------------------------------------------------
  // Spreadsheet-safe CSV (same rule as the server).
  const FORMULA = /^(?:[=@\t\r]|[+-](?![\d\s().-]*$))/;
  function toCsv(columns, rows) {
    const escCell = (v) => {
      if (v == null) return '';
      let s = String(v);
      if (typeof v === 'string' && FORMULA.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [columns.map((c) => escCell(c.header)).join(',')];
    for (const r of rows) lines.push(columns.map((c) => escCell(typeof c.key === 'function' ? c.key(r) : r[c.key])).join(','));
    return '﻿' + lines.join('\r\n');
  }
  function downloadBlob(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  // Table view twin of a chart (always available, keyboard/screen-reader friendly).
  function table(host, columns, rows) {
    host.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap viz-table';
    const t = document.createElement('table');
    t.className = 'data';
    const thead = t.createTHead().insertRow();
    for (const c of columns) {
      const th = document.createElement('th');
      th.textContent = c.header;
      if (c.num) th.className = 'num';
      thead.appendChild(th);
    }
    const tb = t.createTBody();
    for (const r of rows) {
      const tr = tb.insertRow();
      for (const c of columns) {
        const td = tr.insertCell();
        const v = typeof c.key === 'function' ? c.key(r) : r[c.key];
        td.textContent = v == null || v === '' ? '—' : (c.num && typeof v === 'number' ? fmtNum(v) : String(v));
        if (c.num) td.className = 'num';
      }
    }
    if (!rows.length) {
      const tr = tb.insertRow();
      const td = tr.insertCell();
      td.colSpan = columns.length;
      td.className = 'empty-cell';
      td.textContent = 'No data';
    }
    wrap.appendChild(t);
    host.appendChild(wrap);
  }

  return { line, bars, columns, donut, heatmap, table, toCsv, downloadBlob, fmtNum, compact, series, hideTip };
})();
