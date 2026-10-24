/* GridLight — a traffic light for your electricity.
   Pure client-side: no account, no data leaves the browser. */
(() => {
  "use strict";
  const RATES = window.GL_RATES, CARBON = window.GL_CARBON, APPS = window.GL_APPLIANCES;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt$ = (v) => (Math.abs(v) < 100 ? "$" + v.toFixed(2) : "$" + Math.round(v).toLocaleString("en-US"));
  const money = (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3).toLocaleString("en-US") + "k" : "$" + Math.round(v));
  const fmtC = (v) => (v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "¢";
  const fmtKg = (g) => (g >= 10000 ? Math.round(g / 1000).toLocaleString("en-US") : (g / 1000).toFixed(g < 1000 ? 2 : 1)) + " kg";
  const hh = (h) => { h = ((h % 24) + 24) % 24; const s = h % 12 === 0 ? 12 : h % 12; return s + (h < 12 ? " AM" : " PM"); };
  const hshort = (h) => { h = ((h % 24) + 24) % 24; const s = h % 12 === 0 ? 12 : h % 12; return s + (h < 12 ? "a" : "p"); };

  // ---------- state ----------
  const ptNow = () => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false, weekday: "short", month: "numeric" }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value;
    const dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { h: (+get("hour")) % 24, m: +get("minute"), dow: dows[get("weekday")], month: +get("month") };
  };
  const now0 = ptNow();
  const state = {
    plan: "E-TOU-C",
    above: false,
    season: now0.month >= 6 && now0.month <= 9 ? "summer" : "winter",
    dow: now0.dow,
    hour: now0.h, minute: now0.m,
    weight: 0.5, // 0 = only money, 1 = only carbon
    app: "dryer",
    live: null,
    household: null,
    shiftPct: 100,
    carbonPrice: 100, // $/t CO2
    horizon: 12,
    baselineKwh: 10,
    homes: 10000,
    mode: "any",
    follow: 30,
  };
  try { const q = new URLSearchParams(location.search); if (q.get("plan") && RATES[q.get("plan")]) state.plan = q.get("plan"); if (q.get("t")) { const [a, b] = q.get("t").split(":"); state.hour = +a; state.minute = +(b || 0); } if (q.get("season")) state.season = q.get("season"); if (q.get("dow")) state.dow = +q.get("dow"); } catch (e) {}

  // ---------- model ----------
  function priceAt(plan, season, h, dow, above) {
    const r = RATES[plan], per = r.periods(h, dow), v = r.prices[season][per];
    return { period: per, price: Array.isArray(v) ? v[above ? 1 : 0] : v };
  }
  function day(plan = state.plan, season = state.season, dow = state.dow, above = state.above) {
    const c = CARBON[season];
    const cmin = Math.min(...c), cmax = Math.max(...c), thr = cmin + 0.4 * (cmax - cmin);
    const hours = [];
    if (RATES[plan].dynamic) {
      // dynamic hourly prices: red = the day's priciest quarter; green = cheaper-than-median AND clean
      const r = RATES[plan], v = r.hourly[r.day], sorted = [...v].sort((a, b) => a - b);
      const q75 = sorted[18], med = (sorted[11] + sorted[12]) / 2;
      for (let h = 0; h < 24; h++) {
        const period = v[h] >= q75 ? "peak" : "off";
        const st = period === "peak" ? "r" : c[h] > thr || v[h] > med ? "a" : "g";
        hours.push({ h, period, price: v[h], carbon: c[h], st });
      }
      return hours;
    }
    for (let h = 0; h < 24; h++) {
      const { period, price } = priceAt(plan, season, h, dow, above);
      let st = "g";
      if (period === "peak") st = "r";
      else if (period === "part") st = "p";
      else if (c[h] > thr) st = "a";
      hours.push({ h, period, price, carbon: c[h], st });
    }
    return hours;
  }
  // score a window starting at s (may wrap into tomorrow) of length d with kWh spread evenly
  function windowCost(hours, s, d, kwh) {
    let cost = 0, g = 0; const per = kwh / d;
    for (let i = 0; i < d; i++) { const x = hours[(s + i) % 24]; cost += per * x.price; g += per * x.carbon; }
    return { s, cost, g };
  }
  function bestWindows(hours, d, kwh, fromHour, cprice, horizon) {
    const opts = []; const last = Math.max(1, (horizon || 24) - d + 1);
    for (let k = 0; k < last; k++) opts.push(windowCost(hours, (fromHour + k) % 24, d, kwh));
    opts.forEach((o, k) => { o.k = k; o.score = o.cost + (cprice * o.g) / 1e6; });
    const best = opts.reduce((a, b) => (b.score < a.score - 1e-9 ? b : a));
    const worst = opts.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a));
    return { now: opts[0], best, worst };
  }
  const label = { g: "Green", a: "Amber", p: "Amber", r: "Red" };
  const stClass = { g: "st-green", a: "st-amber", p: "st-amber", r: "st-red" };
  function nextChange(hours, h) {
    const cur = hours[h].st;
    for (let k = 1; k <= 24; k++) { const x = hours[(h + k) % 24]; if (x.st !== cur) return { k, x }; }
    return null;
  }
  function greenRuns(hours) {
    const runs = []; let s = null;
    for (let h = 0; h <= 24; h++) {
      const g = h < 24 && hours[h].st === "g";
      if (g && s === null) s = h; if (!g && s !== null) { runs.push([s, h]); s = null; }
    }
    return runs;
  }

  // ---------- icons ----------
  const ICON = {
    ev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V9l2-4h10l2 4v7"/><path d="M3 16h18v3H3z"/><path d="M12 8l-2 3h4l-2 3"/></svg>',
    dryer: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h2"/></svg>',
    dish: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M8 5.5h2"/><path d="M8 14h8"/></svg>',
    water: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 9c-1.5 2-2 3-2 4a2 2 0 004 0c0-1-.5-2-2-4z"/></svg>',
    washer: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8.5 12.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0"/></svg>',
  };

  // ---------- render: hero ----------
  function renderHero(hours) {
    const h = state.hour, x = hours[h];
    $$(".light span").forEach((el) => el.classList.toggle("on", el.dataset.st === x.st));
    const nc = nextChange(hours, h);
    const runs = greenRuns(hours);
    const headline = {
      g: "Green light: power is cheap <em>and</em> clean right now.",
      a: "Amber: cheap, but the grid is dirty right now.",
      p: "Amber: shoulder price. Wait if you can.",
      r: "Red: peak price. Hold big loads if you can.",
    }[x.st];
    $("#hero-pill").className = "status-pill " + stClass[x.st];
    $("#hero-pill").textContent = label[x.st] + " · " + hh(h) + " · " + (x.period === "peak" ? "peak" : x.period === "part" ? "part-peak" : "off-peak");
    $("#hero-h1").innerHTML = headline;
    const liveG = state.live && Math.abs(state.live.hour - h) <= 0 ? state.live.g : null;
    $("#k-price").textContent = fmtC(x.price) + "/kWh";
    $("#k-carbon").textContent = Math.round(liveG ?? x.carbon) + " g/kWh";
    $("#k-carbon-l").textContent = liveG != null ? "grid CO₂, live (CAISO)" : "grid CO₂, typical this hour";
    if (nc) {
      const mins = nc.k * 60 - state.minute;
      const hrs = Math.floor(mins / 60), mm = mins % 60;
      $("#k-next").textContent = (hrs ? hrs + "h " : "") + String(mm).padStart(2, "0") + "m";
      $("#k-next-l").textContent = "until " + label[nc.x.st].toLowerCase() + " (" + hh(nc.x.h) + ")";
    }
    if (runs.length) {
      const cur = runs.find((r) => h < r[1]) || runs[0]; const tmr = !runs.find((r) => h < r[1]);
      $("#k-best").textContent = hh(cur[0]) + "–" + hh(cur[1]);
      $("#k-best-l").textContent = h >= cur[0] && h < cur[1] ? "green window, now" : tmr ? "next green window, tomorrow" : "next green window, today";
    } else { $("#k-best").textContent = "none today"; $("#k-best-l").textContent = "green window"; }
  }

  // ---------- render: day strip + 2 aligned charts (no dual axis) ----------
  function renderDay(hours) {
    const strip = $("#strip"); strip.innerHTML = "";
    hours.forEach((x) => {
      const d = document.createElement("div");
      d.className = x.st + (x.h === state.hour ? " now" : "");
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", hh(x.h) + ": " + label[x.st] + ", " + fmtC(x.price) + " per kWh, " + x.carbon + " grams CO2 per kWh");
      d.dataset.h = x.h;
      strip.appendChild(d);
    });
    $("#strip-labels").innerHTML = hours.map((x) => "<span>" + hshort(x.h) + "</span>").join("");
    drawChart("#chart-price", hours.map((x) => x.price * 100), { unit: "¢", color: "var(--price)", step: true, min: 0 });
    drawChart("#chart-carbon", hours.map((x) => x.carbon), { unit: " g", color: "var(--carbon)", fill: "var(--carbon-fill)", min: 0 });
    // insight: same-price hours with the biggest carbon gap
    const byPrice = {};
    hours.forEach((x) => { const k = x.price.toFixed(3); (byPrice[k] = byPrice[k] || []).push(x); });
    let best = null;
    Object.values(byPrice).forEach((arr) => {
      if (arr.length < 2) return;
      const lo = arr.reduce((a, b) => (b.carbon < a.carbon ? b : a)), hi = arr.reduce((a, b) => (b.carbon > a.carbon ? b : a));
      const ratio = hi.carbon / lo.carbon;
      if (!best || ratio > best.ratio) best = { lo, hi, ratio };
    });
    const peakHours = hours.filter((x) => x.period === "peak");
    const peakAvgC = peakHours.length ? peakHours.reduce((a, b) => a + b.carbon, 0) / peakHours.length : null;
    const night = hours.filter((x) => x.h >= 21 || x.h < 6);
    const nightC = night.reduce((a, b) => a + b.carbon, 0) / night.length;
    let msg = "";
    if (best && best.ratio > 1.3) {
      msg = "<b>Off-peak isn't one thing.</b> At " + hh(best.hi.h) + " and " + hh(best.lo.h) + " you pay the same " + fmtC(best.lo.price) + "/kWh on " + state.plan +
        ", but " + hh(best.hi.h) + " electricity carries <b>" + best.ratio.toFixed(1) + "×</b> the CO₂ (" + best.hi.carbon + " vs " + best.lo.carbon + " g/kWh).";
      if (peakAvgC && nightC > peakAvgC) msg += " On average, tonight's off-peak hours (9 PM–6 AM) are even dirtier than the peak itself (" + Math.round(nightC) + " vs " + Math.round(peakAvgC) + " g/kWh). A price signal alone can't tell 1 PM solar from 4 AM gas.";
    } else msg = "<b>Price and carbon agree today</b>: the cheapest hours are also the cleanest.";
    if (RATES[state.plan].dynamic) {
      const lo = hours.reduce((a, b) => (b.price < a.price ? b : a)), night = hours[3];
      msg = "<b>Hourly prices already follow the grid.</b> On SVCE's dynamic pilot, " + hh(lo.h) + " is the cheapest hour (" + (lo.price * 100).toFixed(1) + "¢) and one of the cleanest (" + lo.carbon + " g/kWh), while 3 AM costs " + (night.price * 100).toFixed(1) + "¢ at " + night.carbon + " g/kWh. GridLight reads these hourly prices as easily as a fixed TOU schedule.";
    }
    $("#insight").innerHTML = msg;
  }

  function drawChart(sel, vals, o) {
    const host = $(sel), narrow = host.clientWidth && host.clientWidth < 560, W = narrow ? 420 : 960, H = narrow ? 150 : 150, L = narrow ? 34 : 40, R = 8, T = 14, B = 22;
    const max = Math.max(...vals) * 1.15, min = o.min ?? 0;
    const x = (i) => L + (i / 24) * (W - L - R), y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const ticks = niceTicks(min, max, 3);
    let path = "", area = "";
    if (o.step) {
      vals.forEach((v, i) => { path += (i ? "L" : "M") + x(i) + "," + y(v) + "L" + x(i + 1) + "," + y(v); });
    } else {
      vals.forEach((v, i) => { path += (i ? "L" : "M") + (x(i) + x(i + 1)) / 2 + "," + y(v); });
      area = path + "L" + (x(23) + x(24)) / 2 + "," + y(min) + "L" + (x(0) + x(1)) / 2 + "," + y(min) + "Z";
    }
    const nowX = x(state.hour + state.minute / 60);
    host.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + host.dataset.label + '">' +
      '<g class="grid">' + ticks.map((t) => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>').join("") + "</g>" +
      '<g class="axis">' + ticks.map((t) => '<text x="' + (L - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + t + o.unit.trim() + "</text>").join("") +
      (narrow ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21]).map((h) => '<text x="' + x(h) + '" y="' + (H - 6) + '" text-anchor="start">' + hh(h) + "</text>").join("") + "</g>" +
      (area ? '<path d="' + area + '" fill="' + o.fill + '"/>' : "") +
      '<path d="' + path + '" fill="none" stroke="' + o.color + '" stroke-width="2" stroke-linejoin="round"/>' +
      (o.step && vals.filter((v, i) => i === 0 || vals[i - 1] !== v).length <= 6 ? vals.map((v, i) => (i === 0 || vals[i - 1] !== v ? '<text x="' + (x(i) + 3) + '" y="' + (y(v) - 5) + '" font-size="11" font-weight="600" fill="var(--text-2)">' + Math.round(v) + "¢</text>" : "")).join("") : "") +
      (o.step && vals.filter((v, i) => i === 0 || vals[i - 1] !== v).length > 6 ? [vals.indexOf(Math.min(...vals)), vals.indexOf(Math.max(...vals))].map((i) => '<text x="' + (x(i) + 3) + '" y="' + (y(vals[i]) - 5) + '" font-size="11" font-weight="600" fill="var(--text-2)">' + vals[i].toFixed(1) + "¢</text>").join("") : "") +
      '<line x1="' + nowX + '" x2="' + nowX + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<text x="' + (nowX + 4) + '" y="' + (T + 10) + '" font-size="11" fill="var(--text-2)">now</text>' +
      '<line class="xh" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--text-3)" stroke-width="1" opacity="0"/>' +
      '<rect class="hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/>' +
      "</svg>";
    host._geom = { W, L, R };
    ["#strip", "#strip-labels"].forEach((q) => { const el = $(q); el.style.marginLeft = (100 * L) / W + "%"; el.style.marginRight = (100 * R) / W + "%"; });
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }
  // synchronized hover across strip + both charts
  function bindHover() {
    const tip = $("#day-tip"), box = $("#day-box");
    const show = (h, clientX) => {
      const hours = day(); const x = hours[h];
      tip.innerHTML = "<b>" + hh(h) + "–" + hh(h + 1) + "</b> · " + label[x.st] + "<br>" + fmtC(x.price) + "/kWh · " + x.carbon + " g CO₂/kWh";
      const r = box.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(clientX - r.left, 80), r.width - 80) + "px";
      tip.style.top = "0px";
      tip.classList.add("show");
      $$(".chart").forEach((c) => {
        const g = c._geom; if (!g) return; const xh = $(".xh", c);
        const px = g.L + ((h + 0.5) / 24) * (g.W - g.L - g.R);
        xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", 1);
      });
    };
    const hide = () => { tip.classList.remove("show"); $$(".xh").forEach((l) => l.setAttribute("opacity", 0)); };
    box.addEventListener("pointermove", (e) => {
      const strip = $("#strip").getBoundingClientRect();
      const svg = $("#chart-price svg"); if (!svg) return;
      const sr = svg.getBoundingClientRect(); const g = $("#chart-price")._geom;
      const left = sr.left + (g.L / g.W) * sr.width, right = sr.left + ((g.W - g.R) / g.W) * sr.width;
      let frac;
      if (e.clientY < strip.bottom + 30) frac = (e.clientX - strip.left) / strip.width;
      else frac = (e.clientX - left) / (right - left);
      if (frac < 0 || frac >= 1) return hide();
      show(Math.floor(frac * 24), e.clientX);
    });
    box.addEventListener("pointerleave", hide);
  }

  // ---------- render: appliance planner ----------
  function renderApps() {
    const host = $("#apps");
    host.innerHTML = APPS.map((a) => '<button class="app' + (a.id === state.app ? " sel" : "") + '" data-id="' + a.id + '">' + ICON[a.icon] + "<b>" + a.name + "</b><span>" + a.kwh + " kWh · " + a.hours + " h</span></button>").join("");
    $$(".app", host).forEach((b) => b.addEventListener("click", () => { state.app = b.dataset.id; renderApps(); renderPlanner(); }));
  }
  function renderPlanner() {
    const a = APPS.find((x) => x.id === state.app);
    const hours = day();
    const r = bestWindows(hours, a.hours, a.kwh, state.hour, state.carbonPrice, Math.max(state.horizon, a.hours));
    const lbl = (o) => (o.k === 0 ? "Start now (" + hh(o.s) + ")" : "Start " + hh(o.s) + (state.hour + o.k >= 24 ? " tomorrow" : ""));
    const card = (o, cls, t) => '<div class="opt ' + cls + '"><div class="when">' + t + "</div><div class=\"big\">" + fmt$(o.cost) + '</div><div class="co2">' + fmtKg(o.g) + " CO₂ · " + lbl(o).replace("Start ", "") + "</div></div>";
    $("#compare").innerHTML = card(r.now, "", "If you start now") + card(r.best, "best", "GridLight pick") + card(r.worst, "", "Worst start in the next " + state.horizon + " h");
    const ds = r.now.cost - r.best.cost, dg = r.now.g - r.best.g;
    const dsw = r.worst.cost - r.best.cost, dgw = r.worst.g - r.best.g;
    let s;
    if (r.best.k === 0) s = "<b>Now is already the best time</b> for your " + a.name.toLowerCase() + " in the next " + state.horizon + " hours.";
    else s = "Waiting until <b>" + hh(r.best.s) + "</b> saves <b>" + fmt$(Math.max(0, ds)) + "</b> and <b>" + fmtKg(Math.max(0, dg)) + " of CO₂</b> (" + Math.round((100 * Math.max(0, dg)) / r.now.g) + "% less) versus starting now.";
    s += " <span class=\"muted\">Versus the worst slot: " + fmt$(dsw) + " and " + fmtKg(dgw) + " CO₂.</span>";
    if (a.id === "ev") {
      const six = windowCost(hours, 18, a.hours, a.kwh), n = 85; // ~85 charges ≈ 11,000 mi/yr
      s += "<br><span class=\"muted\">Versus plugging in at 6 PM every time, the GridLight pick is worth about " + fmt$(Math.max(0, (six.cost - r.best.cost) * n)) + " and " + Math.round(Math.max(0, (six.g - r.best.g) * n) / 1000) + " kg CO₂ a year (~85 charges ≈ 11,000 miles).</span>";
    }
    $("#saving").innerHTML = s;
    $("#edit-kwh").value = a.kwh; $("#edit-h").value = a.hours;
  }

  // ---------- Bill X-ray ----------
  // Green Button "Download My Data" CSV (PG&E style) or any CSV with a timestamp + kWh column.
  function parseUsageCSV(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    let hi = lines.findIndex((l) => /DATE/i.test(l) && /(START|TIME)/i.test(l) && /(USAGE|IMPORT|KWH|VALUE)/i.test(l));
    const out = new Map();
    const add = (dateStr, timeStr, kwh) => {
      const d = parseDate(dateStr); if (!d || !isFinite(kwh)) return;
      const hr = parseInt((timeStr || "0").split(":")[0], 10) % 24;
      const key = d + "T" + String(hr).padStart(2, "0");
      out.set(key, (out.get(key) || 0) + kwh);
    };
    if (hi >= 0) {
      const head = splitCSV(lines[hi]).map((s) => s.trim().toUpperCase());
      const iType = head.findIndex((s) => s === "TYPE");
      const iDate = head.findIndex((s) => s.startsWith("DATE"));
      const iStart = head.findIndex((s) => s.startsWith("START"));
      let iUse = head.findIndex((s) => s.startsWith("IMPORT")); if (iUse < 0) iUse = head.findIndex((s) => s.startsWith("USAGE") || s.includes("KWH") || s === "VALUE");
      const iUnits = head.findIndex((s) => s === "UNITS");
      for (let i = hi + 1; i < lines.length; i++) {
        const c = splitCSV(lines[i]); if (c.length < 3) continue;
        if (iType >= 0 && c[iType] && !/elec/i.test(c[iType])) continue;
        if (iUnits >= 0 && c[iUnits] && !/kwh/i.test(c[iUnits])) continue;
        add(c[iDate], c[iStart], parseFloat(String(c[iUse]).replace(/[^0-9.\-]/g, "")));
      }
    } else {
      for (const l of lines) {
        const c = splitCSV(l); if (c.length < 2) continue;
        const m = String(c[0]).match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})[ T](\d{1,2}:\d{2})/);
        if (m) add(m[1], m[2], parseFloat(c[c.length - 1]));
      }
    }
    if (out.size < 24) throw new Error("Couldn't find hourly or 15-minute electric usage in this file.");
    return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => ({ date: k.slice(0, 10), h: +k.slice(11), kwh: v }));
  }
  function splitCSV(line) {
    const out = []; let cur = "", q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out;
  }
  function parseDate(s) {
    if (!s) return null; s = s.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0"); }
    return null;
  }
  // Simulated household for the demo (clearly labelled): Bay Area home with an EV, 30 days.
  function sampleHousehold() {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = []; const start = new Date(Date.UTC(2025, 9, 1)); // Oct 1–30 (all winter-rate days)
    for (let d = 0; d < 30; d++) {
      const dt = new Date(start.getTime() + d * 864e5), date = dt.toISOString().slice(0, 10), dow = dt.getUTCDay();
      for (let h = 0; h < 24; h++) {
        let k = 0.28 + rnd() * 0.08;
        if (h >= 6 && h < 9) k += 0.35 + rnd() * 0.2;
        if (h >= 17 && h < 22) k += 0.7 + rnd() * 0.4;
        if (h === 19 && (dow === 2 || dow === 6)) k += 3.0; // dryer
        if (h === 20 && rnd() < 0.8) k += 1.5; // dishwasher
        if ((dow === 1 || dow === 4) && h >= 18 && h < 22) k += 7.2; // EV plugged in on arrival
        if ((dow === 2 || dow === 6) && (h >= 21 || h < 1)) k += 7.2; // EV on an off-peak (9 PM) timer
        rows.push({ date, h, kwh: Math.round(k * 1000) / 1000 });
      }
    }
    return rows;
  }
  function toGreenButtonCSV(rows) {
    let s = "Name,SAMPLE HOUSEHOLD (simulated)\nAddress,\"San Jose, CA\"\nAccount Number,0000000000\nService,Service 1\n\nTYPE,DATE,START TIME,END TIME,USAGE (kWh),COST,NOTES\n";
    rows.forEach((r) => { s += "Electric usage," + r.date + "," + String(r.h).padStart(2, "0") + ":00," + String(r.h).padStart(2, "0") + ":59," + r.kwh.toFixed(2) + ",,\n"; });
    return s;
  }
  function seasonOf(date) { const m = +date.slice(5, 7); return m >= 6 && m <= 9 ? "summer" : "winter"; }
  function dowOf(date) { return new Date(date + "T12:00:00Z").getUTCDay(); }
  // E-TOU-C: every kWh at the above-baseline price, minus a baseline credit on the first B kWh of each day
  // (credit = above − below). Shifting never changes the credit, only plan choice does.
  function evaluate(rows, plan, above) {
    let cost = 0, g = 0, kwh = 0; const by = { g: 0, a: 0, p: 0, r: 0 }, costBy = { g: 0, a: 0, p: 0, r: 0 };
    const cache = {}, perDay = {}; const hasBase = RATES[plan].baseline;
    rows.forEach((r) => {
      const key = seasonOf(r.date) + dowOf(r.date);
      const hours = cache[key] || (cache[key] = day(plan, seasonOf(r.date), dowOf(r.date), hasBase ? true : above));
      const x = hours[r.h];
      cost += r.kwh * x.price; g += r.kwh * x.carbon; kwh += r.kwh; by[x.st] += r.kwh; costBy[x.st] += r.kwh * x.price;
      perDay[r.date] = (perDay[r.date] || 0) + r.kwh;
    });
    if (hasBase) Object.entries(perDay).forEach(([d, k]) => { const pr = RATES[plan].prices[seasonOf(d)].off; cost -= (pr[1] - pr[0]) * Math.min(k, state.baselineKwh); });
    return { cost, g, kwh, by, costBy, days: new Set(rows.map((r) => r.date)).size };
  }
  // Move "big" flexible load (> 2.5 kWh/h above the home's own baseline) into the best hours of the same day.
  // mode "any": flexible load may go to any hour (car home midday, workplace charging); "night": 9 PM–7 AM only (car away by day)
  function shifted(rows, plan, above, pct, weight, mode) {
    const byDate = {}; rows.forEach((r) => (byDate[r.date] = byDate[r.date] || []).push({ ...r }));
    const out = []; let moved = 0;
    Object.entries(byDate).forEach(([date, arr]) => {
      const hours = day(plan, seasonOf(date), dowOf(date), above);
      const base = [...arr].map((r) => r.kwh).sort((a, b) => a - b)[Math.floor(arr.length * 0.5)] || 0.5;
      let pool = 0;
      arr.forEach((r) => { const ex = Math.max(0, r.kwh - Math.max(2.5, base * 3)); const m = ex * (pct / 100); r.kwh -= m; pool += m; });
      moved += pool;
      const order = hours.map((x) => ({ h: x.h, s: x.price + (weight * x.carbon) / 1e6 })).sort((a, b) => a.s - b.s);
      for (const o of order) {
        if (pool <= 1e-9) break;
        if (mode === "night" && !(o.h >= 21 || o.h < 7)) continue;
        const row = arr.find((r) => r.h === o.h); if (!row) continue;
        const room = Math.max(0, 7.2 - row.kwh); const put = Math.min(room, pool); row.kwh += put; pool -= put;
      }
      out.push(...arr);
    });
    return { rows: out, moved };
  }
  function renderXray() {
    const hh_ = state.household; const host = $("#xray-out");
    if (!hh_) { host.innerHTML = ""; return; }
    const xplan = RATES[state.plan].dynamic ? "E-ELEC" : state.plan;
    const rows = hh_.rows, ev = evaluate(rows, xplan, state.above), scale = 30 / ev.days;
    const pct = (v) => Math.round((100 * v) / ev.kwh);
    const sh = shifted(rows, xplan, state.above, state.shiftPct, state.carbonPrice, state.mode), ev2 = evaluate(sh.rows, xplan, state.above);
    const plans = Object.keys(RATES).filter((p) => !RATES[p].dynamic).map((p) => {
      const a = evaluate(rows, p, state.above), b = evaluate(shifted(rows, p, state.above, state.shiftPct, state.carbonPrice, state.mode).rows, p, state.above);
      return { p, a: a.cost * scale, b: b.cost * scale, gb: b.g * scale };
    });
    const bestPlan = plans.filter((r) => r.p !== "E-ELEC").reduce((x, y) => (y.b < x.b ? y : x)); // E-ELEC has a fixed Base Services Charge we don't model
    const peakLen = day(state.plan, "winter", 3).filter((x) => x.period === "peak").length || 1;
    const F = (state.homes * state.follow) / 100;
    const peakKw = Math.max(0, (ev.by.r - ev2.by.r) / ev.days / peakLen);
    host.innerHTML =
      '<p class="muted" style="margin:14px 0 0">' + hh_.name + " · " + ev.days + " days · figures scaled to 30 days · energy charges on " + xplan + (xplan !== state.plan ? " (pilot hourly prices are a signal, not a full bill)" : "") + "</p>" +
      '<div class="tiles">' +
      '<div class="tile"><b>' + Math.round(ev.kwh * scale) + ' kWh</b><span>per month</span></div>' +
      '<div class="tile"><b>' + fmt$(ev.cost * scale) + '</b><span>energy cost / month</span></div>' +
      '<div class="tile"><b>' + fmtKg(ev.g * scale) + '</b><span>grid CO₂ / month</span></div>' +
      '<div class="tile"><b>' + pct(ev.by.r) + '%</b><span>of kWh used in red hours</span></div></div>' +
      '<div class="chart-title">When your kWh happen</div>' +
      '<div class="share" role="img" aria-label="Share of usage: green ' + pct(ev.by.g) + "%, amber " + pct(ev.by.a) + "%, red " + pct(ev.by.r) + '%">' +
      ["g", "a", "p", "r"].filter((k) => ev.by[k] > 0).map((k) => '<div class="' + k + '" style="flex:' + ev.by[k] + '" title="' + label[k] + " " + pct(ev.by[k]) + '%">' + (pct(ev.by[k]) >= 13 ? label[k] + " " + pct(ev.by[k]) + "%" : pct(ev.by[k]) >= 6 ? pct(ev.by[k]) + "%" : "") + "</div>").join("") + "</div>" +
      '<div class="shift-row"><label for="shift">Shift <b id="shift-v">' + state.shiftPct + '%</b> of big flexible loads (EV charging, dryer, water heating) into better hours</label><input id="shift" type="range" min="0" max="100" step="10" value="' + state.shiftPct + '"></div>' +
      '<div class="shift-row"><span>Where can that load run?</span><select id="mode" class="ctl"><option value="any"' + (state.mode === "any" ? " selected" : "") + '>Any hour (car home midday, or workplace charging)</option><option value="night"' + (state.mode === "night" ? " selected" : "") + '>Overnight only, 9 PM–7 AM (car away by day)</option></select></div>' +
      (function () {
        const dg = ((ev.g - ev2.g) * scale), dc = ((ev.cost - ev2.cost) * scale), pctG = Math.round((100 * (ev.g - ev2.g)) / ev.g);
        const other = state.mode === "any" ? "night" : "any", eo = evaluate(shifted(rows, xplan, state.above, state.shiftPct, state.carbonPrice, other).rows, xplan, state.above);
        const og = (ev.g - eo.g) * scale, oc = (ev.cost - eo.cost) * scale;
        const co2txt = (v, base) => (v >= 0 ? "<b>" + fmtKg(v) + " CO₂/month</b> avoided (" + Math.round((100 * v) / (base * scale)) + "%)" : "<b>" + fmtKg(-v) + " CO₂/month more</b> (+" + Math.round((-100 * v) / (base * scale)) + "%)");
        return '<div class="result' + (dg < 0 ? " worse" : "") + '">Same life, better timing: <b>' + fmt$(dc) + "/month</b> saved and " + co2txt(dg, ev.g) + ", by moving " + Math.round(sh.moved * scale) + " kWh/month.</div>" +
          '<p style="margin:8px 0 0;font-size:14px"><b>' + (other === "night" ? "Overnight only" : "Any hour") + ":</b> " + fmt$(oc) + "/month saved and " + co2txt(og, ev.g) + ". " + (Math.sign(og) !== Math.sign(dg) ? "<b>Same bill, opposite climate outcome:</b> where the charge lands decides the carbon." : "") + "</p>";
      })() +
      '<div class="chart-title">Which plan fits this home? (energy charges / month)</div>' +
      "<table><thead><tr><th>Plan</th><th>As used today</th><th>With GridLight shifting</th><th>CO₂ with shifting</th></tr></thead><tbody>" +
      plans.map((r) => '<tr class="' + (r.p === bestPlan.p ? "win" : "") + '"><td>' + r.p + (r.p === "E-ELEC" ? "*" : "") + "</td><td>" + fmt$(r.a) + "</td><td>" + fmt$(r.b) + "</td><td>" + fmtKg(r.gb) + "</td></tr>").join("") +
      "</tbody></table>" +
      (function () { const cur = plans.find((r) => r.p === xplan); if (!cur || bestPlan.p === xplan) return ""; const noShift = plans.find((r) => r.p === bestPlan.p).a; return '<p style="margin:8px 0 0;font-size:14px"><b>Plan tip:</b> ' + bestPlan.p + " is cheapest <i>if</i> this home shifts (" + fmt$(bestPlan.b) + " vs " + fmt$(cur.a) + " today)." + (noShift - cur.a > 1 ? " Switching without changing habits would cost " + fmt$(noShift - cur.a) + "/month <i>more</i>: plan advice and timing advice belong together." : Math.abs(noShift - cur.a) <= 1 ? " Switching without changing habits saves nothing: plan advice and timing advice belong together." : "") + "</p>"; })() +
      '<div class="chart-title" style="margin-top:22px">For SVCE: what a GridLight program would deliver</div>' +
      '<div class="impact-in"><label for="homes">Enrolled EV homes like this one</label><input id="homes" type="number" min="100" step="500" value="' + state.homes + '"><label for="follow">who follow the advice</label><input id="follow" type="number" min="0" max="100" step="5" value="' + state.follow + '" style="width:64px">%<span class="muted">per-home results above × followers, annualised (×12)</span></div>' +
      '<div class="impact">' +
      '<div class="tile"><b>' + (peakKw * F / 1000).toFixed(1) + ' MW</b><span>moved out of the ' + peakLen + '-hour evening peak on average (' + peakKw.toFixed(2) + ' kW per home), ' + (state.mode === "night" ? "into 9 PM–7 AM" : "mostly into the 9 AM–4 PM solar window") + '</span></div>' +
      '<div class="tile"><b>' + Math.round(Math.abs((ev.g - ev2.g) * scale * 12 * F) / 1e6).toLocaleString("en-US") + ' t CO₂/yr</b><span>' + (((ev.g - ev2.g)) >= 0 ? "avoided" : "added") + ' (indicative, average-emissions basis)</span></div>' +
      '<div class="tile"><b>' + money((ev.cost - ev2.cost) * scale * 12 * F) + '/yr</b><span>lower customer bills</span></div></div>' +
      '<p class="muted">E-TOU-C includes a baseline credit on the first <input id="base-kwh" type="number" min="0" step="0.5" value="' + state.baselineKwh + '" style="width:56px"> kWh/day (check your bill; it varies by territory and season). *E-ELEC also carries a fixed monthly Base Services Charge, not included here, so it is left out of the best-fit pick. Excludes other fixed charges, taxes and the California Climate Credit. Your data never leaves this browser.</p>';
    $("#shift").addEventListener("input", (e) => { $("#shift-v").textContent = e.target.value + "%"; });
    $("#shift").addEventListener("change", (e) => { state.shiftPct = +e.target.value; renderXray(); });
    $("#mode").addEventListener("change", (e) => { state.mode = e.target.value; renderXray(); });
    $("#base-kwh").addEventListener("change", (e) => { state.baselineKwh = Math.max(0, +e.target.value || 0); renderXray(); });
    $("#homes").addEventListener("change", (e) => { state.homes = Math.max(100, +e.target.value || 10000); renderXray(); });
    $("#follow").addEventListener("change", (e) => { state.follow = Math.min(100, Math.max(0, +e.target.value || 0)); renderXray(); });
  }

  // ---------- Nudges (SMS preview + calendar) ----------
  function renderNudges(hours) {
    const runs = greenRuns(hours); const r = RATES[state.plan];
    const peak = hours.filter((x) => x.period === "peak"); const off = hours.find((x) => x.period === "off");
    const msgs = [];
    if (runs.length) {
      const g = runs[0]; const avg = Math.round(hours.slice(g[0], g[1]).reduce((a, b) => a + b.carbon, 0) / (g[1] - g[0]));
      msgs.push({ t: hh(g[0]), s: "🟢 GridLight: green window " + hh(g[0]) + "–" + hh(g[1]) + ". Power is " + fmtC(hours[g[0]].price) + "/kWh and the grid is at its cleanest (~" + avg + " g CO₂/kWh). Good time for laundry, dishes, EV." });
    }
    if (peak.length) {
      const p0 = peak[0].h; const firstUp = hours.find((x) => x.period !== "off") || peak[0];
      msgs.push({ t: hh(firstUp.h - 1).replace(" ", ":30 "), s: "🔴 Prices rise in 30 min (" + hh(firstUp.h) + "), peak " + hh(p0) + "–" + hh(peak[peak.length - 1].h + 1) + " at " + fmtC(peak[0].price) + " vs " + fmtC(off.price) + " off-peak. Pre-cool or pre-heat now; hold the dryer and the EV." });
      const after = hours[(peak[peak.length - 1].h + 1) % 24];
      if (after.st === "a" || after.st === "p") {
        const cheap = hours.find((x) => x.h > after.h && x.period === "off");
        msgs.push({ t: hh(after.h), s: "🟠 Peak is over. Tonight's grid is dirty (~" + after.carbon + " g CO₂/kWh)" + (after.st === "p" && cheap ? " and prices stay at part-peak until " + hh(cheap.h) : "") + ". Car parked at home tomorrow? Set the charger for " + (runs[0] ? hh(runs[0][0]) : "midday") + ". If not, after " + (cheap ? hh(cheap.h) : "midnight") + " is cheapest tonight." });
      }
    }
    $("#phone").innerHTML = '<div class="bar">Messages · GridLight</div>' + msgs.map((m) => '<div class="sms"><span class="t">' + m.t + "</span>" + m.s + "</div>").join("");
  }
  function downloadICS() {
    const hours = day(); const runs = greenRuns(hours);
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
    let s = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GridLight//Green windows//EN\r\nCALSCALE:GREGORIAN\r\n";
    runs.forEach((r, i) => {
      s += "BEGIN:VEVENT\r\nUID:gridlight-" + p + "-" + i + "@gridlight\r\nDTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z\r\n" +
        "DTSTART;TZID=America/Los_Angeles:" + p + "T" + String(r[0]).padStart(2, "0") + "0000\r\nDTEND;TZID=America/Los_Angeles:" + p + "T" + String(r[1] % 24 || 23).padStart(2, "0") + (r[1] === 24 ? "5900" : "0000") + "\r\n" +
        "SUMMARY:GridLight green window: cheap & clean power\r\nDESCRIPTION:Run the dishwasher\\, laundry or EV charging now (" + state.plan + ").\r\nEND:VEVENT\r\n";
    });
    s += "END:VCALENDAR\r\n";
    dl("gridlight-green-windows.ics", s, "text/calendar");
  }
  function dl(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- live CAISO (best effort; falls back to typical profile) ----------
  async function tryLive() {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
      const [a, b] = await Promise.all(["co2", "demand"].map((f) => fetch("https://www.caiso.com/outlook/current/" + f + ".csv", { signal: ctl.signal }).then((r) => (r.ok ? r.text() : Promise.reject()))));
      const last = (t) => t.trim().split("\n").slice(1).map((l) => l.split(",")).filter((c) => c.length > 2 && c.slice(1).some((v) => v !== ""));
      const co2 = last(a), dem = last(b);
      const tC = co2[co2.length - 1], tD = dem.filter((r) => r[3] !== "" && r[3] !== undefined).pop();
      const g = (Math.max(0, tC.slice(1).reduce((s, v) => s + (+v || 0), 0)) / +tD[3]) * 1000;
      state.live = { g, at: tC[0], hour: +tC[0].split(":")[0] };
      $("#live").textContent = "Live CAISO grid: " + Math.round(g) + " g CO₂/kWh at " + tC[0] + " PT.";
      renderAll();
    } catch (e) {
      $("#live").textContent = "Grid CO₂: typical " + (state.season === "winter" ? "October weekday" : "summer weekday") + " profile computed from CAISO data.";
    }
  }

  // live day-ahead prices from the SVCE dynamic pricing pilot API (best effort; embedded days otherwise)
  async function tryLivePrices() {
    const R = RATES.HFP; if (!R) return;
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (R.hourly[d]) { R.day = d; return; }
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
      const url = "https://pge-pe-api.gridx.com/stage/v1/getPricing?utility=PGE&market=DAM&program=CalFUSE&ratename=EELEC&representativeCircuitId=013921103&cca=SVCE&startdate=" + d.replace(/-/g, "") + "&enddate=" + d.replace(/-/g, "");
      const j = await fetch(url, { signal: ctl.signal }).then((r) => r.json());
      const det = j.data[0].priceDetails; const v = new Array(24).fill(null);
      det.forEach((x) => { const h = +String(x.startIntervalTimeStamp).slice(11, 13); v[h] = +x.intervalPrice; });
      if (v.every((x) => x != null)) { R.hourly[d] = v; R.day = d; R.live = true; if (state.plan === "HFP") renderAll(); }
    } catch (e) { /* keep embedded prices */ }
  }

  // ---------- wiring ----------
  function renderAll() {
    const hours = day();
    const R = RATES[state.plan];
    $("#plan-note").textContent = R.dynamic ? R.note + " · prices for " + new Date(R.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) + (R.live ? " (live from the pilot API)" : "") + " · red = the day's priciest quarter" : R.note + " · " + (state.season === "winter" ? "winter (Oct–May)" : "summer (Jun–Sep)") + " prices";
    $("#baseline-ctl").style.display = RATES[state.plan].baseline ? "" : "none";
    $("#price-title").textContent = R.dynamic ? "Your price (¢/kWh, SVCE dynamic pilot, hourly, day-ahead)" : "Your price (¢/kWh, all-in, ≈ PG&E bundled rates from Mar 1, 2026)";
    renderHero(hours); renderDay(hours); renderPlanner(); renderXray(); renderNudges(hours);
  }
  function init() {
    $("#plan").innerHTML = Object.entries(RATES).map(([k, v]) => '<option value="' + k + '">' + v.label + "</option>").join("");
    $("#plan").value = state.plan;
    $("#season").value = state.season;
    $("#time").value = String(state.hour).padStart(2, "0") + ":" + String(state.minute).padStart(2, "0");
    $("#plan").addEventListener("change", (e) => { state.plan = e.target.value; renderAll(); });
    $("#season").addEventListener("change", (e) => { state.season = e.target.value; renderAll(); });
    $("#above").addEventListener("change", (e) => { state.above = e.target.checked; renderAll(); });
    $("#time").addEventListener("input", (e) => { const [a, b] = e.target.value.split(":"); if (a === undefined) return; state.hour = +a; state.minute = +b || 0; renderAll(); });
    $("#weight").addEventListener("input", (e) => { state.carbonPrice = +e.target.value; $("#weight-v").textContent = "$" + e.target.value + "/t CO₂"; renderPlanner(); });
    $("#weight").addEventListener("change", () => renderXray());
    $("#horizon").addEventListener("change", (e) => { state.horizon = +e.target.value; renderPlanner(); });
    ["#edit-kwh", "#edit-h"].forEach((s) => $(s).addEventListener("change", () => {
      const a = APPS.find((x) => x.id === state.app); a.kwh = Math.max(0.1, +$("#edit-kwh").value || a.kwh); a.hours = Math.min(12, Math.max(1, Math.round(+$("#edit-h").value || a.hours))); renderApps(); renderPlanner();
    }));
    $("#use-sample").addEventListener("click", () => { state.household = { name: "Sample household (simulated): San Jose home with an EV", rows: sampleHousehold() }; renderXray(); $("#xray-out").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    $("#dl-sample").addEventListener("click", () => dl("sample-green-button.csv", toGreenButtonCSV(sampleHousehold()), "text/csv"));
    const file = $("#file"), drop = $("#drop");
    const load = async (f) => {
      try { const rows = parseUsageCSV(await f.text()); state.household = { name: f.name + " (your data, processed locally)", rows }; $("#xray-err").textContent = ""; renderXray(); }
      catch (err) { $("#xray-err").textContent = err.message; }
    };
    file.addEventListener("change", () => file.files[0] && load(file.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && load(e.dataTransfer.files[0]));
    $("#ics").addEventListener("click", downloadICS);
    renderApps(); renderAll(); bindHover(); tryLive(); tryLivePrices();
    window.GridLight = { state, day, bestWindows, evaluate, shifted, parseUsageCSV, sampleHousehold, renderAll };
  }
  document.addEventListener("DOMContentLoaded", init);
})();
