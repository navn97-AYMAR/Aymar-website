import Lenis from "lenis";
import { ENGINE_FRAME_COUNT, preloadEngineFrames } from "./preload.js";
import { createCanvasRenderer, getResponsiveCoverRect } from "./canvasRenderer.js";

const SCROLL_PER_FRAME = 32; // higher = more scroll needed per frame = slower playback

const SOURCE_W = 1920, SOURCE_H = 1080;

// Frame numbers = the exact moment each piston is fully up. anchor = that
// piston's cap-top pixel position in the native 1920x1080 source frame
// (found by sampling the actual frames), used to aim the connector line
// regardless of screen size.
const ENGINE_REVEALS = [
  {
    frame: 432, // piston 1 up
    hideFrame: 448, // card disappears here instead of riding through to the next reveal
    anchor: { x: 742, y: 106 },
    eyebrow: "Engine 01",
    name: "S2-ORION",
    trades: "605",
    pnl: "₹12,06,076",
    pf: "5.59",
    capital: "₹5,00,000",
    winrate: "65.12%",
    dd: "3.01%",
  },
  {
    frame: 495, // piston 2 up
    hideFrame: 506, // card disappears here instead of riding through to the next reveal
    anchor: { x: 861, y: 141 },
    eyebrow: "Engine 02",
    name: "ORION-X5",
    trades: "577",
    pnl: "₹24,44,458",
    pf: "5.10",
    capital: "₹25,000",
    winrate: "60.4%",
    dd: "7.16%",
  },
  {
    frame: 561, // piston 3 up
    hideFrame: 573, // card disappears here instead of riding through to the next reveal
    anchor: { x: 1053, y: 136 },
    eyebrow: "Engine 03",
    name: "VEGA",
    trades: "327",
    pnl: "₹6,55,975",
    pf: "2.68",
    capital: "₹5,00,000",
    winrate: "74.01%",
    dd: "6.44%",
  },
  {
    frame: 619, // piston 4 up
    hideFrame: 637, // card disappears here (last reveal, so it just ends rather than handing off)
    anchor: { x: 1222, y: 125 },
    eyebrow: "Engine 04",
    name: "VEGA-V5",
    trades: "325",
    pnl: "₹6,42,479",
    pf: "2.75",
    capital: "₹25,000",
    winrate: "73.54%",
    dd: "5.75%",
  },
  {
    frame: 655, // finale - rides all the way to the last frame, no hand-off
    isKratos: true,
    eyebrow: "Champion of Champions",
    name: "KRATOS",
    capital: "₹5,00,000",
    // Numeric fields aren't static text here - updateKratosLive() counts
    // them up from 0 to these final values as the visitor scrolls through
    // this reveal's frame range, instead of just appearing at full value.
    final: { trades: 1759, pnl: 4542068, pf: 4.27, winrate: 67.48, ddPct: 13.57, ddRs: 67872 },
  },
];

// How long to keep re-measuring the card's position after it changes (its
// entrance transition takes ~0.65s) so the connector line tracks it in
// smoothly instead of snapping to a stale, pre-transition position.
const LINE_TRACK_MS = 700;

