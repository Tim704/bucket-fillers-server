/*!
 * bf-datetimepicker — a tiny, dependency-free date & time picker for The Bucket Fillers.
 * ---------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *   The app logs days and incidents across scrambled timezones. The native
 *   <input type="datetime-local"> popup is an OS widget we can't style, so it breaks the
 *   warm, risograph / hard-shadow look of everything else. This is a drop-in replacement
 *   that emits the SAME string format ("YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" in date mode),
 *   so it plugs straight into the existing inputToUTC()/onLogWhen() plumbing.
 *
 * TIMEZONES (important)
 *   This widget is deliberately timezone-DUMB. It only ever deals in wall-clock parts
 *   (year / month / day / hour / minute), exactly like the native control. The app turns
 *   that wall-clock string into a real instant with inputToUTC(value, theUsersZone). So:
 *   pass `now` and `max` already computed in the user's chosen zone (nowLocalInput(tz)).
 *
 * STYLING
 *   No hard-coded palette. Every colour is var(--token, fallback), so it inherits the
 *   app's CSS variables and flips automatically in dark mode. A per-instance `accent`
 *   recolours the selection (text contrast is auto-chosen). Self-injects its <style> once.
 *
 * PERFORMANCE (the interactive bits)
 *   - The 42 day cells and the hour/minute rows are created ONCE per instance.
 *   - Month changes and selection updates REUSE those nodes (textContent + class swaps).
 *     No innerHTML thrash, no node churn, no GC pressure on interaction.
 *   - A single delegated click handler covers the whole panel (nav, days, time, buttons).
 *   - The time columns scroll natively with CSS scroll-snap — no per-frame JS, no scroll
 *     listeners reading layout. Selection is an explicit O(1) class swap.
 *   - The popover DOM is built lazily on first open and then reused.
 *
 * API
 *   const ctl = createDateTimePicker({
 *     mount,            // HTMLElement to render the trigger field into        (required)
 *     value,            // initial "YYYY-MM-DDTHH:MM" / "YYYY-MM-DD"  (""/omitted => `now`)
 *     mode,             // "datetime" (default) | "date"
 *     now,              // reference "now" in the user's zone (today marker + Now button)
 *     min, max,         // inclusive bounds in the same string format       (null = open)
 *     minuteStep,       // minute granularity, default 5 (set 1 for exact minutes)
 *     weekStartsOn,     // 0=Sun … 6=Sat, default 1 (Monday, matches en-GB)
 *     locale,           // for the trigger label, default "en-GB"
 *     accent,           // CSS colour for the selection highlight (default: app gold)
 *     placeholder,      // trigger text when empty
 *     ariaLabel,        // dialog label
 *     onChange,         // (value, ctl) => {}  fired only on COMMIT (Done / Now / Enter)
 *   });
 *   ctl.el, ctl.getValue(), ctl.setValue(v), ctl.setMin(v), ctl.setMax(v),
 *   ctl.setAccent(c), ctl.open(), ctl.close(), ctl.destroy()
 */
