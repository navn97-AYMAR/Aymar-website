import Lenis from "lenis";
import { FRAME_COUNT } from "./preload.js";
import { createReveal } from "./reveal.js";
import { createWhyChapter, CHAPTER_DISTANCE } from "./whyChapter.js";

const SCROLL_PER_FRAME = 20; // px of scroll per animation frame — tune pacing here
const REVEAL_SCROLL_DISTANCE = 700; // px of scroll for the "Welcome to" fade-in
const TRAILING_HOLD = 400; // px of scroll to rest on the finished state

export function createScrollDriver({ images, renderer, smokeImages, bg1Images, endcardState, bridgeState }) {
  const spacer = document.getElementById("scroll-spacer");
  const stageWrap = document.getElementById("stage-wrap");
  const welcomeEl = document.getElementById("welcome-text");
  const smokeCanvas = document.getElementById("smoke-canvas");
  const bg1Canvas = document.getElementById("bg1-canvas");
  const whySection = document.getElementById("why-section");
  const letterMWrap = document.getElementById("letter-m-wrap");
  const letterM = document.getElementById("letter-m");
  const headingTextStack = document.getElementById("why-heading-text-stack");
  const headingText = document.getElementById("why-heading-text");
  const headingText2 = document.getElementById("why-heading-text-2");
  const headingText3 = document.getElementById("why-heading-text-3");
  const headingText4 = document.getElementById("why-heading-text-4");
  const vmgHeading = document.getElementById("vmg-heading");
  const paragraph = document.getElementById("why-paragraph");
  const paragraph2 = document.getElementById("why-paragraph-2");
  const whoContent = document.getElementById("who-content");
  const vmgContent = document.getElementById("vmg-content");
  const vmgPrefix = document.getElementById("vmg-prefix");
  const dashboardReveal = document.getElementById("dashboard-reveal-wrap");
  const endcardCanvas = document.getElementById("endcard-canvas");
  const bridgeCanvas = document.getElementById("endcard-bridge-canvas");
  const siteNav = document.getElementById("site-nav");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sequenceScrollDistance = (FRAME_COUNT - 1) * SCROLL_PER_FRAME;
  const welcomeEnd = sequenceScrollDistance + REVEAL_SCROLL_DISTANCE;
  const totalScrollDistance = welcomeEnd + CHAPTER_DISTANCE + TRAILING_HOLD;

  const reveal = createReveal({ welcomeEl });
  const whyChapter = createWhyChapter({
    renderer,
    stageWrap,
    welcomeEl,
    smokeCanvas,
    smokeImages,
    bg1Canvas,
    bg1Images,
    whySection,
    letterMWrap,
    letterM,
    headingTextStack,
    headingText,
    headingText2,
    headingText3,
    headingText4,
    vmgHeading,
    paragraph,
    paragraph2,
    whoContent,
    vmgContent,
    vmgPrefix,
    dashboardReveal,
    endcardCanvas,
    endcardState,
    bridgeCanvas,
    bridgeState,
    siteNav,
  });

  function sizeSpacer() {
    spacer.style.height = `${totalScrollDistance + window.innerHeight}px`;
  }
  sizeSpacer();
  window.addEventListener("resize", sizeSpacer);

  const lenis = new Lenis({
    duration: prefersReduced ? 0.2 : 1.0,
    smoothWheel: !prefersReduced,
    touchMultiplier: 1.3,
  });

  let currentFrame = -1;

  function frameForScroll(y) {
    const clamped = Math.min(Math.max(y, 0), sequenceScrollDistance);
    const progress = clamped / sequenceScrollDistance;
    return Math.round(progress * (FRAME_COUNT - 1));
  }

  function renderAtScroll(y) {
    const frame = frameForScroll(y);
    if (frame !== currentFrame) {
      currentFrame = frame;
      renderer.draw(images[frame]);
    }

    const revealProgress = (y - sequenceScrollDistance) / REVEAL_SCROLL_DISTANCE;
    reveal.update(revealProgress);

    whyChapter.update(y - welcomeEnd, { lastFrameImg: images[FRAME_COUNT - 1] });
  }

  lenis.on("scroll", ({ scroll }) => {
    renderAtScroll(scroll);
  });

  function raf(time) {
    lenis.raf(time);
    whyChapter.tickBg1(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  // Paint the first frame immediately, before any scroll happens.
  renderAtScroll(0);

  return { lenis };
}
