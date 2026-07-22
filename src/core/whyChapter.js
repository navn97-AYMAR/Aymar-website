import gsap from "gsap";
import { getCoverRect, createCanvasRenderer } from "./canvasRenderer.js";
import { SMOKE_FRAME_COUNT, BG1_FRAME_COUNT, ENDCARD_FRAME_COUNT, BRIDGE_FRAME_COUNT } from "./preload.js";

const SOURCE_W = 1620;
const SOURCE_H = 1080;
// Pixel box of the "M" as it sits inside the final AYMAR frame.
const M_CROP = { x: 695, y: 415, w: 240, h: 197 };
const BG1_FRAME_DURATION_MS = 1000 / 24;
const BG1_TARGET_OPACITY = 0.75;
// Minimum clearance below the fixed top nav bar (roughly its own rendered
// height plus a little breathing room) so headings never sit under it.
const NAV_CLEARANCE_PX = 108;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export const PHASES = {
  smoke: 950,
  fall: 1100,
  heading: 500,
  paragraph: 800,
  retitle: 1300,
  paragraph2: 800,
  retitle2: 1300,
  whoContent: 1000,
  retitle3: 1300, // Who exits, letter flips M-side-up (was 180deg/W-only) into "Mission"
  vmgContent: 1000,
  retitle4: 1300, // cards exit, letter flips back to W into "anna look how our Dashboard looks??"
  dashboardContent: 1200, // dashboard screenshot fades in below the heading, same background
  dashboardToBridge: 500, // small card crossfades into the bridge clip's own frame 1 (visually identical)
  bridgeScroll: 900, // scroll-scrubs the 16-frame bridge clip, zooming into the dashboard
  bridgeToEndcard: 500, // bridge's last frame crossfades into the end card canvas's frame 1 (also visually identical)
  endcardScroll: 7000, // scroll-scrubs through the 244-frame end card reveal
};
export const CHAPTER_DISTANCE = Object.values(PHASES).reduce((a, b) => a + b, 0);