(function (global) {
  "use strict";
  if (global.createDateTimePicker) return; // guard against double-loading

  /* ----------------------------------------------------------------------- *
   * One-time stylesheet. Everything is var(--token, fallback): inherits the
   * app's palette + dark mode when present, still looks right standalone.
   * ----------------------------------------------------------------------- */
  var STYLE_ID = "bfdt-styles";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = "\
.bfdt-trigger{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:16px;font-weight:600;color:var(--ink,#2B2420);background:var(--inset,#FBF6EC);border:1.5px solid var(--ink,#2B2420);border-radius:12px;padding:11px 14px;cursor:pointer;text-align:left;transition:box-shadow .08s,transform .08s}\
.bfdt-trigger:hover{transform:translate(-1px,-1px)}\
.bfdt-trigger[aria-expanded='true'],.bfdt-trigger:focus-visible{outline:none;box-shadow:3px 3px 0 var(--bfdt-ring,var(--focus,rgba(233,162,59,.9)))}\
.bfdt-tic{display:flex;flex:none;color:var(--bfdt-accent,var(--gold,#B08442))}\
.bfdt-tlabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}\
.bfdt-trigger.empty .bfdt-tlabel{color:var(--muted3,#A89C8E);font-weight:500}\
.bfdt-tcaret{display:flex;flex:none;color:var(--muted2,#8A7E72);transition:transform .15s}\
.bfdt-trigger[aria-expanded='true'] .bfdt-tcaret{transform:rotate(180deg)}\
.bfdt-svg{width:18px;height:18px;display:block}\
.bfdt-tcaret .bfdt-svg{width:16px;height:16px}\
.bfdt-pop{position:fixed;inset:0;z-index:9999;pointer-events:none}\
.bfdt-scrim{position:fixed;inset:0;background:transparent;opacity:0;pointer-events:none;transition:opacity .18s ease}\
.bfdt-panel{box-sizing:border-box;position:fixed;width:min(322px,calc(100vw - 24px));background:var(--card,#FFFDF8);color:var(--ink,#2B2420);border:1.5px solid var(--ink,#2B2420);border-radius:18px;box-shadow:6px 6px 0 var(--shadow,rgba(43,36,32,.9));padding:16px;pointer-events:auto;font-family:'Hanken Grotesk',system-ui,sans-serif;opacity:0;transform:translateY(6px);transition:opacity .13s ease,transform .13s ease;max-height:calc(100vh - 16px);display:flex;flex-direction:column;overflow:hidden}\
.bfdt-pop.show .bfdt-panel{opacity:1;transform:none}\
.bfdt-pop.show .bfdt-scrim{opacity:1}\
.bfdt-panel.has-time{width:min(444px,calc(100vw - 24px))}\
.bfdt-body{display:flex;gap:12px;align-items:flex-start;flex:1 1 auto;min-height:0;overflow-y:auto}\
.bfdt-cal{flex:1 1 auto;min-width:0}\
.bfdt-kick{display:block;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--bfdt-accent,var(--gold,#B08442));margin-bottom:11px}\
.bfdt-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}\
.bfdt-month{flex:1;min-width:0;text-align:center;font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:19px;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.bfdt-nav{display:flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;border:1.5px solid var(--ink,#2B2420);border-radius:10px;background:var(--card,#FFFDF8);color:var(--ink,#2B2420);cursor:pointer;box-shadow:2px 2px 0 var(--shadow,rgba(43,36,32,.9));transition:transform .08s,box-shadow .08s}\
.bfdt-nav:hover{transform:translate(-1px,-1px)}\
.bfdt-nav:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--shadow,rgba(43,36,32,.9))}\
.bfdt-nav .bfdt-svg{width:16px;height:16px}\
.bfdt-week{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}\
.bfdt-week span{text-align:center;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted3,#A89C8E);padding:4px 0}\
.bfdt-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}\
.bfdt-day{box-sizing:border-box;position:relative;height:38px;display:flex;align-items:center;justify-content:center;border:1.5px solid transparent;border-radius:11px;background:transparent;color:var(--ink,#2B2420);font-family:inherit;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;cursor:pointer;transition:background .1s}\
.bfdt-day:hover{background:var(--inset,#FBF6EC)}\
.bfdt-day.other{color:var(--muted3,#A89C8E);opacity:.5;pointer-events:none}\
.bfdt-day.dis{color:var(--muted3,#A89C8E);opacity:.32;pointer-events:none}\
.bfdt-day.today:not(.sel)::after{content:'';position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--bfdt-accent,var(--accent,#E9A23B))}\
.bfdt-day.sel{background:var(--bfdt-accent,var(--accent,#E9A23B));color:var(--bfdt-on,#2B2420);border-color:var(--ink,#2B2420);box-shadow:2px 2px 0 var(--shadow,rgba(43,36,32,.9));font-weight:700}\
.bfdt-day:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bfdt-ring,var(--focus,rgba(233,162,59,.9)))}\
.bfdt-time{flex:0 0 112px;width:112px;display:flex;flex-direction:column;min-width:0}\
.bfdt-clock{font-family:'Fraunces',Georgia,serif;font-weight:900;font-size:22px;font-variant-numeric:tabular-nums;letter-spacing:-.01em;display:flex;align-items:center;justify-content:center;min-height:34px;margin-bottom:10px}\
.bfdt-clock .sep{color:var(--muted3,#A89C8E);margin:0 1px}\
.bfdt-cols{display:flex;gap:8px;flex:1}\
.bfdt-col{flex:1;min-width:0}\
.bfdt-collab{text-align:center;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2,#8A7E72);margin-bottom:5px}\
.bfdt-scroll{position:relative;box-sizing:border-box;height:150px;overflow-y:auto;overscroll-behavior:contain;scroll-snap-type:y mandatory;background:var(--inset,#FBF6EC);border:1.5px solid var(--ink,#2B2420);border-radius:12px;scrollbar-width:none;-ms-overflow-style:none}\
.bfdt-scroll::-webkit-scrollbar{display:none}\
.bfdt-spacer{height:58px;flex:none;pointer-events:none}\
.bfdt-row{box-sizing:border-box;display:block;width:calc(100% - 8px);height:34px;margin:0 4px;border:1.5px solid transparent;border-radius:9px;background:transparent;color:var(--muted,#6B5F54);font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:16px;font-variant-numeric:tabular-nums;text-align:center;cursor:pointer;scroll-snap-align:center;transition:background .1s,color .1s}\
.bfdt-row:hover{background:var(--card,#FFFDF8);color:var(--ink,#2B2420)}\
.bfdt-row.dis{opacity:.3;pointer-events:none}\
.bfdt-row.sel{background:var(--bfdt-accent,var(--accent,#E9A23B));color:var(--bfdt-on,#2B2420);border-color:var(--ink,#2B2420);box-shadow:2px 2px 0 var(--shadow,rgba(43,36,32,.9));font-weight:700}\
.bfdt-foot{display:flex;align-items:center;gap:10px;margin-top:14px;flex:none}\
.bfdt-now{font-family:inherit;font-weight:700;font-size:13px;border:1.5px solid var(--ink,#2B2420);border-radius:999px;padding:9px 16px;background:var(--card,#FFFDF8);color:var(--ink,#2B2420);cursor:pointer;box-shadow:2px 2px 0 var(--shadow,rgba(43,36,32,.9));transition:transform .08s,box-shadow .08s}\
.bfdt-now:hover{transform:translate(-1px,-1px)}\
.bfdt-now:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--shadow,rgba(43,36,32,.9))}\
.bfdt-done{flex:1;font-family:inherit;font-weight:700;font-size:15px;border:1.5px solid var(--ink,#2B2420);border-radius:12px;padding:11px 18px;background:var(--bfdt-accent,var(--accent,#E9A23B));color:var(--bfdt-on,#2B2420);cursor:pointer;box-shadow:3px 3px 0 var(--shadow,rgba(43,36,32,.9));transition:transform .08s,box-shadow .08s}\
.bfdt-done:hover{transform:translate(-1px,-1px)}\
.bfdt-done:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--shadow,rgba(43,36,32,.9))}\
@media (max-width:520px){\
.bfdt-pop.sheet .bfdt-scrim{background:rgba(0,0,0,.35);pointer-events:auto}\
.bfdt-pop.sheet .bfdt-panel{left:0!important;right:0!important;top:auto!important;bottom:0;width:100%;border-radius:18px 18px 0 0;box-shadow:0 -3px 0 var(--shadow,rgba(43,36,32,.9));transform:translateY(100%);max-height:86vh!important}\
.bfdt-pop.sheet.show .bfdt-panel{transform:none}\
.bfdt-pop.sheet .bfdt-day{height:42px}\
.bfdt-time{flex-basis:96px;width:96px}\
.bfdt-body{gap:10px}\
.bfdt-cols{gap:6px}\
.bfdt-clock{font-size:21px;min-height:30px}\
.bfdt-head{gap:6px}\
.bfdt-nav{width:30px;height:30px}\
.bfdt-month{font-size:17px}\
}\
@media (max-width:360px){\
.bfdt-time{flex-basis:78px;width:78px}\
.bfdt-cols{gap:4px}\
.bfdt-body{gap:8px}\
.bfdt-clock{font-size:20px}\
}\
@media (prefers-reduced-motion:reduce){.bfdt-panel,.bfdt-scrim,.bfdt-tcaret{transition:none!important}}";
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ----------------------------------------------------------------------- *
   * Inline icons — thin, rounded strokes to echo the app's hand-drawn SVGs.
   * `currentColor` lets each one pick up its surrounding text colour.
   * ----------------------------------------------------------------------- */
  function icon(paths) {
    return "<svg class='bfdt-svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' " +
      "stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>" + paths + "</svg>";
  }
  var ICON = {
    cal: icon("<rect x='3' y='4.5' width='18' height='16' rx='3'/><path d='M3 9h18'/><path d='M8 2.5v4M16 2.5v4'/>"),
    clock: icon("<circle cx='12' cy='12' r='8.5'/><path d='M12 7.5V12l3 2'/>"),
    caret: icon("<path d='M6 9.5l6 6 6-6'/>"),
    left: icon("<path d='M14.5 6l-6 6 6 6'/>"),
    right: icon("<path d='M9.5 6l6 6-6 6'/>")
  };

  /* ----------------------------------------------------------------------- *
   * Pure date helpers. `m` is 1-12 everywhere except the few new Date() calls.
   * ----------------------------------------------------------------------- */
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var DOW2 = ["Su","Mo","Tu","We","Th","Fr","Sa"]; // indexed by JS getDay()

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }            // m 1-12
  function firstDow(y, m) { return new Date(y, m - 1, 1).getDay(); }            // 0=Sun
  function dayKey(y, m, d) { return y * 10000 + m * 100 + d; }                  // comparable day
  function minKey(y, m, d, h, mi) { return (dayKey(y, m, d) * 24 + h) * 60 + mi; }
  function clone(s) { return { y: s.y, m: s.m, d: s.d, h: s.h || 0, mi: s.mi || 0 }; }
  function parse(v) {
    var r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v || "");
    if (!r) return null;
    return { y: +r[1], m: +r[2], d: +r[3], h: r[4] != null ? +r[4] : 0, mi: r[5] != null ? +r[5] : 0 };
  }
  function deviceNow() {
    var n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), mi: n.getMinutes() };
  }

  // Selection highlight: parse the accent, pick legible text on top, derive a soft ring.
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function relLum(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrastRatio(l1, l2) { var hi = Math.max(l1, l2) + 0.05, lo = Math.min(l1, l2) + 0.05; return hi / lo; }
  var INK_LUM = relLum([43, 36, 32]), WHITE_LUM = relLum([255, 247, 234]);  // the two candidate text colours
  function accentVars(accent) {
    var rgb = accent && hexToRgb(accent);
    var on = "#2B2420";
    if (rgb) {   // pick whichever text colour truly has the higher contrast on this accent (beats a flat luminance cutoff,
      var la = relLum(rgb);  // which mis-chose warm-white on golds/greens and failed WCAG)
      on = contrastRatio(la, WHITE_LUM) > contrastRatio(la, INK_LUM) ? "#FFF7EA" : "#2B2420";
    }
    return {
      accent: accent || "var(--accent,#E9A23B)",
      on: on,
      ring: rgb ? "rgba(" + rgb.join(",") + ",.34)" : "var(--focus,rgba(233,162,59,.9))"
    };
  }
  function applyAccent(el, v) {
    if (!el) return;
    el.style.setProperty("--bfdt-accent", v.accent);
    el.style.setProperty("--bfdt-on", v.on);
    el.style.setProperty("--bfdt-ring", v.ring);
  }

  /* ======================================================================= *
   * Factory
   * ======================================================================= */
  function createDateTimePicker(opts) {
    opts = opts || {};
    injectStyles();

    var mount = opts.mount;
    if (!mount) { console.warn("[bf-datetimepicker] needs a `mount` element"); return null; }

    // --- normalised config -------------------------------------------------
    var mode = opts.mode === "date" ? "date" : "datetime";
    var step = mode === "datetime" ? Math.max(1, opts.minuteStep || 5) : 0;
    var weekStartsOn = (opts.weekStartsOn != null ? opts.weekStartsOn : 1) % 7;
    var locale = opts.locale || "en-GB";
    var placeholder = opts.placeholder || (mode === "date" ? "Pick a day" : "Pick a day & time");
    var onChange = typeof opts.onChange === "function" ? opts.onChange : null;

    // wall-clock state (st.value = committed source of truth; st.sel = popover working copy)
    var st = {
      min: parse(opts.min), max: parse(opts.max),
      now: parse(opts.now) || deviceNow(),
      accent: opts.accent || null,
      value: "", sel: null, viewY: 0, viewM: 1,
      open: false, built: false, raf: 0,
      cells: [], hMap: {}, mMap: {},
      selCell: null, hSel: null, mSel: null
    };
    var minuteValues = []; // 0, step, 2*step …
    if (mode === "datetime") for (var mv = 0; mv < 60; mv += step) minuteValues.push(mv);

    // DOM refs (popover bits filled in by build())
    var trigger, labelEl, pop, panelEl, monthEl, gridEl, hScroll, mScroll, hhEl, mmEl;

    /* ---- value helpers --------------------------------------------------- */
    function floorMin(mi) { return step > 1 ? Math.floor(mi / step) * step : mi; }

    // Pull a wall-clock tuple back inside [min,max]; minute kept on-step (floor).
    function clampSel(s) {
      s = clone(s);
      if (mode === "datetime") s.mi = floorMin(s.mi); else { s.h = 0; s.mi = 0; }
      if (st.max) {
        var over = mode === "datetime"
          ? minKey(s.y, s.m, s.d, s.h, s.mi) > minKey(st.max.y, st.max.m, st.max.d, st.max.h, st.max.mi)
          : dayKey(s.y, s.m, s.d) > dayKey(st.max.y, st.max.m, st.max.d);
        if (over) s = { y: st.max.y, m: st.max.m, d: st.max.d, h: mode === "datetime" ? st.max.h : 0, mi: mode === "datetime" ? floorMin(st.max.mi) : 0 };
      }
      if (st.min) {
        var under = mode === "datetime"
          ? minKey(s.y, s.m, s.d, s.h, s.mi) < minKey(st.min.y, st.min.m, st.min.d, st.min.h, st.min.mi)
          : dayKey(s.y, s.m, s.d) < dayKey(st.min.y, st.min.m, st.min.d);
        if (under) s = { y: st.min.y, m: st.min.m, d: st.min.d, h: mode === "datetime" ? st.min.h : 0, mi: mode === "datetime" ? floorMin(st.min.mi) : 0 };
      }
      return s;
    }
    function format(s) {
      var base = s.y + "-" + pad(s.m) + "-" + pad(s.d);
      return mode === "datetime" ? base + "T" + pad(s.h) + ":" + pad(s.mi) : base;
    }
    function fmtLabel(v) {
      var s = parse(v); if (!s) return placeholder;
      var d = new Date(s.y, s.m - 1, s.d, s.h, s.mi);
      var day = d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
      return mode === "datetime" ? day + "  ·  " + pad(s.h) + ":" + pad(s.mi) : day;
    }

    /* ---- trigger field --------------------------------------------------- */
    function buildTrigger() {
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "bfdt-trigger";
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      if (opts.ariaLabel) trigger.setAttribute("aria-label", opts.ariaLabel);
      trigger.innerHTML =
        "<span class='bfdt-tic'>" + (mode === "datetime" ? ICON.cal : ICON.cal) + "</span>" +
        "<span class='bfdt-tlabel'></span>" +
        "<span class='bfdt-tcaret'>" + ICON.caret + "</span>";
      labelEl = trigger.querySelector(".bfdt-tlabel");
      applyAccent(trigger, accentVars(st.accent));
      updateLabel();
      trigger.addEventListener("click", function () { st.open ? close({ focus: false }) : openPop(); });
      mount.appendChild(trigger);
    }
    function updateLabel() {
      labelEl.textContent = fmtLabel(st.value);
      trigger.classList.toggle("empty", !st.value);
    }

    /* ---- popover construction (once) ------------------------------------ */
    function build() {
      if (st.built) return;
      pop = document.createElement("div");
      pop.className = "bfdt-pop";
      pop.innerHTML =
        "<div class='bfdt-scrim'></div>" +
        "<div class='bfdt-panel" + (mode === "datetime" ? " has-time" : "") + "' role='dialog'" + (opts.ariaLabel ? " aria-label='" + opts.ariaLabel + "'" : "") + ">" +
          "<span class='bfdt-kick'>" + (mode === "datetime" ? "Pick a moment" : "Pick a day") + "</span>" +
          "<div class='bfdt-body'>" +
            "<div class='bfdt-cal'>" +
              "<div class='bfdt-head'>" +
                "<button type='button' class='bfdt-nav' data-nav='-1' aria-label='Previous month'>" + ICON.left + "</button>" +
                "<div class='bfdt-month' aria-live='polite'></div>" +
                "<button type='button' class='bfdt-nav' data-nav='1' aria-label='Next month'>" + ICON.right + "</button>" +
              "</div>" +
              "<div class='bfdt-week'>" + weekHeader() + "</div>" +
              "<div class='bfdt-grid' role='grid' aria-label='Calendar'></div>" +
            "</div>" +
            (mode === "datetime" ? timeSection() : "") +
          "</div>" +
          "<div class='bfdt-foot'>" +
            (mode === "datetime"
              ? "<button type='button' class='bfdt-now'>Now</button><button type='button' class='bfdt-done'>Done</button>"
              : "<button type='button' class='bfdt-now'>Today</button>") +
          "</div>" +
        "</div>";

      panelEl = pop.querySelector(".bfdt-panel");
      monthEl = pop.querySelector(".bfdt-month");
      gridEl = pop.querySelector(".bfdt-grid");

      // 42 reusable day cells, built once.
      var frag = document.createDocumentFragment();
      for (var i = 0; i < 42; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "bfdt-day";
        b.setAttribute("role", "gridcell");
        st.cells.push(b);
        frag.appendChild(b);
      }
      gridEl.appendChild(frag);

      if (mode === "datetime") {
        hScroll = pop.querySelector("[data-list='h']");
        mScroll = pop.querySelector("[data-list='m']");
        hhEl = pop.querySelector(".bfdt-clock .hh");
        mmEl = pop.querySelector(".bfdt-clock .mm");
        var hv = []; for (var h = 0; h < 24; h++) hv.push(h);
        st.hMap = buildRows(hScroll, hv);
        st.mMap = buildRows(mScroll, minuteValues);
      }

      // Single delegated click handler for the whole panel (nav/day/time/buttons).
      panelEl.addEventListener("click", onPanelClick);
      applyAccent(panelEl, accentVars(st.accent));
      document.body.appendChild(pop);
      st.built = true;
    }
    function weekHeader() {
      var s = "";
      for (var i = 0; i < 7; i++) s += "<span>" + DOW2[(weekStartsOn + i) % 7] + "</span>";
      return s;
    }
    function timeSection() {
      return "<div class='bfdt-time'>" +
        "<div class='bfdt-clock'><span class='hh'>00</span><span class='sep'>:</span><span class='mm'>00</span></div>" +
        "<div class='bfdt-cols'>" +
          "<div class='bfdt-col'><div class='bfdt-collab'>Hr</div><div class='bfdt-scroll' data-list='h'></div></div>" +
          "<div class='bfdt-col'><div class='bfdt-collab'>Min</div><div class='bfdt-scroll' data-list='m'></div></div>" +
        "</div></div>";
    }
    // A scroll column: spacer + on-step rows + spacer, so first/last can snap to centre.
    function buildRows(container, values) {
      var map = {};
      var frag = document.createDocumentFragment();
      frag.appendChild(spacer());
      values.forEach(function (val) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "bfdt-row";
        b.textContent = pad(val);
        b.dataset.val = val;
        map[val] = b;
        frag.appendChild(b);
      });
      frag.appendChild(spacer());
      container.appendChild(frag);
      return map;
    }
    function spacer() { var s = document.createElement("div"); s.className = "bfdt-spacer"; return s; }

    /* ---- rendering (node reuse only — never rebuilds) -------------------- */
    function renderMonth() {
      monthEl.textContent = MONTHS[st.viewM - 1] + " " + st.viewY;
      var start = (firstDow(st.viewY, st.viewM) - weekStartsOn + 7) % 7;
      var dim = daysInMonth(st.viewY, st.viewM);
      var maxDK = st.max ? dayKey(st.max.y, st.max.m, st.max.d) : Infinity;
      var minDK = st.min ? dayKey(st.min.y, st.min.m, st.min.d) : -Infinity;
      for (var i = 0; i < 42; i++) {
        var cell = st.cells[i];
        var inMonth = i >= start && i < start + dim;
        var dayNum = inMonth ? i - start + 1 : (i < start ? daysInMonth(st.viewM === 1 ? st.viewY - 1 : st.viewY, st.viewM === 1 ? 12 : st.viewM - 1) - start + 1 + i : i - start - dim + 1);
        cell.textContent = dayNum;
        cell._day = dayNum;
        cell._inMonth = inMonth;
        var dis = inMonth && (dayKey(st.viewY, st.viewM, dayNum) > maxDK || dayKey(st.viewY, st.viewM, dayNum) < minDK);
        var today = inMonth && st.viewY === st.now.y && st.viewM === st.now.m && dayNum === st.now.d;
        cell.className = "bfdt-day" + (!inMonth ? " other" : "") + (dis ? " dis" : "") + (today ? " today" : "");
        cell.setAttribute("aria-hidden", inMonth ? "false" : "true");
      }
      st.selCell = null;
      markDay();
      refreshTimeBounds();
      reselectTime();
    }
    function markDay() {
      if (st.selCell) { st.selCell.classList.remove("sel"); st.selCell.removeAttribute("aria-selected"); st.selCell = null; }
      if (st.sel && st.sel.y === st.viewY && st.sel.m === st.viewM) {
        for (var i = 0; i < st.cells.length; i++) {
          var c = st.cells[i];
          if (c._inMonth && c._day === st.sel.d && !c.classList.contains("dis")) {
            c.classList.add("sel"); c.setAttribute("aria-selected", "true"); st.selCell = c; break;
          }
        }
      }
    }
    // Grey out hours/minutes that would push past min/max for the selected day.
    function refreshTimeBounds() {
      if (mode !== "datetime" || !st.sel) return;
      var onMax = st.max && dayKey(st.sel.y, st.sel.m, st.sel.d) === dayKey(st.max.y, st.max.m, st.max.d);
      var onMin = st.min && dayKey(st.sel.y, st.sel.m, st.sel.d) === dayKey(st.min.y, st.min.m, st.min.d);
      for (var h = 0; h < 24; h++)
        st.hMap[h].classList.toggle("dis", (onMax && h > st.max.h) || (onMin && h < st.min.h));
      minuteValues.forEach(function (mm) {
        var dis = (onMax && st.sel.h === st.max.h && mm > st.max.mi) || (onMin && st.sel.h === st.min.h && mm < st.min.mi);
        st.mMap[mm].classList.toggle("dis", dis);
      });
    }
    function reselectTime() {
      if (mode !== "datetime" || !st.sel) return;
      swap("hSel", st.hMap[st.sel.h]);
      swap("mSel", st.mMap[st.sel.mi]);
      updateClock();
    }
    function swap(ref, el) {
      if (st[ref]) st[ref].classList.remove("sel");
      if (el) { el.classList.add("sel"); st[ref] = el; }
    }
    function updateClock() {
      if (hhEl) { hhEl.textContent = pad(st.sel.h); mmEl.textContent = pad(st.sel.mi); }
    }
    // Scroll a row to the column's vertical centre without scrolling the page.
    function center(container, row, smooth) {
      if (!container || !row) return;
      var top = row.offsetTop - (container.clientHeight - row.offsetHeight) / 2;
      var reduce = global.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;
      container.scrollTo({ top: top, behavior: smooth && !reduce ? "smooth" : "auto" });
    }

    /* ---- interaction ----------------------------------------------------- */
    function onPanelClick(e) {
      var t;
      if ((t = e.target.closest("[data-nav]"))) return stepMonth(+t.dataset.nav);
      if (e.target.closest(".bfdt-now")) return setToNow();
      if (e.target.closest(".bfdt-done")) return commit();
      if ((t = e.target.closest(".bfdt-day"))) {
        if (t._inMonth && !t.classList.contains("dis")) pickDay(t._day);
        return;
      }
      if ((t = e.target.closest(".bfdt-row"))) {
        if (!t.classList.contains("dis")) {
          var v = +t.dataset.val;
          if (t.parentNode === hScroll) { st.sel.h = v; st.sel = clampSel(st.sel); refreshTimeBounds(); reselectTime(); center(hScroll, st.hMap[st.sel.h], true); }
          else { st.sel.mi = v; updateClock(); swap("mSel", st.mMap[v]); center(mScroll, t, true); }
        }
        return;
      }
    }
    function stepMonth(delta) {
      var m = st.viewM + delta, y = st.viewY;
      if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
      st.viewM = m; st.viewY = y; renderMonth();
    }
    function pickDay(dayNum) {
      st.sel.y = st.viewY; st.sel.m = st.viewM; st.sel.d = dayNum;
      st.sel = clampSel(st.sel);
      markDay(); refreshTimeBounds(); reselectTime();
      if (mode === "datetime") { center(hScroll, st.hMap[st.sel.h]); center(mScroll, st.mMap[st.sel.mi]); }
      else commit(); // date-only: one tap is the whole decision
    }
    function setToNow() {
      st.sel = clampSel(clone(st.now));
      st.viewY = st.sel.y; st.viewM = st.sel.m;
      renderMonth();
      if (mode === "datetime") { center(hScroll, st.hMap[st.sel.h], true); center(mScroll, st.mMap[st.sel.mi], true); }
      commit();
    }
    // Arrow-key day navigation, clamped to bounds, crossing months as needed.
    function moveDay(delta) {
      var d = new Date(st.sel.y, st.sel.m - 1, st.sel.d + delta);
      var t = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
      var dk = dayKey(t.y, t.m, t.d);
      if (st.max && dk > dayKey(st.max.y, st.max.m, st.max.d)) return;
      if (st.min && dk < dayKey(st.min.y, st.min.m, st.min.d)) return;
      st.sel.y = t.y; st.sel.m = t.m; st.sel.d = t.d;
      st.sel = clampSel(st.sel);
      if (t.m !== st.viewM || t.y !== st.viewY) { st.viewM = t.m; st.viewY = t.y; renderMonth(); }
      else { markDay(); refreshTimeBounds(); reselectTime(); }
      if (st.selCell) st.selCell.focus();
    }

    /* ---- open / close / commit ------------------------------------------ */
    function sheetMode() { return global.matchMedia && matchMedia("(max-width:520px)").matches; }
    function openPop() {
      build();
      st.sel = clampSel(parse(st.value) || clone(st.now));
      st.viewY = st.sel.y; st.viewM = st.sel.m;
      renderMonth();
      pop.classList.toggle("sheet", sheetMode());
      st.open = true;
      trigger.setAttribute("aria-expanded", "true");
      position();
      if (mode === "datetime") { center(hScroll, st.hMap[st.sel.h]); center(mScroll, st.mMap[st.sel.mi]); }
      document.addEventListener("pointerdown", onDocDown, true);
      document.addEventListener("keydown", onKey, true);
      global.addEventListener("resize", onReflow, true);
      global.addEventListener("scroll", onReflow, true);
      requestAnimationFrame(function () {
        pop.classList.add("show");
        if (st.selCell) st.selCell.focus();
      });
    }
    function close(o) {
      o = o || {};
      if (pop) pop.classList.remove("show");
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      global.removeEventListener("resize", onReflow, true);
      global.removeEventListener("scroll", onReflow, true);
      if (st.open && o.focus !== false && trigger) trigger.focus();
      st.open = false;
      trigger && trigger.setAttribute("aria-expanded", "false");
    }
    function commit() {
      st.value = format(st.sel);
      updateLabel();
      close();                       // hide BEFORE the callback: onChange may re-render us away
      if (onChange) onChange(st.value, controller);
    }
    function onDocDown(e) {
      if (panelEl && panelEl.contains(e.target)) return;
      if (trigger && trigger.contains(e.target)) return;
      close({ focus: false });       // click outside cancels (committed value untouched)
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); return close(); }
      var inPanel = panelEl && panelEl.contains(document.activeElement);
      if (e.key === "Enter" && inPanel) { e.preventDefault(); return commit(); }
      if (inPanel && e.key.indexOf("Arrow") === 0) {
        var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (map[e.key] != null) { e.preventDefault(); moveDay(map[e.key]); }
      }
    }
    function onReflow() {
      if (!st.open || st.raf) return;
      st.raf = requestAnimationFrame(function () {
        st.raf = 0;
        pop.classList.toggle("sheet", sheetMode());
        position();
      });
    }
    // Anchor under the trigger; flip above if it would overflow; clamp horizontally.
    function position() {
      if (!panelEl) return;
      if (pop.classList.contains("sheet")) {         // sheet sizing is pure CSS — drop any leftover popover geometry
        panelEl.style.maxHeight = ""; panelEl.style.top = ""; panelEl.style.left = "";
        return;
      }
      panelEl.style.maxHeight = "";                  // clear last cap so we measure natural height
      var r = trigger.getBoundingClientRect();
      var pw = panelEl.offsetWidth, ph = panelEl.offsetHeight, gap = 8, margin = 8;
      var vw = global.innerWidth, vh = global.innerHeight;
      var left = Math.min(Math.max(margin, r.left), vw - pw - margin);
      var top = r.bottom + gap;
      if (top + ph > vh - margin) {                  // doesn't fit below the trigger
        if (r.top - gap - ph > margin) top = r.top - gap - ph; // flip above when it fits there
        else top = margin;                           // otherwise pin near the top edge…
      }
      top = Math.max(margin, top);
      panelEl.style.left = left + "px";
      panelEl.style.top = top + "px";
      panelEl.style.maxHeight = (vh - top - margin) + "px";  // …and cap so it never runs off-screen
    }

    /* ---- public controller ---------------------------------------------- */
    var controller = {
      el: null,
      getValue: function () { return st.value; },
      setValue: function (v) {
        st.value = parse(v) ? format(clampSel(parse(v))) : "";
        updateLabel();
        if (st.open) { st.sel = clampSel(parse(st.value) || clone(st.now)); st.viewY = st.sel.y; st.viewM = st.sel.m; renderMonth(); }
        return controller;
      },
      setMin: function (v) { st.min = parse(v); if (st.open) renderMonth(); return controller; },
      setMax: function (v) { st.max = parse(v); if (st.open) renderMonth(); return controller; },
      setAccent: function (c) {
        st.accent = c || null;
        var v = accentVars(st.accent);
        applyAccent(trigger, v); applyAccent(panelEl, v);
        return controller;
      },
      open: openPop,
      close: function () { close(); return controller; },
      destroy: function () {
        close({ focus: false });
        if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
        if (trigger && trigger.parentNode) trigger.parentNode.removeChild(trigger);
        pop = panelEl = null; st.built = false;
      }
    };

    buildTrigger();
    controller.el = trigger;
    if (opts.value) controller.setValue(opts.value);
    return controller;
  }

  global.createDateTimePicker = createDateTimePicker;
})(typeof window !== "undefined" ? window : this);