export function createEnginesView() {
  const canvas = document.getElementById("engines-canvas");
  const spacer = document.getElementById("engines-spacer");
  const loadingEl = document.getElementById("engines-loading");
  const fillEl = loadingEl.querySelector(".loader-fill");
  const pctEl = loadingEl.querySelector(".loader-pct");
  const revealEl = document.getElementById("engine-reveal");
  const revealCardEl = revealEl.querySelector(".engine-reveal-card");
  const revealFields = {
    eyebrow: document.getElementById("engine-reveal-eyebrow"),
    name: document.getElementById("engine-reveal-name"),
    trades: document.getElementById("engine-reveal-trades"),
    pnl: document.getElementById("engine-reveal-pnl"),
    pf: document.getElementById("engine-reveal-pf"),
    capital: document.getElementById("engine-reveal-capital"),
    winrate: document.getElementById("engine-reveal-winrate"),
    dd: document.getElementById("engine-reveal-dd"),
  };
  const lineEl = document.getElementById("engine-reveal-line");
  const linePath = document.getElementById("engine-reveal-line-el");
  const lineDot = document.getElementById("engine-reveal-line-dot");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Cover-fit at full zoom (1 = no intentional under-fill): true edge-to-edge,
  // no bars, no held-back margin. Safe because the source frames keep the
  // engine + AYMAR lockup centered with smoke padding on every side - any
  // crop on an unusual screen shape eats into that padding, never the
  // subject itself.
  const renderer = createCanvasRenderer(canvas, { zoom: 1 });
  const scrollDistance = (ENGINE_FRAME_COUNT - 1) * SCROLL_PER_FRAME;

  let images = null;
  let loadingPromise = null;
  let lenis = null;
  let currentFrame = -1;
  let rafId = null;
  let activeIndex = -1; // index into ENGINE_REVEALS currently shown, -1 = none
  let lineTrackRafId = null;
  let lineTrackUntil = 0;

  function sizeSpacer() {
    spacer.style.height = `${scrollDistance + window.innerHeight}px`;
  }

  function frameForScroll(y) {
    const clamped = Math.min(Math.max(y, 0), scrollDistance);
    return Math.round((clamped / scrollDistance) * (ENGINE_FRAME_COUNT - 1));
  }

  // Last-crossed threshold wins: the card for whichever piston is currently
  // up stays on screen for as long as scrolling stays in that piston's
  // frame range - including staying forever if the visitor simply stops
  // scrolling. It only changes (to the next card, or to nothing) once the
  // visitor actually scrolls again past that range. No timer involved.
  // A reveal's range ends at its own hideFrame if it has one, otherwise it
  // rides through to the next reveal's start frame.
  function activeRevealIndex(frame) {
    let idx = -1;
    for (let i = 0; i < ENGINE_REVEALS.length; i++) {
      const reveal = ENGINE_REVEALS[i];
      const end = reveal.hideFrame ?? (ENGINE_REVEALS[i + 1] ? ENGINE_REVEALS[i + 1].frame : Infinity);
      if (frame >= reveal.frame && frame < end) return i;
    }
    return idx;
  }

  // Elbow path: straight out to the right from the piston tip, then a
  // right-angle bend down (or up) into the card's left edge.
  function positionConnectorLine(reveal) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Responsive: on a portrait phone, cover-fit against this 1920x1080
    // source only shows its middle ~26% of width, which pushed piston 4's
    // anchor (x:1222) outside the visible crop entirely - the connector
    // line pointed at a clamped screen edge instead of the actual piston.
    // Falls back to contain-fit there (matching the canvas's own default
    // "cover" draw, which uses this same rule), so every anchor stays
    // within the visible frame on any viewport shape.
    const { scale, dx, dy } = getResponsiveCoverRect(window.innerWidth, window.innerHeight, SOURCE_W, SOURCE_H, dpr, 1);
    const margin = 10;
    // On a browser viewport proportionally wider than the 16:9 source,
    // cover-fit crops the top/bottom of the frame - and piston 1 sits close
    // enough to the top that its true anchor can land above y=0 on some
    // window shapes. Clamped to the visible edge instead of letting the
    // line start off-screen (which hid the horizontal segment entirely and
    // made the vertical segment look like it shot out the top).
    const x1 = Math.min(Math.max(dx + reveal.anchor.x * scale, margin), window.innerWidth - margin);
    const y1 = Math.min(Math.max(dy + reveal.anchor.y * scale, margin), window.innerHeight - margin);

    const cardRect = revealCardEl.getBoundingClientRect();
    const x2 = cardRect.left;
    const y2 = cardRect.top + cardRect.height / 2;

    linePath.setAttribute("d", `M ${x1} ${y1} H ${x2} V ${y2}`);
    lineDot.setAttribute("cx", x1);
    lineDot.setAttribute("cy", y1);
  }

  // Re-measures the card's position every frame for a short window after it
  // changes, so the line tracks it smoothly through its entrance transition
  // instead of using a stale pre-animation position.
  function trackConnectorLine(reveal) {
    lineTrackUntil = performance.now() + LINE_TRACK_MS;
    if (lineTrackRafId) return;

    function tick() {
      positionConnectorLine(reveal);
      if (performance.now() < lineTrackUntil) {
        lineTrackRafId = requestAnimationFrame(tick);
      } else {
        lineTrackRafId = null;
      }
    }
    lineTrackRafId = requestAnimationFrame(tick);
  }

  function formatINR(n) {
    return "₹" + Math.round(n).toLocaleString("en-IN");
  }

  // Counts every numeric stat up from 0 to its final value in step with how
  // far the visitor has scrolled through the KRATOS reveal's own frame
  // range (655 -> last frame), instead of the value just appearing whole.
  function updateKratosLive(frame, reveal) {
    const start = reveal.frame;
    const end = ENGINE_FRAME_COUNT - 1;
    const progress = end > start ? Math.min(Math.max((frame - start) / (end - start), 0), 1) : 1;
    const f = reveal.final;

    revealFields.trades.textContent = Math.round(f.trades * progress).toLocaleString("en-IN");
    revealFields.pnl.textContent = formatINR(f.pnl * progress);
    revealFields.pf.textContent = (f.pf * progress).toFixed(2);
    revealFields.winrate.textContent = (f.winrate * progress).toFixed(2) + "%";
    revealFields.dd.textContent = `${(f.ddPct * progress).toFixed(2)}% (${formatINR(f.ddRs * progress)})`;
  }

  function showReveal(reveal) {
    revealFields.eyebrow.textContent = reveal.eyebrow;
    revealFields.name.textContent = reveal.name;
    revealFields.capital.textContent = reveal.capital;

    revealCardEl.classList.toggle("kratos-card", !!reveal.isKratos);

    if (reveal.isKratos) {
      // No piston line for the finale card - it isn't tied to one piston.
      // Its numbers get set right after this, by the isKratos check in
      // renderAtScroll (runs every frame change, using the live frame).
      lineEl.classList.remove("show");
    } else {
      revealFields.trades.textContent = reveal.trades;
      revealFields.pnl.textContent = reveal.pnl;
      revealFields.pf.textContent = reveal.pf;
      revealFields.winrate.textContent = reveal.winrate;
      revealFields.dd.textContent = reveal.dd;
      lineEl.classList.add("show");
      trackConnectorLine(reveal);
    }

    revealEl.classList.add("show");
  }

  function hideReveal() {
    revealEl.classList.remove("show");
    lineEl.classList.remove("show");
    revealCardEl.classList.remove("kratos-card");
  }

  function updateReveal(frame) {
    const idx = activeRevealIndex(frame);
    if (idx === activeIndex) return;
    activeIndex = idx;
    if (idx === -1) hideReveal();
    else showReveal(ENGINE_REVEALS[idx]);
  }

  function renderAtScroll(y) {
    const frame = frameForScroll(y);
    if (frame !== currentFrame) {
      currentFrame = frame;
      renderer.draw(images[frame]);
      updateReveal(frame);
      if (activeIndex !== -1 && ENGINE_REVEALS[activeIndex].isKratos) {
        updateKratosLive(frame, ENGINE_REVEALS[activeIndex]);
      }
    }
  }

  function onResize() {
    const reveal = ENGINE_REVEALS[activeIndex];
    if (reveal && !reveal.isKratos) positionConnectorLine(reveal);
  }

  function ensureLoaded() {
    if (loadingPromise) return loadingPromise;
    loadingEl.style.display = "flex";
    loadingPromise = preloadEngineFrames((p) => {
      const pct = Math.round(p * 100);
      fillEl.style.width = `${pct}%`;
      pctEl.textContent = `${pct}%`;
    }).then((imgs) => {
      images = imgs;
      loadingEl.style.display = "none";
      renderer.draw(images[0]);
    });
    return loadingPromise;
  }

  async function activate() {
    // Undo deactivate()'s instant-hide override so the reveal card's normal
    // fade transition (for scrolling back and forth within this view) works
    // again - display is now governed purely by the show/hide classes.
    revealEl.style.display = "";
    lineEl.style.display = "";

    canvas.style.display = "block";
    // The spacer stays hidden (and the page un-scrollable) until frames are
    // actually ready, so there's no window where the user can scroll a
    // "loading" canvas out of sync with Lenis.
    spacer.style.display = "none";

    await ensureLoaded();

    spacer.style.display = "block";
    sizeSpacer();
    window.addEventListener("resize", sizeSpacer);
    window.addEventListener("resize", onResize);

    if (!lenis) {
      lenis = new Lenis({
        duration: prefersReduced ? 0.2 : 1.0,
        smoothWheel: !prefersReduced,
        touchMultiplier: 1.3,
      });
      lenis.on("scroll", ({ scroll }) => renderAtScroll(scroll));
    }
    lenis.start();
    window.scrollTo(0, 0);
    lenis.resize();
    currentFrame = -1;
    activeIndex = -1;
    renderAtScroll(0);

    function raf(time) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);
  }

  function deactivate() {
    canvas.style.display = "none";
    spacer.style.display = "none";
    loadingEl.style.display = "none";
    hideReveal();
    // hideReveal() only removes the "show" class, which fades out over
    // ~0.65s - fine for scrolling back within this view, but leaving the
    // switch to another nav tab, the card should vanish immediately rather
    // than keep fading out on top of whatever page comes next.
    revealEl.style.display = "none";
    lineEl.style.display = "none";
    activeIndex = -1;
    if (lineTrackRafId) {
      cancelAnimationFrame(lineTrackRafId);
      lineTrackRafId = null;
    }
    window.removeEventListener("resize", sizeSpacer);
    window.removeEventListener("resize", onResize);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (lenis) lenis.stop();
  }

  return { activate, deactivate };
}