export function createWhyChapter({
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
}) {
  // fit:"contain" - every pixel here is meaningful UI (the dashboard's own
  // header/branding), not disposable padding like the engine renders' smoke
  // background, so nothing is ever safe to crop. Cover-fit was cropping
  // 15-20% off the top+bottom on wide viewports, slicing right through the
  // dashboard's header row. contain guarantees the whole frame is always
  // visible. backdrop:false here specifically - the end card's own frames
  // already have a designed dark background reaching their own edges, so
  // the blurred margin-fill only added a visible seam, not fill it was
  // covering for; plain black margin instead. The bridge clip keeps the
  // default blur (backdrop:true) since it doesn't have that same designed
  // edge treatment.
  const endcardRenderer = createCanvasRenderer(endcardCanvas, { fit: "contain", zoom: 1, backdrop: false });
  let currentEndcardFrame = -1;
  const bridgeRenderer = createCanvasRenderer(bridgeCanvas, { fit: "contain", zoom: 1 });
  let currentBridgeFrame = -1;

  const smokeCtx = smokeCanvas.getContext("2d", { alpha: true });
  let smokeDpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeSmokeCanvas() {
    smokeDpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    smokeCanvas.width = Math.round(w * smokeDpr);
    smokeCanvas.height = Math.round(h * smokeDpr);
    smokeCanvas.style.width = `${w}px`;
    smokeCanvas.style.height = `${h}px`;
    smokeCtx.setTransform(smokeDpr, 0, 0, smokeDpr, 0, 0);
  }
  resizeSmokeCanvas();
  window.addEventListener("resize", resizeSmokeCanvas);

  let currentSmokeFrame = -1;
  function drawSmoke(frameIdx) {
    if (frameIdx === currentSmokeFrame) return;
    currentSmokeFrame = frameIdx;
    const img = smokeImages[frameIdx];
    if (!img || !img.naturalWidth) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    smokeCtx.clearRect(0, 0, w, h);
    // smokeDpr (kept fresh by resizeSmokeCanvas's own resize listener) must
    // be passed here so this matches the SAME clamped rect actually painted
    // — omitting it was the root cause of the 100%-vs-67%-zoom misalignment
    // bug (see canvasRenderer.js's getFitRect: the native-resolution clamp
    // only engages when dpr is provided).
    const { scale, dx, dy } = getCoverRect(w, h, img.naturalWidth, img.naturalHeight, smokeDpr);
    smokeCtx.drawImage(img, dx, dy, img.naturalWidth * scale, img.naturalHeight * scale);
  }

  // --- Ambient bg1 loop: time-based (not scroll-scrubbed), so it stays
  // alive even while the user pauses to read. Ticked every animation frame
  // from scrollDriver's raf loop; only actually draws while visible. ---
  const bg1Ctx = bg1Canvas.getContext("2d", { alpha: false });
  let bg1Dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeBg1Canvas() {
    bg1Dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    bg1Canvas.width = Math.round(w * bg1Dpr);
    bg1Canvas.height = Math.round(h * bg1Dpr);
    bg1Canvas.style.width = `${w}px`;
    bg1Canvas.style.height = `${h}px`;
    bg1Ctx.setTransform(bg1Dpr, 0, 0, bg1Dpr, 0, 0);
  }
  resizeBg1Canvas();
  window.addEventListener("resize", resizeBg1Canvas);

  let bg1Visible = false;
  function tickBg1(time) {
    if (!bg1Visible) return;
    const frame = Math.floor(time / BG1_FRAME_DURATION_MS) % BG1_FRAME_COUNT;
    const img = bg1Images[frame];
    if (!img || !img.naturalWidth) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    bg1Ctx.fillStyle = "#000";
    bg1Ctx.fillRect(0, 0, w, h);
    // Same fix as drawSmoke above -- bg1Dpr must be passed so this matches
    // the actual clamped rect, not an unclamped one that only happens to
    // agree with it at low-dpr zoom levels.
    const { scale, dx, dy } = getCoverRect(w, h, img.naturalWidth, img.naturalHeight, bg1Dpr);
    bg1Ctx.drawImage(img, dx, dy, img.naturalWidth * scale, img.naturalHeight * scale);
  }

  // --- Heading box width: the 5 heading variants (What/Why/Who/Mission/
  // Wanna) share one CSS Grid cell so their crossfades never jump the
  // layout - but by default that cell auto-sizes to the WIDEST of all 5
  // ("anna look how our Dashboard looks??"), leaving short variants like
  // "ission" stranded at that oversized box's left edge, far from the M
  // glyph beside it. Fixed by continuously interpolating the box's width
  // between the outgoing/incoming variant's own widths, driven by the same
  // scroll-progress value as everything else in this file (previously this
  // snapped the width instantly the moment a transition began, which was
  // fine scrolling forward - already at the new width by the time you
  // scroll back into that phase - but visibly jumped the M sideways the
  // FIRST time you scrolled forward past each transition).
  const widthCache = new Map();
  // Clones the REAL element (not a rebuilt generic probe) so per-element CSS
  // overrides - like #why-heading-text-4's smaller font-size - are honored
  // in the measurement too. A probe that only copied the shared class
  // measured "anna look..." at the wrong (larger, default) size, leaving
  // the box wider than the text actually needs and the text off-center.
  function measureElementWidth(el) {
    const clone = el.cloneNode(true);
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    clone.style.left = "-9999px";
    clone.style.width = "auto";
    clone.style.opacity = "0";
    document.body.appendChild(clone);
    const w = clone.getBoundingClientRect().width;
    clone.remove();
    return w;
  }
  function widthOf(el) {
    if (!widthCache.has(el)) widthCache.set(el, measureElementWidth(el));
    return widthCache.get(el);
  }
  // Smoothly grows/shrinks the shared box from fromEl's width to toEl's,
  // across the same 0.4-0.62 window the crossOut/crossIn text opacities use
  // - t is the phase's own 0..1 progress (retitleT/retitle2T/etc).
  function tweenHeadingWidth(fromEl, toEl, t) {
    const p = smoothstep(0.4, 0.62, t);
    const w = widthOf(fromEl) + (widthOf(toEl) - widthOf(fromEl)) * p;
    headingTextStack.style.width = `${w}px`;
    return p;
  }

  // --- M isolation + fall/flip timeline (GSAP, driven by .progress()) ---
  // The wrap handles position + scale (top-left anchored, FLIP-style), while
  // the image inside it handles only the rotationX flip around its own
  // center — splitting these avoids the flip swinging around the wrong
  // pivot, which happens if one element tries to do both at once.
  let mIsolated = false;
  let fallTimeline = null;
  let retitleTimeline = null;
  let retitleTimeline2 = null;
  let retitleTimeline3 = null;
  let retitleTimeline4 = null;

  function buildFallTimeline() {
    gsap.set(letterMWrap, { clearProps: "transform" });
    const restRect = letterMWrap.getBoundingClientRect();

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Must match the dpr clamp #stage's own draw() uses (canvasRenderer.js)
    // -- same root-cause fix as drawSmoke/tickBg1 above, otherwise the M's
    // fall-landing target drifts from the M actually visible in the frame
    // beneath it at 100% zoom (dpr=1 engages the clamp there but not here).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { scale, dx, dy } = getCoverRect(vw, vh, SOURCE_W, SOURCE_H, dpr);
    const startX = dx + M_CROP.x * scale;
    const startY = dy + M_CROP.y * scale;
    const startW = M_CROP.w * scale;

    const deltaX = startX - restRect.left;
    const deltaY = startY - restRect.top;
    const startScale = startW / restRect.width;

    gsap.set(letterMWrap, {
      x: deltaX,
      y: deltaY,
      scale: startScale,
      transformOrigin: "top left",
    });
    gsap.set(letterM, { rotationX: 0 });

    const tl = gsap.timeline({ paused: true });
    tl.to(letterMWrap, { x: 0, y: 0, scale: 1, ease: "power2.inOut", duration: 1 }, 0);
    tl.to(letterM, { rotationX: 180, ease: "power2.inOut", duration: 1 }, 0);
    return tl;
  }

  // Spins the letter through several extra turns as a flourish that stands
  // in for the heading/description swap. degrees=1080 (a multiple of 360)
  // lands back on the same face it started on (W->W, used between
  // What/Why/Who); degrees=1260 (an odd multiple of 180) lands on the
  // OPPOSITE face instead (W->M for Who->Mission, M->W for Mission->Wanna)
  // — same physical letter image, continuously spinning the whole chapter,
  // never fading out and back in.
  function buildSpinTimeline(degrees = 1080) {
    return gsap
      .timeline({ paused: true })
      .to(letterM, { rotationX: `+=${degrees}`, ease: "power2.inOut", duration: 1 }, 0);
  }

  function isolateM() {
    if (mIsolated) return;
    mIsolated = true;
    renderer.blackoutSourceRegion(M_CROP.x, M_CROP.y, M_CROP.w, M_CROP.h);
    letterMWrap.style.opacity = "1";
    fallTimeline = buildFallTimeline();
  }

  function restoreM(lastFrameImg) {
    if (!mIsolated) return;
    mIsolated = false;
    letterMWrap.style.opacity = "0";
    gsap.set(letterMWrap, { clearProps: "transform" });
    gsap.set(letterM, { clearProps: "transform" });
    fallTimeline = null;
    retitleTimeline = null;
    retitleTimeline2 = null;
    retitleTimeline3 = null;
    retitleTimeline4 = null;
    widthCache.clear();
    renderer.draw(lastFrameImg);
  }

  window.addEventListener("resize", () => {
    widthCache.clear();
    if (mIsolated) {
      renderer.blackoutSourceRegion(M_CROP.x, M_CROP.y, M_CROP.w, M_CROP.h);
      fallTimeline = buildFallTimeline();
    }
  });

  function update(y, { lastFrameImg }) {
    const active = y > 0;

    if (!active) {
      if (mIsolated) restoreM(lastFrameImg);
      bg1Visible = false;
      bg1Canvas.style.opacity = "0";
      smokeCanvas.style.opacity = "0";
      stageWrap.style.opacity = "1";
      // welcomeEl's opacity is left to reveal.js, which runs before this and
      // owns that element while this chapter is inactive.
      headingText.style.opacity = "0";
      headingText2.style.opacity = "0";
      headingText3.style.opacity = "0";
      headingText4.style.opacity = "0";
      vmgHeading.style.opacity = "0";
      vmgPrefix.style.opacity = "0";
      vmgPrefix.style.width = "0";
      paragraph.style.opacity = "0";
      paragraph2.style.opacity = "0";
      whoContent.style.opacity = "0";
      vmgContent.style.opacity = "0";
      dashboardReveal.style.opacity = "0";
      dashboardReveal.style.transform = "translateX(-50%) translateY(14px)";
      endcardCanvas.style.opacity = "0";
      bridgeCanvas.style.opacity = "0";
      siteNav.style.opacity = "1";
      whySection.style.paddingTop = "22vh";
      return;
    }

    // Narrow the heading box to its resting (first-variant) width BEFORE
    // isolateM() ever measures the M's rest position below - otherwise, on
    // a fresh page load, that measurement happens against the box's still-
    // wide default (auto-sized to the longest of the 5 crossfading
    // variants), baking in a stale fall-in offset that visibly shifts the M
    // sideways right as it starts its fall/flip. Scrolling back doesn't
    // show this because the box is already narrowed by then.
    headingTextStack.style.width = `${widthOf(headingText)}px`;

    if (!mIsolated) isolateM();

    const clamped = Math.min(y, CHAPTER_DISTANCE);

    // --- Phase 1: smoke dissolves the AYMAR wordmark ---
    const smokeT = Math.min(clamped / PHASES.smoke, 1);
    const frame = Math.round(smokeT * (SMOKE_FRAME_COUNT - 1));
    drawSmoke(frame);

    let smokeOpacity;
    if (smokeT < 0.18) smokeOpacity = smoothstep(0, 0.18, smokeT);
    else if (smokeT < 0.5) smokeOpacity = 1;
    else smokeOpacity = 1 - smoothstep(0.5, 0.72, smokeT);
    smokeCanvas.style.opacity = String(smokeOpacity);

    const nameOpacity = 1 - smoothstep(0, 0.4, smokeT);
    stageWrap.style.opacity = String(nameOpacity);
    welcomeEl.style.opacity = String(nameOpacity);

    // --- Phase 2: M falls and flips into a W — the ambient background
    // takes over right as the fall begins. ---
    const fallStart = PHASES.smoke;
    const fallT = Math.min(Math.max((clamped - fallStart) / PHASES.fall, 0), 1);
    if (fallTimeline) fallTimeline.progress(fallT);

    bg1Visible = true;
    const bg1T = smoothstep(0, 0.5, fallT);
    bg1Canvas.style.opacity = String(bg1T * BG1_TARGET_OPACITY);

    // --- Phase 3: "hat is Aymar?" fades in beside the W ---
    const headingStart = fallStart + PHASES.fall;
    const headingT = smoothstep(0, 1, Math.min(Math.max((clamped - headingStart) / PHASES.heading, 0), 1));
    headingText.style.opacity = String(headingT);
    headingText.style.transform = `translateY(${(1 - headingT) * 14}px)`;

    // --- Phase 4: first description fades in below ---
    const paraStart = headingStart + PHASES.heading;
    const paraT = smoothstep(0, 1, Math.min(Math.max((clamped - paraStart) / PHASES.paragraph, 0), 1));
    paragraph.style.opacity = String(paraT);
    paragraph.style.transform = `translateY(${(1 - paraT) * 14}px)`;

    // --- Phase 5: description exits, W spins through several turns, then
    //              "hy AYMAR?" forms in its place ---
    const retitleStart = paraStart + PHASES.paragraph;
    if (clamped > retitleStart && !retitleTimeline) retitleTimeline = buildSpinTimeline();
    const retitleT = Math.min(Math.max((clamped - retitleStart) / PHASES.retitle, 0), 1);
    if (retitleTimeline) retitleTimeline.progress(retitleT);
    tweenHeadingWidth(headingText, headingText2, retitleT);

    const exitT = smoothstep(0, 0.35, retitleT);
    paragraph.style.opacity = String(paraT * (1 - exitT));
    paragraph.style.transform = `translateY(${-exitT * 46}px)`;

    const crossOutT = smoothstep(0.4, 0.5, retitleT);
    const crossInT = smoothstep(0.5, 0.62, retitleT);
    headingText.style.opacity = String(headingT * (1 - crossOutT));
    headingText2.style.opacity = String(crossInT);
    headingText2.style.transform = `translateY(${(1 - crossInT) * 10}px)`;

    // --- Phase 6: second description fades in below "Why AYMAR?" ---
    const para2Start = retitleStart + PHASES.retitle;
    const para2T = smoothstep(0, 1, Math.min(Math.max((clamped - para2Start) / PHASES.paragraph2, 0), 1));
    paragraph2.style.opacity = String(para2T);
    paragraph2.style.transform = `translateY(${(1 - para2T) * 14}px)`;

    // --- Phase 7: second description exits, W spins again, then
    //              "ho is AYMAR For?" forms in its place ---
    const retitle2Start = para2Start + PHASES.paragraph2;
    if (clamped > retitle2Start && !retitleTimeline2) retitleTimeline2 = buildSpinTimeline();
    const retitle2T = Math.min(Math.max((clamped - retitle2Start) / PHASES.retitle2, 0), 1);
    if (retitleTimeline2) retitleTimeline2.progress(retitle2T);
    tweenHeadingWidth(headingText2, headingText3, retitle2T);

    const exit2T = smoothstep(0, 0.35, retitle2T);
    paragraph2.style.opacity = String(para2T * (1 - exit2T));
    paragraph2.style.transform = `translateY(${-exit2T * 46}px)`;

    const crossOut2T = smoothstep(0.4, 0.5, retitle2T);
    const crossIn2T = smoothstep(0.5, 0.62, retitle2T);
    headingText2.style.opacity = String(crossInT * (1 - crossOut2T));
    headingText3.style.opacity = String(crossIn2T);
    headingText3.style.transform = `translateY(${(1 - crossIn2T) * 10}px)`;

    // --- Phase 8: audience grid fades in below "Who is AYMAR For?" ---
    const whoStart = retitle2Start + PHASES.retitle2;
    const whoT = smoothstep(0, 1, Math.min(Math.max((clamped - whoStart) / PHASES.whoContent, 0), 1));
    whoContent.style.opacity = String(whoT);
    // #who-content is horizontally centered via a CSS translateX(-50%) (it's
    // absolutely positioned so it doesn't inflate the shared stack's
    // height) — setting .style.transform here replaces that entirely, so
    // the centering has to be re-stated alongside the reveal translateY.
    whoContent.style.transform = `translateX(-50%) translateY(${(1 - whoT) * 14}px)`;

    // --- Phase 9: audience grid exits, letter spins from W all the way to
    //              M (its natural, un-rotated orientation) instead of just
    //              looping back to W - "Who is AYMAR For?" crossfades into
    //              "ission", spelling "Mission" with the same glyph ---
    const retitle3Start = whoStart + PHASES.whoContent;
    if (clamped > retitle3Start && !retitleTimeline3) retitleTimeline3 = buildSpinTimeline(1260);
    const retitle3T = Math.min(Math.max((clamped - retitle3Start) / PHASES.retitle3, 0), 1);
    if (retitleTimeline3) retitleTimeline3.progress(retitle3T);
    const vmgWidthT = tweenHeadingWidth(headingText3, vmgHeading, retitle3T);
    vmgPrefix.style.width = `${widthOf(vmgPrefix) * vmgWidthT}px`;

    const whoExitT = smoothstep(0, 0.35, retitle3T);
    whoContent.style.opacity = String(whoT * (1 - whoExitT));
    whoContent.style.transform = `translateX(-50%) translateY(${(1 - whoT) * 14 - whoExitT * 40}px)`;

    const crossOut3T = smoothstep(0.4, 0.5, retitle3T);
    const crossIn3T = smoothstep(0.5, 0.62, retitle3T);
    headingText3.style.opacity = String(crossIn2T * (1 - crossOut3T));
    vmgHeading.style.opacity = String(crossIn3T);
    vmgHeading.style.transform = `translateY(${(1 - crossIn3T) * 10}px)`;

    // --- Phase 10: Vision / Mission / Goal cards fade in below "Mission" ---
    const vmgStart = retitle3Start + PHASES.retitle3;
    const vmgT = smoothstep(0, 1, Math.min(Math.max((clamped - vmgStart) / PHASES.vmgContent, 0), 1));
    vmgContent.style.opacity = String(vmgT);
    vmgContent.style.transform = `translateX(-50%) translateY(${(1 - vmgT) * 14}px)`;

    // --- Phase 11: cards exit, letter spins from M back to W, "Mission"
    //               crossfades into "anna look how our Dashboard looks??" ---
    const retitle4Start = vmgStart + PHASES.vmgContent;
    if (clamped > retitle4Start && !retitleTimeline4) retitleTimeline4 = buildSpinTimeline(1260);
    const retitle4T = Math.min(Math.max((clamped - retitle4Start) / PHASES.retitle4, 0), 1);
    if (retitleTimeline4) retitleTimeline4.progress(retitle4T);
    tweenHeadingWidth(vmgHeading, headingText4, retitle4T);

    const vmgExitT = smoothstep(0, 0.35, retitle4T);
    vmgContent.style.opacity = String(vmgT * (1 - vmgExitT));
    vmgContent.style.transform = `translateX(-50%) translateY(${(1 - vmgT) * 14 - vmgExitT * 40}px)`;

    const crossOut4T = smoothstep(0.4, 0.5, retitle4T);
    const crossIn4T = smoothstep(0.5, 0.62, retitle4T);
    vmgHeading.style.opacity = String(crossIn3T * (1 - crossOut4T));
    headingText4.style.opacity = String(crossIn4T);
    headingText4.style.transform = `translateY(${(1 - crossIn4T) * 10}px)`;

    // "Vision, " tracks the exact same visible-fraction as "ission" itself
    // (grows in step with it during retitle3, shrinks with it during
    // retitle4) - computed once here, after both crossIn3T and crossOut4T
    // exist, rather than split across two separate assignments.
    const vmgPrefixFraction = crossIn3T * (1 - crossOut4T);
    vmgPrefix.style.opacity = String(vmgPrefixFraction);
    vmgPrefix.style.width = `${widthOf(vmgPrefix) * vmgPrefixFraction}px`;

    // --- Phase 12: dashboard screenshot fades in below the heading, same
    //               starfield background visible the whole time - no
    //               blackout, no zoom, just the same fade+slide every other
    //               content block (Who/VMG) already uses. ---
    const dashboardStart = retitle4Start + PHASES.retitle4;
    const dashboardT = smoothstep(0, 1, Math.min(Math.max((clamped - dashboardStart) / PHASES.dashboardContent, 0), 1));
    dashboardReveal.style.opacity = String(dashboardT);
    dashboardReveal.style.transform = `translateX(-50%) translateY(${(1 - dashboardT) * 14}px)`;

    // --- Phase 13: the small framed screenshot crossfades into the bridge
    //               clip's own frame 1 - drawn specifically to match the
    //               small card + "Wanna..." heading pixel-for-pixel, so this
    //               handoff is seamless. Heading/letter fade out too - no
    //               room for them once the dashboard fills the screen. ---
    const bridgeRevealStart = dashboardStart + PHASES.dashboardContent;
    const bridgeRevealT = smoothstep(
      0,
      1,
      Math.min(Math.max((clamped - bridgeRevealStart) / PHASES.dashboardToBridge, 0), 1)
    );
    headingText4.style.opacity = String(crossIn4T * (1 - bridgeRevealT));
    letterMWrap.style.opacity = String(1 - bridgeRevealT);
    dashboardReveal.style.opacity = String(dashboardT * (1 - bridgeRevealT));
    bridgeCanvas.style.opacity = String(bridgeRevealT);
    if (bridgeRevealT > 0 && bridgeState.images && currentBridgeFrame === -1) {
      currentBridgeFrame = 0;
      const firstImg = bridgeState.images[0];
      if (firstImg && firstImg.naturalWidth) bridgeRenderer.draw(firstImg);
    }

    // --- Phase 14: scroll-scrubs the 16-frame bridge clip, zooming from
    //               the small card's framing into the end card's own. ---
    const bridgeScrollStart = bridgeRevealStart + PHASES.dashboardToBridge;
    const bridgeScrollT = Math.min(Math.max((clamped - bridgeScrollStart) / PHASES.bridgeScroll, 0), 1);
    if (bridgeState.images) {
      const frame = Math.round(bridgeScrollT * (BRIDGE_FRAME_COUNT - 1));
      if (frame !== currentBridgeFrame) {
        currentBridgeFrame = frame;
        const img = bridgeState.images[frame];
        if (img && img.naturalWidth) bridgeRenderer.draw(img);
      }
    }

    // --- Phase 15: bridge's last frame crossfades into the end card
    //               canvas's own frame 1 - also drawn to match exactly. ---
    const endcardRevealStart = bridgeScrollStart + PHASES.bridgeScroll;
    const endcardRevealT = smoothstep(
      0,
      1,
      Math.min(Math.max((clamped - endcardRevealStart) / PHASES.bridgeToEndcard, 0), 1)
    );
    bridgeCanvas.style.opacity = String(bridgeRevealT * (1 - endcardRevealT));
    endcardCanvas.style.opacity = String(endcardRevealT);
    // Only the bridge clip has the real nav baked into its own frames (it
    // was captured from a recording of this site) - the main end card
    // sequence never did, so the live nav only needs to duck out of the way
    // while the bridge is actually the dominant visual (bridgeCanvas's own
    // opacity fraction, above), then fade back in as the end card takes
    // over - not stay hidden for the rest of the whole sequence.
    siteNav.style.opacity = String(1 - bridgeRevealT * (1 - endcardRevealT));
    if (endcardRevealT > 0 && endcardState.images && currentEndcardFrame === -1) {
      currentEndcardFrame = 0;
      const firstImg = endcardState.images[0];
      if (firstImg && firstImg.naturalWidth) endcardRenderer.draw(firstImg);
    }

    // --- Phase 16: scroll-scrubs through the 244-frame end card reveal
    //               (dashboard zooms out to the AYMAR mascot finale) ---
    const endcardScrollStart = endcardRevealStart + PHASES.bridgeToEndcard;
    const endcardScrollT = Math.min(Math.max((clamped - endcardScrollStart) / PHASES.endcardScroll, 0), 1);
    if (endcardState.images) {
      const frame = Math.round(endcardScrollT * (ENDCARD_FRAME_COUNT - 1));
      if (frame !== currentEndcardFrame) {
        currentEndcardFrame = frame;
        const img = endcardState.images[frame];
        if (img && img.naturalWidth) endcardRenderer.draw(img);
      }
    }

    // What/Why sit centered (22% of viewport height reads the same as true
    // vertical centering for their short content); the card-grid chapters
    // (Who Aymar For, Vision/Mission/Goal) need less top padding to give
    // their much taller content room to breathe — but never less than
    // NAV_CLEARANCE_PX, or the fixed nav bar overlaps the heading on short
    // viewports. Eases across the retitle2 spin so it never jumps, and stays
    // put through retitle3/vmg since both need the same tight layout. The
    // final Wanna/dashboard pairing eases to a middle-ground padding of its
    // own - noticeably more centered than Who/VMG's tight fit, but still
    // leaving the dashboard screenshot real room below it.
    const whoModeT = smoothstep(0, 0.3, retitle2T);
    const wannaModeT = smoothstep(0, 0.5, retitle4T);
    const vh = window.innerHeight;
    const centeredPadding = 0.22 * vh;
    const whoPadding = Math.max(0.03 * vh, NAV_CLEARANCE_PX);
    const wannaPadding = Math.max(0.12 * vh, NAV_CLEARANCE_PX);
    const paddingPx =
      centeredPadding + (whoPadding - centeredPadding) * whoModeT + (wannaPadding - whoPadding) * wannaModeT;
    whySection.style.paddingTop = `${paddingPx}px`;
  }

  return { update, tickBg1 };
}
