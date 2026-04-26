/* =========================================================================
   Monterey Hardness — companion site
   Real-time filtering, charting, R², CSV download.
   No external dependencies. Works on file:// and any static host.
   ========================================================================= */
(function () {
"use strict";

/* ---------- constants ---------- */
const PHASE_ORDER = ["opal-A", "mixed", "opal-CT", "6k-quartz", "12k-quartz"];
const PHASE_LABEL = {
  "opal-A": "opal-A", "mixed": "mixed A-CT", "opal-CT": "opal-CT",
  "6k-quartz": "6k′-quartz", "12k-quartz": "12k′-quartz",
};
const PHASE_COLOR = {
  "opal-A":    "#3B8A3F",  "mixed":     "#E7C83A",
  "opal-CT":   "#E07A26",  "6k-quartz": "#2F62B6",  "12k-quartz":"#5F1210",
};
const PHASE_STROKE = {
  "opal-A":    "#205022",  "mixed":     "#9B821E",
  "opal-CT":   "#8A4410",  "6k-quartz": "#143368",  "12k-quartz":"#2A0705",
};
const Q_LABEL = {0: "very good", 1: "good", 2: "poor"};

const FIELD = {
  silica:   { key: "sl",  label: "Biogenic + diagenetic silica (%)", min: 0, max: 100 },
  detritus: { key: "dt",  label: "Detritus (%)",                     min: 0, max: 100 },
  ratio:    { key: null,  label: "Silica : detritus ratio",          min: 0, max: 50,
              calc: d => (d.dt && d.dt > 0) ? (d.sl / d.dt) : null },
  por:      { key: "o",   label: "Porosity (%) · he",                min: 0, max: 70 },
  hld:      { key: "hld", label: "Rebound hardness (HLD)",           min: 200, max: 900 },
  depth:    { key: "d",   label: "Depth (ft)",                       min: 800, max: 12600 },
  graind:   { key: "gd",  label: "Grain density (g/cc)",             min: 2.2, max: 2.7 },
  toc:      { key: "t",   label: "TOC (%)",                          min: 0, max: 12 },
  perm:     { key: "k",   label: "Permeability, Kair (md)",          min: 0, max: 3 },
  ucsmpa:   { key: "u",   label: "UCS (MPa, Lee)",                   min: 0, max: 200 },
};

function valOf(d, axisId) {
  const f = FIELD[axisId];
  if (!f) return null;
  if (f.calc) return f.calc(d);
  return d[f.key];
}
function nf(v, dec=1) {
  if (v == null || isNaN(v)) return "—";
  return (Math.abs(v) >= 1000) ? Number(v).toLocaleString(undefined,{maximumFractionDigits:dec})
                               : (+v).toFixed(dec);
}

/* ---------- load embedded dataset ---------- */
const DATASET = (() => {
  const tag = document.getElementById("dataset");
  try {
    const raw = tag.textContent.trim();
    if (!raw || raw === "__DATASET_PLACEHOLDER__") return null;
    return JSON.parse(raw);
  } catch (e) { console.error("dataset parse failed", e); return null; }
})();

if (!DATASET) {
  // fallback: try to fetch the JSON file (works when served over http)
  fetch("assets/data.json").then(r => r.json()).then(initWithData)
    .catch(err => {
      document.body.innerHTML = "<p style='padding:40px;font-family:monospace'>Could not load dataset.<br>" + err + "</p>";
    });
} else {
  initWithData(DATASET);
}

/* =========================================================================
   APP INIT
   ========================================================================= */
function initWithData(D) {
  const ROWS = D.rows;
  const WELLS = D.wells;
  document.getElementById("rowTotal").textContent = ROWS.length.toLocaleString();
  document.getElementById("totalCount").textContent = ROWS.length.toLocaleString();

  /* ---------- well chips (built dynamically from data) ---------- */
  const wellChipsEl = document.getElementById("wellChips");
  WELLS.forEach(w => {
    const c = document.createElement("span");
    c.className = "chip active";
    c.dataset.well = w;
    c.textContent = w;
    wellChipsEl.appendChild(c);
  });

  /* ---------- filter state ---------- */
  const STATE = {
    phases:  new Set(PHASE_ORDER),
    wells:   new Set(WELLS),
    detgrp:  new Set(["low", "mod", "high"]),
    quality: new Set([0, 1]),                    // default excludes Poor
    xrdOnly: false,
    range: {
      depth:  [800, 12600],
      por:    [0, 70],
      silica: [0, 100],
      toc:    [0, 12],
      perm:   [0, 3],   // displayed; slider uses 0..30 with scale 0.1
    },
    axes:    { x: "silica", y: "hld", c: "phase" },
    logX: false, logY: false, swap: false,
    trends: true, means: false, shapes: false,
    activePreset: "fig4",
  };

  /* ---------- dual-thumb sliders (with two-way vbox sync) ---------- */
  document.querySelectorAll(".rangeD").forEach(r => {
    const lo = r.querySelector("input.lo");
    const hi = r.querySelector("input.hi");
    const fill = r.querySelector(".fill");
    const valBox = r.parentElement.querySelector(".rangeD-values");
    const vLo = valBox.querySelector('[data-bound="lo"]');
    const vHi = valBox.querySelector('[data-bound="hi"]');
    const scale = +r.dataset.scale || 1;
    const id = r.dataset.range;

    const fmtDisplay = v => {
      const real = v * scale;
      if (id === "depth") return Number(real).toLocaleString();
      if (id === "perm")  return real.toFixed(1);
      return String(Math.round(real));
    };

    function render() {
      const min = +lo.min, max = +lo.max;
      let L = +lo.value, H = +hi.value;
      if (L > H) { [L, H] = [H, L]; lo.value = L; hi.value = H; }
      const pctL = (L - min) / (max - min) * 100;
      const pctH = (H - min) / (max - min) * 100;
      fill.style.left  = pctL + "%";
      fill.style.width = (pctH - pctL) + "%";
      vLo.value = fmtDisplay(L);
      vHi.value = fmtDisplay(H);
      // update STATE in real (display) units
      STATE.range[id] = [L * scale, H * scale];
    }

    function onChange() { render(); rerender(); }
    lo.addEventListener("input", onChange);
    hi.addEventListener("input", onChange);

    function applyVbox(input, which) {
      const n = parseFloat(String(input.value).replace(/,/g, ""));
      if (isNaN(n)) return;
      const slider = which === "lo" ? lo : hi;
      slider.value = Math.round(n / scale);
      onChange();
    }
    vLo.addEventListener("change", () => applyVbox(vLo, "lo"));
    vHi.addEventListener("change", () => applyVbox(vHi, "hi"));
    vLo.addEventListener("keydown", e => { if (e.key === "Enter") applyVbox(vLo, "lo"); });
    vHi.addEventListener("keydown", e => { if (e.key === "Enter") applyVbox(vHi, "hi"); });

    render();
  });

  /* ---------- chip toggling ---------- */
  document.querySelectorAll(".chip[data-phase]").forEach(c => {
    c.addEventListener("click", () => {
      c.classList.toggle("active");
      if (c.classList.contains("active")) STATE.phases.add(c.dataset.phase);
      else STATE.phases.delete(c.dataset.phase);
      rerender();
    });
  });
  document.querySelectorAll(".chip[data-well]").forEach(c => {
    c.addEventListener("click", () => {
      c.classList.toggle("active");
      if (c.classList.contains("active")) STATE.wells.add(c.dataset.well);
      else STATE.wells.delete(c.dataset.well);
      rerender();
    });
  });
  document.querySelectorAll(".chip[data-detgrp]").forEach(c => {
    c.addEventListener("click", () => {
      c.classList.toggle("active");
      if (c.classList.contains("active")) STATE.detgrp.add(c.dataset.detgrp);
      else STATE.detgrp.delete(c.dataset.detgrp);
      rerender();
    });
  });
  document.querySelectorAll(".chip[data-q]").forEach(c => {
    c.addEventListener("click", () => {
      c.classList.toggle("active");
      const q = +c.dataset.q;
      // q=2 chip means "poor" which is q=2 OR 3
      if (q === 2) {
        if (c.classList.contains("active")) { STATE.quality.add(2); STATE.quality.add(3); }
        else { STATE.quality.delete(2); STATE.quality.delete(3); }
      } else {
        if (c.classList.contains("active")) STATE.quality.add(q);
        else STATE.quality.delete(q);
      }
      rerender();
    });
  });
  // (XRD-confirmed filter removed; STATE.xrdOnly stays false)

  /* ---------- "all · none" links ---------- */
  document.querySelectorAll(".link-mini[data-action='all-none']").forEach(l => {
    l.addEventListener("click", () => {
      const group = l.closest(".filter-group");
      if (!group) return;
      const chips = group.querySelectorAll(".chip");
      const anyActive = Array.from(chips).some(c => c.classList.contains("active"));
      chips.forEach(c => {
        c.classList.toggle("active", !anyActive);
        // sync state for this group
        if (c.dataset.phase) {
          if (c.classList.contains("active")) STATE.phases.add(c.dataset.phase);
          else STATE.phases.delete(c.dataset.phase);
        }
        if (c.dataset.well) {
          if (c.classList.contains("active")) STATE.wells.add(c.dataset.well);
          else STATE.wells.delete(c.dataset.well);
        }
      });
      rerender();
    });
  });

  /* ---------- "has value" porosity link ---------- */
  document.querySelector('[data-action="por-has-value"]')?.addEventListener("click", () => {
    // shrink range to actual data extent (filters out NaN by virtue of fitering pipeline)
    const r = document.querySelector('.rangeD[data-range="por"]');
    if (!r) return;
    r.querySelector("input.lo").value = 1;
    r.querySelector("input.hi").value = 70;
    r.querySelector("input.lo").dispatchEvent(new Event("input"));
  });

  /* ---------- advanced collapsible ---------- */
  document.querySelectorAll(".adv").forEach(a => {
    const head = a.querySelector(".adv-head");
    head.addEventListener("click", () => a.classList.toggle("open"));
  });

  /* ---------- axis selectors ---------- */
  document.getElementById("axX").addEventListener("change", e => { STATE.axes.x = e.target.value; STATE.activePreset = null; rerender(); });
  document.getElementById("axY").addEventListener("change", e => { STATE.axes.y = e.target.value; STATE.activePreset = null; rerender(); });
  document.getElementById("axC").addEventListener("change", e => { STATE.axes.c = e.target.value; STATE.activePreset = null; rerender(); });

  /* ---------- chart tools ---------- */
  document.getElementById("tTrend").addEventListener("click", e => {
    STATE.trends = !STATE.trends;
    e.currentTarget.classList.toggle("active", STATE.trends);
    document.getElementById("r2Badge").classList.toggle("hidden", !STATE.trends);
    rerender();
  });
  document.getElementById("tMeans").addEventListener("click", e => {
    STATE.means = !STATE.means;
    e.currentTarget.classList.toggle("active", STATE.means);
    rerender();
  });
  document.getElementById("tShapes").addEventListener("click", e => {
    STATE.shapes = !STATE.shapes;
    e.currentTarget.classList.toggle("active", STATE.shapes);
    document.querySelectorAll(".legend, .r2-strip").forEach(el =>
      el.classList.toggle("shapes", STATE.shapes));
    rerender();
  });
  document.getElementById("tLogX").addEventListener("click", e => {
    STATE.logX = !STATE.logX; e.currentTarget.classList.toggle("active", STATE.logX); rerender();
  });
  document.getElementById("tLogY").addEventListener("click", e => {
    STATE.logY = !STATE.logY; e.currentTarget.classList.toggle("active", STATE.logY); rerender();
  });
  document.getElementById("tSwap").addEventListener("click", () => {
    const x = STATE.axes.x, y = STATE.axes.y;
    STATE.axes.x = y; STATE.axes.y = x;
    document.getElementById("axX").value = STATE.axes.x;
    document.getElementById("axY").value = STATE.axes.y;
    const lx = STATE.logX, ly = STATE.logY;
    STATE.logX = ly; STATE.logY = lx;
    document.getElementById("tLogX").classList.toggle("active", STATE.logX);
    document.getElementById("tLogY").classList.toggle("active", STATE.logY);
    rerender();
  });

  /* ---------- presets ---------- */
  const PRESETS = {
    "fig4":        () => { Object.assign(STATE.axes, {x:"silica", y:"hld",   c:"phase"}); STATE.trends=true; STATE.means=false; STATE.logX=false; STATE.logY=false; resetFilters(); },
    "fig7":        () => { Object.assign(STATE.axes, {x:"hld",    y:"por",   c:"phase"}); STATE.trends=true; STATE.means=false; STATE.logX=false; STATE.logY=false; resetFilters(); },
    "phase-jumps": () => { Object.assign(STATE.axes, {x:"depth",  y:"hld",   c:"phase"}); STATE.trends=false; STATE.means=true; STATE.logX=false; STATE.logY=false; resetFilters(); },
    "opalct":      () => { Object.assign(STATE.axes, {x:"silica", y:"hld",   c:"phase"}); STATE.trends=true; STATE.means=false; STATE.logX=false; STATE.logY=false; resetFilters(); selectPhase("opal-CT"); },
    "quartz-all":  () => { Object.assign(STATE.axes, {x:"silica", y:"hld",   c:"phase"}); STATE.trends=true; STATE.means=false; STATE.logX=false; STATE.logY=false; resetFilters(); selectPhases(["6k-quartz","12k-quartz"]); },
  };
  function resetFilters() {
    STATE.phases = new Set(PHASE_ORDER);
    STATE.wells = new Set(WELLS);
    STATE.detgrp = new Set(["low","mod","high"]);
    STATE.quality = new Set([0,1]);
    STATE.xrdOnly = false;
    STATE.range = { depth:[800,12600], por:[0,70], silica:[0,100], toc:[0,12], perm:[0,3] };
    syncControls();
  }
  function selectPhase(p) {
    STATE.phases = new Set([p]);
    syncControls();
  }
  function selectPhases(arr) {
    STATE.phases = new Set(arr);
    syncControls();
  }
  function syncControls() {
    document.querySelectorAll(".chip[data-phase]").forEach(c =>
      c.classList.toggle("active", STATE.phases.has(c.dataset.phase)));
    document.querySelectorAll(".chip[data-well]").forEach(c =>
      c.classList.toggle("active", STATE.wells.has(c.dataset.well)));
    document.querySelectorAll(".chip[data-detgrp]").forEach(c =>
      c.classList.toggle("active", STATE.detgrp.has(c.dataset.detgrp)));
    document.querySelectorAll(".chip[data-q]").forEach(c => {
      const q = +c.dataset.q;
      const on = (q === 2) ? (STATE.quality.has(2) || STATE.quality.has(3)) : STATE.quality.has(q);
      c.classList.toggle("active", on);
    });
    document.getElementById("axX").value = STATE.axes.x;
    document.getElementById("axY").value = STATE.axes.y;
    document.getElementById("axC").value = STATE.axes.c;
    document.getElementById("tTrend").classList.toggle("active", STATE.trends);
    document.getElementById("tMeans").classList.toggle("active", STATE.means);
    document.getElementById("tLogX").classList.toggle("active", STATE.logX);
    document.getElementById("tLogY").classList.toggle("active", STATE.logY);
    document.getElementById("r2Badge").classList.toggle("hidden", !STATE.trends);
    // sync slider values
    document.querySelectorAll(".rangeD").forEach(r => {
      const id = r.dataset.range;
      const scale = +r.dataset.scale || 1;
      const [lo, hi] = STATE.range[id] || [+r.dataset.min, +r.dataset.max];
      r.querySelector("input.lo").value = Math.round(lo / scale);
      r.querySelector("input.hi").value = Math.round(hi / scale);
      r.querySelector("input.lo").dispatchEvent(new Event("input"));
    });
  }

  document.querySelectorAll(".preset").forEach(p => {
    p.addEventListener("click", () => {
      document.querySelectorAll(".preset").forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      STATE.activePreset = p.dataset.preset;
      const fn = PRESETS[p.dataset.preset];
      if (fn) { fn(); rerender(); }
    });
  });
  document.querySelectorAll(".step[data-preset]").forEach(s => {
    s.addEventListener("click", () => {
      const id = s.dataset.preset;
      const btn = document.querySelector(`.preset[data-preset="${id}"]`);
      if (btn) btn.click();
      document.getElementById("explorer").scrollIntoView({behavior:"smooth", block:"start"});
    });
  });

  /* ---------- reset all ---------- */
  document.getElementById("resetAll").addEventListener("click", () => {
    resetFilters();
    rerender();
  });

  /* ---------- footnotes: sticky hover (mouse can travel to tip to click link) ---------- */
  document.querySelectorAll("sup.fn").forEach(fn => {
    const tip = fn.querySelector(".fn-tip");
    let hideTimer;
    const show = () => { clearTimeout(hideTimer); fn.classList.add("open"); };
    const hide = () => { hideTimer = setTimeout(() => fn.classList.remove("open"), 220); };
    fn.addEventListener("mouseenter", show);
    fn.addEventListener("mouseleave", hide);
    if (tip) {
      tip.addEventListener("mouseenter", show);
      tip.addEventListener("mouseleave", hide);
    }
    fn.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn.classList.toggle("open"); }
      if (e.key === "Escape") fn.classList.remove("open");
    });
  });

  /* ---------- mobile filter drawer ---------- */
  const filtersEl = document.querySelector(".filters");
  const drawerToggle = document.getElementById("filtersToggle");
  const drawerBackdrop = document.getElementById("filtersBackdrop");
  function openDrawer()  { filtersEl.classList.add("open"); drawerBackdrop.classList.add("open"); }
  function closeDrawer() { filtersEl.classList.remove("open"); drawerBackdrop.classList.remove("open"); }
  drawerToggle?.addEventListener("click", () => {
    filtersEl.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  drawerBackdrop?.addEventListener("click", closeDrawer);
  // close on chip/preset click while in drawer
  filtersEl.addEventListener("click", e => {
    if (window.innerWidth > 1000) return;
    if (e.target.closest(".chip, .preset, .reset-btn, .link-mini")) {
      // small delay so the rerender finishes visibly first
      setTimeout(closeDrawer, 250);
    }
  });

  /* ---------- CSV download ---------- */
  document.getElementById("downloadBtn").addEventListener("click", () => {
    const filtered = filterRows();
    const headers = ["Well","Depth_ft","Silica_pct","Detritus_pct","Phase","DetritusGroup",
                     "HLD","HLD_StdDev","XRD","Perm_Kair_md","POR_he_pct","GrainDensity_gcc",
                     "TOC_pct","Quality","UCS_MPa_Lee"];
    const lines = [headers.join(",")];
    filtered.forEach(d => {
      const row = [
        d.w, d.d,
        d.sl ?? "", d.dt ?? "",
        d.p ?? "", d.g ?? "",
        d.hld ?? "", d.sd ?? "",
        d.x ? "Y" : "N",
        d.k ?? "", d.o ?? "", d.gd ?? "",
        d.t ?? "",
        d.q == null ? "" : (d.q === 0 ? "very good" : d.q === 1 ? "good" : "poor"),
        d.u ?? "",
      ];
      lines.push(row.map(v => {
        const s = String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s;
      }).join(","));
    });
    const blob = new Blob([lines.join("\n")], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `monterey-hardness-filtered-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  });

  /* ---------- share view (URL hash) ---------- */
  document.getElementById("shareBtn").addEventListener("click", () => {
    const hash = encodeStateToHash();
    const url = location.origin + location.pathname + "#" + hash;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        toast("Link copied — paste anywhere to reload this exact view.");
      }, () => { location.hash = hash; toast("Link in URL — copy to share."); });
    } else {
      location.hash = hash; toast("Link in URL — copy to share.");
    }
  });

  /* Compact share-view URL hash format (v1):
     <ver>.<phase-mask hex>.<well-mask hex>.<detgrp-mask hex>.<quality-mask hex>.<flag bits hex>.<axisX>-<axisY>-<axisC>[.r<depthLo>-<depthHi>-<porLo>-<porHi>-<silicaLo>-<silicaHi>]
     Defaults are omitted. Total length typically ~25–55 chars. */
  const AXIS_CODES = { silica:"sl", detritus:"dt", ratio:"rt", por:"po", hld:"hl",
                       depth:"dp", graind:"gd", toc:"tc", perm:"pm", ucsmpa:"uc",
                       phase:"ph", well:"wl", quality:"ql" };
  const AXIS_FROM = Object.fromEntries(Object.entries(AXIS_CODES).map(([k,v])=>[v,k]));
  const GROUPS = ["low","mod","high"];

  function bitmask(setLike, list) {
    return list.reduce((m, v, i) => m | (setLike.has(v) ? (1<<i) : 0), 0);
  }
  function fromMask(n, list) {
    return new Set(list.filter((_, i) => (n & (1<<i))));
  }
  function encodeStateToHash() {
    const p = bitmask(STATE.phases, PHASE_ORDER).toString(16);
    const w = bitmask(STATE.wells, WELLS).toString(16);
    const g = bitmask(STATE.detgrp, GROUPS).toString(16);
    const q = bitmask(STATE.quality, [0,1,2,3]).toString(16);
    const flags =
      ((STATE.trends?1:0) | (STATE.means?2:0) | (STATE.logX?4:0) |
       (STATE.logY?8:0)   | (STATE.shapes?16:0)).toString(16);
    const a = `${AXIS_CODES[STATE.axes.x]}-${AXIS_CODES[STATE.axes.y]}-${AXIS_CODES[STATE.axes.c]}`;
    const r = STATE.range;
    const dflt = r.depth[0]===800 && r.depth[1]===12600 &&
                 r.por[0]===0 && r.por[1]===70 &&
                 r.silica[0]===0 && r.silica[1]===100;
    const rPart = dflt ? "" :
      `.r${r.depth[0]}-${r.depth[1]}-${r.por[0]}-${r.por[1]}-${r.silica[0]}-${r.silica[1]}`;
    return `1.${p}.${w}.${g}.${q}.${flags}.${a}${rPart}`;
  }
  function decodeHash() {
    if (!location.hash || location.hash.length < 4) return;
    try {
      const h = location.hash.slice(1);
      const parts = h.split(".");
      if (parts[0] !== "1") {
        // v0 fallback: legacy base64-of-JSON
        const s = JSON.parse(atob(h));
        STATE.phases = new Set(s.p); STATE.wells = new Set(s.w);
        STATE.detgrp = new Set(s.g); STATE.quality = new Set(s.q);
        STATE.range = s.r; STATE.axes = s.a;
        STATE.trends = !!s.t; STATE.means = !!s.m;
        STATE.logX = s.L?.[0]==="1"; STATE.logY = s.L?.[1]==="1";
        syncControls(); return;
      }
      const [, p, w, g, q, flags, ax, rChunk] = parts;
      STATE.phases  = fromMask(parseInt(p,16), PHASE_ORDER);
      STATE.wells   = fromMask(parseInt(w,16), WELLS);
      STATE.detgrp  = fromMask(parseInt(g,16), GROUPS);
      STATE.quality = fromMask(parseInt(q,16), [0,1,2,3]);
      const f = parseInt(flags,16) || 0;
      STATE.trends = !!(f & 1); STATE.means = !!(f & 2);
      STATE.logX   = !!(f & 4); STATE.logY  = !!(f & 8);
      STATE.shapes = !!(f & 16);
      const [ax1, ax2, ax3] = ax.split("-");
      STATE.axes = { x: AXIS_FROM[ax1] || "silica",
                     y: AXIS_FROM[ax2] || "hld",
                     c: AXIS_FROM[ax3] || "phase" };
      if (rChunk && rChunk.startsWith("r")) {
        const v = rChunk.slice(1).split("-").map(Number);
        STATE.range.depth  = [v[0], v[1]];
        STATE.range.por    = [v[2], v[3]];
        STATE.range.silica = [v[4], v[5]];
      }
      syncControls();
    } catch (e) { console.warn("bad hash", e); }
  }

  function toast(msg) {
    let t = document.getElementById("__toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "__toast";
      t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1E1C19;color:#F7F4EE;padding:10px 18px;border-radius:8px;font-family:var(--mono);font-size:12px;z-index:1000;box-shadow:0 6px 18px rgba(0,0,0,0.25);";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.style.opacity = "0", 2200);
  }

  /* ---------- PNG / SVG export ---------- */
  document.getElementById("tSVG").addEventListener("click", () => {
    const svg = document.getElementById("explorerChart");
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], {type: "image/svg+xml;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "monterey-hardness-chart.svg";
    a.click();
  });
  document.getElementById("tPNG").addEventListener("click", () => {
    const svg = document.getElementById("explorerChart");
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = svg.viewBox.baseVal.width * 2;
      c.height = svg.viewBox.baseVal.height * 2;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#FDFBF6"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = "monterey-hardness-chart.png";
        a.click();
      });
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  });

  /* ---------- filtering ---------- */
  function filterRows() {
    const r = STATE.range;
    return ROWS.filter(d => {
      if (!STATE.phases.has(d.p)) return false;
      if (!STATE.wells.has(d.w)) return false;
      if (d.g && !STATE.detgrp.has(d.g)) return false;
      if (d.q === 2 || d.q === 3) return false;  // always exclude Poor quality
      if (d.q != null && !STATE.quality.has(d.q)) return false;
      if (STATE.xrdOnly && !d.x) return false;
      if (d.d != null && (d.d < r.depth[0] || d.d > r.depth[1])) return false;
      if (d.sl != null && (d.sl < r.silica[0] || d.sl > r.silica[1])) return false;
      // por: only filter if porosity bound is non-default; otherwise rows w/o por still pass
      if (d.o != null && (d.o < r.por[0] || d.o > r.por[1])) return false;
      // toc and perm: only filter rows that have the value (don't drop missing)
      if (d.t != null && (d.t < r.toc[0] || d.t > r.toc[1])) return false;
      if (d.k != null && (d.k < r.perm[0] || d.k > r.perm[1])) return false;
      return true;
    });
  }

  /* ---------- regression helpers ---------- */
  function linreg(pts) {
    if (pts.length < 3) return null;
    let sx=0, sy=0, sxx=0, sxy=0, syy=0, n=pts.length;
    for (const [x,y] of pts) { sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; syy+=y*y; }
    const denom = n*sxx - sx*sx;
    if (Math.abs(denom) < 1e-9) return null;
    const m = (n*sxy - sx*sy) / denom;
    const b = (sy - m*sx) / n;
    const rNum = n*sxy - sx*sy;
    const rDen = Math.sqrt((n*sxx - sx*sx) * (n*syy - sy*sy));
    const r = rDen ? rNum/rDen : 0;
    return { m, b, r2: r*r, n };
  }

  /* ---------- main scatter renderer ---------- */
  function scatter({svgEl, data, xId, yId, cId, w, h, pad, showTrend, showMeans, logX, logY}) {
    const svg = svgEl;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const NS = "http://www.w3.org/2000/svg";
    const L = pad.l, R = w - pad.r, T = pad.t, B = h - pad.b;

    const xField = FIELD[xId], yField = FIELD[yId];
    const pts = data.map(d => {
      const x = valOf(d, xId), y = valOf(d, yId);
      return (x == null || y == null || isNaN(x) || isNaN(y)) ? null : { d, x, y };
    }).filter(Boolean);

    if (pts.length === 0) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", w/2); t.setAttribute("y", h/2);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-family", "ui-sans-serif, sans-serif");
      t.setAttribute("font-size", "13"); t.setAttribute("fill", "#7A7268");
      t.textContent = "No measurements match the current filters.";
      svg.appendChild(t);
      return { r2: {} };
    }

    let xlo = Math.min(...pts.map(p=>p.x));
    let xhi = Math.max(...pts.map(p=>p.x));
    let ylo = Math.min(...pts.map(p=>p.y));
    let yhi = Math.max(...pts.map(p=>p.y));
    // pad domains a touch
    const xPad = (xhi - xlo) * 0.04 || 1;
    const yPad = (yhi - ylo) * 0.04 || 1;
    xlo -= xPad; xhi += xPad; ylo -= yPad; yhi += yPad;
    if (logX && xlo <= 0) xlo = Math.max(0.001, Math.min(...pts.map(p=>p.x).filter(v=>v>0))*0.5);
    if (logY && ylo <= 0) ylo = Math.max(0.001, Math.min(...pts.map(p=>p.y).filter(v=>v>0))*0.5);

    const sx = v => {
      if (logX) return L + (Math.log10(Math.max(v,xlo)) - Math.log10(xlo)) / (Math.log10(xhi) - Math.log10(xlo)) * (R-L);
      return L + (v - xlo) / (xhi - xlo) * (R - L);
    };
    const sy = v => {
      if (logY) return B - (Math.log10(Math.max(v,ylo)) - Math.log10(ylo)) / (Math.log10(yhi) - Math.log10(ylo)) * (B-T);
      return B - (v - ylo) / (yhi - ylo) * (B - T);
    };

    // bg
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", L); bg.setAttribute("y", T);
    bg.setAttribute("width", R-L); bg.setAttribute("height", B-T);
    bg.setAttribute("fill", "#ECE6D7"); bg.setAttribute("fill-opacity", "0.45");
    svg.appendChild(bg);

    // gridlines + ticks (linear-only nice rounding; for log we just fall back to sparse)
    function tickValues(lo, hi, log) {
      if (log) {
        const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
        const out = [];
        for (let p = a; p <= b; p++) out.push(Math.pow(10, p));
        return out;
      }
      const span = hi - lo;
      const target = 6;
      const raw = span / target;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
      const start = Math.ceil(lo / step) * step;
      const out = [];
      for (let v = start; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
      return out;
    }
    const xt = tickValues(xlo, xhi, logX), yt = tickValues(ylo, yhi, logY);
    xt.forEach(v => {
      const x = sx(v);
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", x); ln.setAttribute("x2", x);
      ln.setAttribute("y1", T); ln.setAttribute("y2", B);
      ln.setAttribute("stroke", "#D6CFC4"); ln.setAttribute("stroke-width", "1");
      ln.setAttribute("stroke-dasharray", "2,3"); svg.appendChild(ln);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", x); tx.setAttribute("y", B + 14);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("font-family", "ui-monospace, monospace");
      tx.setAttribute("font-size", "10"); tx.setAttribute("fill", "#7A7268");
      tx.textContent = nf(v, v >= 100 ? 0 : 1); svg.appendChild(tx);
    });
    yt.forEach(v => {
      const y = sy(v);
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", L); ln.setAttribute("x2", R);
      ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      ln.setAttribute("stroke", "#D6CFC4"); ln.setAttribute("stroke-width", "1");
      ln.setAttribute("stroke-dasharray", "2,3"); svg.appendChild(ln);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", L - 6); tx.setAttribute("y", y + 3);
      tx.setAttribute("text-anchor", "end");
      tx.setAttribute("font-family", "ui-monospace, monospace");
      tx.setAttribute("font-size", "10"); tx.setAttribute("fill", "#7A7268");
      tx.textContent = nf(v, v >= 100 ? 0 : 1); svg.appendChild(tx);
    });

    // axis frame
    const frame = document.createElementNS(NS, "rect");
    frame.setAttribute("x", L); frame.setAttribute("y", T);
    frame.setAttribute("width", R-L); frame.setAttribute("height", B-T);
    frame.setAttribute("fill", "none"); frame.setAttribute("stroke", "#7A7268");
    frame.setAttribute("stroke-width", "1"); svg.appendChild(frame);

    // axis labels
    function txt(x, y, str, opts={}) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x); t.setAttribute("y", y);
      t.setAttribute("font-family", "Source Serif Pro, Charter, Georgia, serif");
      t.setAttribute("font-size", "12"); t.setAttribute("fill", "#4D463E");
      t.setAttribute("text-anchor", opts.anchor || "middle");
      if (opts.rotate) t.setAttribute("transform", `rotate(${opts.rotate} ${x} ${y})`);
      if (opts.weight) t.setAttribute("font-weight", opts.weight);
      t.textContent = str; svg.appendChild(t); return t;
    }
    txt((L+R)/2, h - 6, xField.label);
    txt(14, (T+B)/2, yField.label, {rotate: -90, anchor: "middle"});

    // colorize point
    function colorOf(d) {
      if (cId === "phase") return PHASE_COLOR[d.p] || "#888";
      if (cId === "well") {
        const i = WELLS.indexOf(d.w);
        return ["#A6311A", "#3B8A3F", "#2F62B6", "#8B6B47"][i % 4];
      }
      if (cId === "depth") {
        const t = (d.d - 800) / (12600 - 800);
        return `hsl(${(1-t)*220 + t*0}, 60%, 45%)`;
      }
      if (cId === "ratio") {
        const r = (d.dt > 0) ? d.sl / d.dt : 0;
        const t = Math.min(1, r/10);
        return `hsl(${30 + t*180}, 60%, 45%)`;
      }
      if (cId === "quality") {
        if (d.q === 0) return "#3B8A3F";
        if (d.q === 1) return "#B78323";
        return "#888";
      }
      if (cId === "por") {
        if (d.o == null) return "#B0A898";
        const t = Math.max(0, Math.min(1, d.o / 60));
        // low por = warm brown, high por = cool blue
        const r = Math.round(180 - t * 120);
        const g = Math.round(100 + t * 40);
        const b = Math.round(60 + t * 160);
        return `rgb(${r},${g},${b})`;
      }
      return "#888";
    }
    function strokeOf(d) {
      if (cId === "phase") return PHASE_STROKE[d.p] || "#444";
      return "rgba(0,0,0,0.35)";
    }

    // draw points (with optional shape encoding for color-blind support)
    const useShapes = !!STATE.shapes;
    function shapePath(cx, cy, phase, r) {
      // shapes follow manuscript convention: each phase gets a distinct marker
      const s = r * 1.05;
      switch (phase) {
        case "opal-A":     // circle (handled separately)
          return null;
        case "mixed":      // square (rotated 45 = diamond... use square)
          return `M${cx-s},${cy-s} L${cx+s},${cy-s} L${cx+s},${cy+s} L${cx-s},${cy+s} Z`;
        case "opal-CT":    // diamond
          return `M${cx},${cy-s*1.2} L${cx+s*1.2},${cy} L${cx},${cy+s*1.2} L${cx-s*1.2},${cy} Z`;
        case "6k-quartz":  // triangle up
          return `M${cx},${cy-s*1.25} L${cx+s*1.15},${cy+s*0.75} L${cx-s*1.15},${cy+s*0.75} Z`;
        case "12k-quartz": // triangle down
          return `M${cx},${cy+s*1.25} L${cx+s*1.15},${cy-s*0.75} L${cx-s*1.15},${cy-s*0.75} Z`;
      }
      return null;
    }
    const ptsGroup = document.createElementNS(NS, "g");
    const dataAttr = d => JSON.stringify({w:d.w,d:d.d,p:d.p,sl:d.sl,dt:d.dt,hld:d.hld,o:d.o,q:d.q});
    pts.forEach(({d, x, y}) => {
      const cx = sx(x), cy = sy(y);
      let el;
      if (useShapes) {
        const path = shapePath(cx, cy, d.p, 3.6);
        if (path) {
          el = document.createElementNS(NS, "path");
          el.setAttribute("d", path);
        }
      }
      if (!el) {
        el = document.createElementNS(NS, "circle");
        el.setAttribute("cx", cx); el.setAttribute("cy", cy);
        el.setAttribute("r", 3.4);
      }
      el.setAttribute("fill", colorOf(d));
      el.setAttribute("fill-opacity", "0.78");
      el.setAttribute("stroke", strokeOf(d));
      el.setAttribute("stroke-width", "0.6");
      el.setAttribute("data-d", dataAttr(d));
      el.classList.add("dpt");
      ptsGroup.appendChild(el);
    });
    svg.appendChild(ptsGroup);

    // always compute R² per phase; only draw lines if showTrend
    const r2bp = {};
    const byPhase = {};
    pts.forEach(({d, x, y}) => {
      if (!byPhase[d.p]) byPhase[d.p] = [];
      byPhase[d.p].push([x, y]);
    });
    PHASE_ORDER.forEach(ph => {
      const arr = byPhase[ph];
      if (!arr || arr.length < 3) return;
      const fit = linreg(arr);
      if (!fit) return;
      r2bp[ph] = fit;
      if (showTrend) {
        const xs = arr.map(p => p[0]);
        const xa = Math.max(xlo, Math.min(...xs));
        const xb = Math.min(xhi, Math.max(...xs));
        const ya = fit.m * xa + fit.b;
        const yb = fit.m * xb + fit.b;
        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", sx(xa)); ln.setAttribute("y1", sy(ya));
        ln.setAttribute("x2", sx(xb)); ln.setAttribute("y2", sy(yb));
        ln.setAttribute("stroke", PHASE_STROKE[ph]);
        ln.setAttribute("stroke-width", "1.6");
        ln.setAttribute("stroke-opacity", "0.85");
        svg.appendChild(ln);
      }
    });

    // means / centroids
    if (showMeans) {
      const byPhase = {};
      pts.forEach(({d, x, y}) => {
        if (!byPhase[d.p]) byPhase[d.p] = {sx:0, sy:0, n:0};
        byPhase[d.p].sx += x; byPhase[d.p].sy += y; byPhase[d.p].n++;
      });
      PHASE_ORDER.forEach(ph => {
        const a = byPhase[ph]; if (!a) return;
        const mx = a.sx / a.n, my = a.sy / a.n;
        const m = document.createElementNS(NS, "path");
        const cx = sx(mx), cy = sy(my), s = 8;
        m.setAttribute("d", `M${cx},${cy-s} L${cx+s},${cy} L${cx},${cy+s} L${cx-s},${cy} Z`);
        m.setAttribute("fill", PHASE_COLOR[ph]);
        m.setAttribute("stroke", "#1E1C19");
        m.setAttribute("stroke-width", "1.5");
        svg.appendChild(m);
      });
    }

    return { r2: r2bp };
  }

  /* ---------- mobile filter badge ---------- */
  function updateMobileBadge(filteredCount) {
    const badge = document.getElementById("filtersBadge");
    if (!badge) return;
    badge.textContent = STATE.phases.size + "/" + PHASE_ORDER.length;
  }

  /* ---------- pill strip ---------- */
  function buildPillStrip() {
    const strip = document.getElementById("pillStrip");
    const out = ['<span class="lbl">Active filters:</span>'];
    out.push(`<span class="pill">Phase: ${STATE.phases.size}/5</span>`);
    out.push(`<span class="pill">Wells: ${STATE.wells.size}/${WELLS.length}</span>`);
    const r = STATE.range;
    if (r.depth[0] > 800 || r.depth[1] < 12600)
      out.push(`<span class="pill">Depth: ${nf(r.depth[0],0)}–${nf(r.depth[1],0)}′</span>`);
    if (r.silica[0] > 0 || r.silica[1] < 100)
      out.push(`<span class="pill">Silica: ${nf(r.silica[0],0)}–${nf(r.silica[1],0)}%</span>`);
    if (r.por[0] > 0 || r.por[1] < 70)
      out.push(`<span class="pill">POR: ${nf(r.por[0],0)}–${nf(r.por[1],0)}%</span>`);
    if (r.toc[0] > 0 || r.toc[1] < 12)
      out.push(`<span class="pill">TOC: ${nf(r.toc[0],1)}–${nf(r.toc[1],1)}%</span>`);
    if (r.perm[0] > 0 || r.perm[1] < 3)
      out.push(`<span class="pill">Perm: ${nf(r.perm[0],1)}–${nf(r.perm[1],1)} md</span>`);
    out.push(`<span class="pill">Quality: ${[...STATE.quality].sort().map(q => q===2||q===3?"poor":(q===0?"vg":"good")).filter((v,i,a)=>a.indexOf(v)===i).join("+")}</span>`);
    if (STATE.xrdOnly) out.push(`<span class="pill">XRD only</span>`);
    if (STATE.detgrp.size < 3) {
      out.push(`<span class="pill">Detritus: ${[...STATE.detgrp].join(", ")}</span>`);
    }
    strip.innerHTML = out.join("");
  }

  /* ---------- phase summary (count + R²) ---------- */
  function renderCompBar(filtered, r2bp) {
    const bar = document.getElementById("compBar");
    if (!bar) return;
    bar.innerHTML = "";
    const counts = {};
    PHASE_ORDER.forEach(p => counts[p] = 0);
    filtered.forEach(d => { if (counts[d.p] != null) counts[d.p]++; });
    const total = filtered.length || 1;
    const hasAny = PHASE_ORDER.some(p => counts[p] > 0);
    if (!hasAny) return;
    const wrap = document.createElement("div");
    wrap.className = "phase-summary";
    PHASE_ORDER.forEach(p => {
      const n = counts[p];
      if (!n) return;
      const fit = r2bp && r2bp[p];
      const row = document.createElement("div");
      row.className = "ps-row";
      const pct = (n / total * 100).toFixed(0);
      const r2Str = (fit && fit.n >= 3) ? `R²&nbsp;${fit.r2.toFixed(2)}` : `—`;
      row.innerHTML = `<span class="ps-dot" style="background:${PHASE_COLOR[p]}"></span>` +
        `<span class="ps-name">${PHASE_LABEL[p]}</span>` +
        `<span class="ps-n">n=${n.toLocaleString()} <span class="ps-pct">(${pct}%)</span></span>` +
        `<span class="ps-r2">${r2Str}</span>`;
      wrap.appendChild(row);
    });
    bar.appendChild(wrap);
  }

  /* ---------- preview table (sortable) ---------- */
  const tableSort = { col: null, dir: 1 };
  let lastFiltered = [];

  function renderTable(filtered) {
    lastFiltered = filtered;
    let rows = [...filtered];
    if (tableSort.col) {
      rows.sort((a, b) => {
        let av = a[tableSort.col], bv = b[tableSort.col];
        if (av == null) av = tableSort.dir > 0 ? Infinity : -Infinity;
        if (bv == null) bv = tableSort.dir > 0 ? Infinity : -Infinity;
        if (typeof av === "string") return tableSort.dir * av.localeCompare(bv);
        return tableSort.dir * (av - bv);
      });
    }
    const tbl = document.getElementById("tblBody");
    tbl.innerHTML = "";
    const top = rows.slice(0, 20);
    top.forEach(d => {
      const tr = document.createElement("tr");
      const porCell = (d.o == null) ? "—" : d.o.toFixed(1);
      const qLabel = d.q === 0 ? "Very good" : d.q === 1 ? "Good" : "—";
      const qPill = d.q != null ? `<span class="q-pill q${d.q}">${qLabel}</span>` : "—";
      tr.innerHTML = `
        <td>${d.w}</td>
        <td>${nf(d.d, 1)}</td>
        <td><span class="phase-dot" style="background:${PHASE_COLOR[d.p]}"></span>${PHASE_LABEL[d.p]}</td>
        <td>${nf(d.sl, 1)}</td>
        <td>${nf(d.dt, 1)}</td>
        <td>${nf(d.hld, 0)}</td>
        <td>${porCell}</td>
        <td>${qPill}</td>`;
      tbl.appendChild(tr);
    });
    document.getElementById("tblNote").textContent =
      `first ${top.length} of ${filtered.length.toLocaleString()} rows shown`;
    // update sort indicators
    document.querySelectorAll("th.sortable").forEach(th => {
      const ind = th.querySelector(".sort-ind");
      if (!ind) return;
      ind.textContent = th.dataset.col === tableSort.col
        ? (tableSort.dir > 0 ? " ▲" : " ▼") : "";
    });
  }

  // bind sortable header clicks once
  document.querySelectorAll("th.sortable").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      if (tableSort.col === th.dataset.col) {
        tableSort.dir *= -1;
      } else {
        tableSort.col = th.dataset.col;
        tableSort.dir = 1;
      }
      renderTable(lastFiltered);
    });
  });

  /* ---------- R² strip + single-phase callout ---------- */
  function updateR2(r2bp, phaseCounts) {
    document.querySelectorAll("#r2Badge .r2-row").forEach(row => {
      const ph = row.dataset.phase;
      const fit = r2bp[ph];
      const n = (phaseCounts && phaseCounts[ph]) || 0;
      const valEl = row.querySelector(".val");
      const cntEl = row.querySelector(".cnt");
      if (cntEl) cntEl.textContent = n > 0 ? `n=${n.toLocaleString()}` : "";
      row.style.display = n > 0 ? "" : "none";
      if (fit && fit.n >= 3) {
        valEl.textContent = "R² " + fit.r2.toFixed(2);
        row.classList.remove("muted");
      } else {
        valEl.textContent = n >= 3 ? "—" : "";
        row.classList.toggle("muted", true);
      }
    });

    // big single-phase callout (only when exactly one phase is selected)
    const callout = document.getElementById("r2Callout");
    if (!callout) return;
    if (STATE.phases.size === 1) {
      const ph = [...STATE.phases][0];
      const fit = r2bp[ph];
      if (fit && fit.n >= 3) {
        callout.innerHTML = `
          <span class="ph"><span class="dot ${phaseClass(ph)}"></span>${PHASE_LABEL[ph]}</span>
          <span class="kv"><span class="k">R²</span><span class="v">${fit.r2.toFixed(3)}</span></span>
          <span class="kv"><span class="k">n</span><span class="v">${fit.n}</span></span>
          <span class="kv"><span class="k">slope</span><span class="v">${fit.m.toFixed(2)} ${slopeUnit()}</span></span>
          <span class="kv"><span class="k">intercept</span><span class="v">${fit.b.toFixed(1)}</span></span>`;
        callout.classList.add("show");
      } else {
        callout.classList.remove("show");
      }
    } else {
      callout.classList.remove("show");
    }
  }
  function phaseClass(p) {
    return ({"opal-A":"opalA","mixed":"mixed","opal-CT":"opalCT","6k-quartz":"q6","12k-quartz":"q12"})[p] || "";
  }
  function slopeUnit() {
    const SHORT = { silica:"silica %", detritus:"detritus %", ratio:"si:det",
                    por:"POR %", hld:"HLD", depth:"ft", graind:"g/cc",
                    toc:"TOC %", perm:"md", ucsmpa:"MPa" };
    const x = SHORT[STATE.axes.x] || STATE.axes.x;
    const y = SHORT[STATE.axes.y] || STATE.axes.y;
    return `Δ${y} / Δ${x}`;
  }

  /* ---------- tooltip ---------- */
  const tooltipEl = document.getElementById("tooltip");
  function bindTooltip(svgEl) {
    svgEl.querySelectorAll(".dpt[data-d]").forEach(c => {
      c.addEventListener("mouseenter", e => {
        const d = JSON.parse(c.dataset.d);
        tooltipEl.innerHTML = [
          `<div><span class="k">well</span><span class="v">${d.w}</span></div>`,
          `<div><span class="k">depth</span><span class="v">${nf(d.d,1)} ft</span></div>`,
          `<div><span class="k">phase</span><span class="v">${PHASE_LABEL[d.p]}</span></div>`,
          d.sl != null ? `<div><span class="k">silica/det</span><span class="v">${nf(d.sl,1)}% / ${nf(d.dt,1)}%</span></div>` : "",
          d.hld != null ? `<div><span class="k">HLD</span><span class="v">${nf(d.hld,0)}</span></div>` : "",
          d.o != null ? `<div><span class="k">POR · he</span><span class="v">${nf(d.o,1)}%</span></div>` : "",
          d.q != null ? `<div><span class="k">quality</span><span class="v">${Q_LABEL[d.q===3?2:d.q]}</span></div>` : "",
        ].join("");
        tooltipEl.classList.add("show");
      });
      c.addEventListener("mousemove", e => {
        const rect = svgEl.getBoundingClientRect();
        const stage = svgEl.parentElement.getBoundingClientRect();
        tooltipEl.style.left = (e.clientX - stage.left + 14) + "px";
        tooltipEl.style.top  = (e.clientY - stage.top  - 12) + "px";
      });
      c.addEventListener("mouseleave", () => tooltipEl.classList.remove("show"));
    });
  }

  /* ---------- box-and-whisker plot (phase-jumps preset) ---------- */
  const BIN_LABELS = ["10–20","20–30","30–40","40–50","50–60","60–70","70–80","80–90","90–100"];
  const BIN_COLORS = {
    "10–20": "#E07A26", "20–30": "#A8A89A", "30–40": "#5B9B5B",
    "40–50": "#3F7AC4", "50–60": "#C8C845", "60–70": "#8B50C0",
    "70–80": "#8B5020", "80–90": "#505050", "90–100": "#7A7820",
  };
  function binOf(sl) {
    if (sl == null) return null;
    for (let lo = 10; lo < 100; lo += 10) {
      if (sl >= lo && sl < lo + 10) return `${lo}–${lo+10}`;
    }
    if (sl >= 90) return "90–100";
    return null;
  }
  function quartiles(vals) {
    if (!vals || vals.length < 4) return null;
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const q1 = s[Math.floor(n * 0.25)];
    const q2 = s[Math.floor(n * 0.50)];
    const q3 = s[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const loFence = s.find(v => v >= lo) ?? s[0];
    const hiFence = [...s].reverse().find(v => v <= hi) ?? s[n - 1];
    const outliers = s.filter(v => v < loFence || v > hiFence);
    return { q1, q2, q3, loFence, hiFence, outliers, n };
  }

  function renderBoxPlot({ svgEl, data, w, h, pad }) {
    const NS = "http://www.w3.org/2000/svg";
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    const L = pad.l, R = w - pad.r, T = pad.t, B = h - pad.b;

    // build data: { phase → { bin → [hld...] } }
    const byPhase = {};
    PHASE_ORDER.forEach(p => { byPhase[p] = {}; BIN_LABELS.forEach(b => { byPhase[p][b] = []; }); });
    data.forEach(d => {
      if (!d.hld || !byPhase[d.p]) return;
      const b = binOf(d.sl);
      if (b && byPhase[d.p][b]) byPhase[d.p][b].push(d.hld);
    });

    // compute quartiles per (phase, bin)
    const stats = {};
    PHASE_ORDER.forEach(p => {
      stats[p] = {};
      BIN_LABELS.forEach(b => {
        const q = quartiles(byPhase[p][b]);
        if (q) stats[p][b] = q;
      });
    });

    // Y domain: HLD 200–900 (match Fig 5)
    const ylo = 200, yhi = 900;
    const sy = v => B - (v - ylo) / (yhi - ylo) * (B - T);

    // background
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", L); bg.setAttribute("y", T);
    bg.setAttribute("width", R - L); bg.setAttribute("height", B - T);
    bg.setAttribute("fill", "#ECE6D7"); bg.setAttribute("fill-opacity", "0.45");
    svgEl.appendChild(bg);

    // Y gridlines + labels
    [200,300,400,500,600,700,800,900].forEach(v => {
      const y = sy(v);
      const gl = document.createElementNS(NS, "line");
      gl.setAttribute("x1", L); gl.setAttribute("x2", R);
      gl.setAttribute("y1", y); gl.setAttribute("y2", y);
      gl.setAttribute("stroke", "#D6CFC4"); gl.setAttribute("stroke-width", "1");
      gl.setAttribute("stroke-dasharray", "2,3"); svgEl.appendChild(gl);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", L - 6); tx.setAttribute("y", y + 3.5);
      tx.setAttribute("text-anchor", "end");
      tx.setAttribute("font-family", "ui-monospace, monospace");
      tx.setAttribute("font-size", "10"); tx.setAttribute("fill", "#7A7268");
      tx.textContent = v; svgEl.appendChild(tx);
    });

    // axis frame
    const frame = document.createElementNS(NS, "rect");
    frame.setAttribute("x", L); frame.setAttribute("y", T);
    frame.setAttribute("width", R - L); frame.setAttribute("height", B - T);
    frame.setAttribute("fill", "none"); frame.setAttribute("stroke", "#7A7268");
    frame.setAttribute("stroke-width", "1"); svgEl.appendChild(frame);

    // Y axis label
    const yLbl = document.createElementNS(NS, "text");
    yLbl.setAttribute("x", 14); yLbl.setAttribute("y", (T + B) / 2);
    yLbl.setAttribute("text-anchor", "middle");
    yLbl.setAttribute("transform", `rotate(-90 14 ${(T + B) / 2})`);
    yLbl.setAttribute("font-family", "Source Serif Pro, Charter, Georgia, serif");
    yLbl.setAttribute("font-size", "12"); yLbl.setAttribute("fill", "#4D463E");
    yLbl.textContent = "Rebound hardness (HLD)"; svgEl.appendChild(yLbl);

    // phase group layout
    const nPhases = PHASE_ORDER.length;
    const groupW = (R - L) / nPhases;

    PHASE_ORDER.forEach((ph, pi) => {
      const gx = L + pi * groupW;
      const activeBins = BIN_LABELS.filter(b => stats[ph][b]);
      if (activeBins.length === 0) return;

      const boxW = Math.min(12, (groupW - 16) / activeBins.length - 3);
      const totalBinW = activeBins.length * (boxW + 3) - 3;
      const binStartX = gx + groupW / 2 - totalBinW / 2;

      // phase X label
      const xLbl = document.createElementNS(NS, "text");
      xLbl.setAttribute("x", gx + groupW / 2);
      xLbl.setAttribute("y", B + 16);
      xLbl.setAttribute("text-anchor", "middle");
      xLbl.setAttribute("font-family", "Source Serif Pro, Charter, Georgia, serif");
      xLbl.setAttribute("font-size", "11"); xLbl.setAttribute("fill", "#4D463E");
      xLbl.textContent = PHASE_LABEL[ph]; svgEl.appendChild(xLbl);

      // vertical divider between groups (except last)
      if (pi < nPhases - 1) {
        const div = document.createElementNS(NS, "line");
        div.setAttribute("x1", gx + groupW); div.setAttribute("x2", gx + groupW);
        div.setAttribute("y1", T); div.setAttribute("y2", B);
        div.setAttribute("stroke", "#D6CFC4"); div.setAttribute("stroke-width", "1");
        svgEl.appendChild(div);
      }

      activeBins.forEach((bin, bi) => {
        const q = stats[ph][bin];
        const cx = binStartX + bi * (boxW + 3) + boxW / 2;
        const col = BIN_COLORS[bin];

        // whisker lines
        const mkLine = (x1, y1, x2, y2, sw) => {
          const el = document.createElementNS(NS, "line");
          el.setAttribute("x1", x1); el.setAttribute("y1", y1);
          el.setAttribute("x2", x2); el.setAttribute("y2", y2);
          el.setAttribute("stroke", col); el.setAttribute("stroke-width", sw || 1.2);
          svgEl.appendChild(el); return el;
        };
        // lower whisker
        mkLine(cx, sy(q.loFence), cx, sy(q.q1), 1);
        // lower whisker cap
        mkLine(cx - boxW * 0.3, sy(q.loFence), cx + boxW * 0.3, sy(q.loFence), 1);
        // upper whisker
        mkLine(cx, sy(q.q3), cx, sy(q.hiFence), 1);
        // upper whisker cap
        mkLine(cx - boxW * 0.3, sy(q.hiFence), cx + boxW * 0.3, sy(q.hiFence), 1);

        // IQR box
        const boxRect = document.createElementNS(NS, "rect");
        boxRect.setAttribute("x", cx - boxW / 2);
        boxRect.setAttribute("y", sy(q.q3));
        boxRect.setAttribute("width", boxW);
        boxRect.setAttribute("height", Math.max(1, sy(q.q1) - sy(q.q3)));
        boxRect.setAttribute("fill", col); boxRect.setAttribute("fill-opacity", "0.72");
        boxRect.setAttribute("stroke", col); boxRect.setAttribute("stroke-width", "1");
        svgEl.appendChild(boxRect);

        // median line
        mkLine(cx - boxW / 2, sy(q.q2), cx + boxW / 2, sy(q.q2), 1.8);

        // outliers
        q.outliers.forEach(ov => {
          const dot = document.createElementNS(NS, "circle");
          dot.setAttribute("cx", cx); dot.setAttribute("cy", sy(ov));
          dot.setAttribute("r", 1.8);
          dot.setAttribute("fill", col); dot.setAttribute("fill-opacity", "0.6");
          dot.setAttribute("stroke", "none");
          svgEl.appendChild(dot);
        });
      });
    });

    // legend: silica bins
    const legendBins = BIN_LABELS.filter(b =>
      PHASE_ORDER.some(p => stats[p][b])
    );
    const legX = L, legY = T - 4;
    const itemW = (R - L) / legendBins.length;
    legendBins.forEach((bin, i) => {
      const lx = legX + i * itemW + itemW / 2;
      const sw = document.createElementNS(NS, "rect");
      sw.setAttribute("x", lx - 4); sw.setAttribute("y", legY - 7);
      sw.setAttribute("width", 8); sw.setAttribute("height", 8);
      sw.setAttribute("fill", BIN_COLORS[bin]); sw.setAttribute("rx", "1");
      svgEl.appendChild(sw);
      const lt = document.createElementNS(NS, "text");
      lt.setAttribute("x", lx + 6); lt.setAttribute("y", legY);
      lt.setAttribute("font-family", "ui-monospace, monospace");
      lt.setAttribute("font-size", "8.5"); lt.setAttribute("fill", "#7A7268");
      lt.textContent = bin + "%"; svgEl.appendChild(lt);
    });

    // silica label for legend
    const legLbl = document.createElementNS(NS, "text");
    legLbl.setAttribute("x", L); legLbl.setAttribute("y", T - 14);
    legLbl.setAttribute("font-family", "Source Serif Pro, Charter, Georgia, serif");
    legLbl.setAttribute("font-size", "10"); legLbl.setAttribute("fill", "#7A7268");
    legLbl.setAttribute("font-style", "italic");
    legLbl.textContent = "Biogenic + diagenetic silica (%)";
    svgEl.appendChild(legLbl);
  }

  /* ---------- master rerender ---------- */
  function rerender() {
    const filtered = filterRows();
    document.getElementById("rowCount").textContent = filtered.length.toLocaleString();
    document.getElementById("heroCount").textContent = filtered.length.toLocaleString() + " · live";

    // hero chart: use full unfiltered dataset, fixed view
    const heroResult = scatter({
      svgEl: document.getElementById("heroChart"),
      data: ROWS, xId: "silica", yId: "hld", cId: "phase",
      w: 560, h: 380, pad: {l: 50, r: 18, t: 18, b: 38},
      showTrend: true, showMeans: false, logX: false, logY: false,
    });

    let explorerResult = { r2: {} };
    if (STATE.activePreset === "phase-jumps") {
      renderBoxPlot({
        svgEl: document.getElementById("explorerChart"),
        data: filtered,
        w: 760, h: 460, pad: {l: 58, r: 18, t: 38, b: 44},
      });
      // update viewBox to match
      document.getElementById("explorerChart").setAttribute("viewBox", "0 0 760 460");
    } else {
      explorerResult = scatter({
        svgEl: document.getElementById("explorerChart"),
        data: filtered, xId: STATE.axes.x, yId: STATE.axes.y, cId: STATE.axes.c,
        w: 760, h: 420, pad: {l: 58, r: 18, t: 30, b: 44},
        showTrend: STATE.trends, showMeans: STATE.means,
        logX: STATE.logX, logY: STATE.logY,
      });
      document.getElementById("explorerChart").setAttribute("viewBox", "0 0 760 420");
    }

    // compute phase counts for summary
    const phaseCounts = {};
    PHASE_ORDER.forEach(p => phaseCounts[p] = 0);
    filtered.forEach(d => { if (phaseCounts[d.p] != null) phaseCounts[d.p]++; });

    bindTooltip(document.getElementById("explorerChart"));
    updateR2(explorerResult.r2, phaseCounts);
    renderCompBar(filtered, explorerResult.r2);
    renderTable(filtered);
    buildPillStrip();
    updateMobileBadge(filtered.length);
  }

  /* ---------- boot ---------- */
  if (location.hash && location.hash.length > 4) decodeHash();
  rerender();

  // re-render hero only on ROWS once; explorer is the dynamic one.
}
})();
