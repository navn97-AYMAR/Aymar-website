// Slightly under-fills the viewport instead of a strict edge-to-edge "cover"
// fit, so the whole sequence reads a touch less zoomed-in. Every consumer
// (main frame draw, smoke overlay, "Welcome to" position, the M/W landing
// spot) goes through this same function, so they all stay aligned when this
// changes. Per-instance callers can override this via createCanvasRenderer's
// `zoom` option (the engines section uses 1 - true edge-to-edge, no shrink).
const ZOOM_FACTOR = 0.92;

// How far past a strict cover-fit the blurred backdrop is scaled. Keeps the
// blur sampling safely inside the source image at every edge, so there's no
// dark/transparent fringe where the backdrop meets the canvas boundary. The
// backdrop always uses cover (never contain) regardless of the foreground's
// fit mode, since its only job is to bleed color edge-to-edge behind it.
const BACKDROP_OVERSCAN = 1.08;
const BACKDROP_BLUR_PX = 60;
const BACKDROP_DARKEN = 0.7;

// dpr/zoom are optional - existing callers (reveal.js, whyChapter.js) that
// only pass the first four args keep their current behavior untouched.
export function getCoverRect(viewportW, viewportH, imgW, imgH, dpr, zoom) {
  return getFitRect(viewportW, viewportH, imgW, imgH, "cover", dpr, zoom);
}

// Never crops any part of the frame - the whole image (engine + AYMAR
// lockup) is always visible, shrinking to fit the narrower axis instead of
// cropping the wider one. Used where cutting off part of the source frame
// is worse than showing a bit more backdrop on the sides/top/bottom.
export function getContainRect(viewportW, viewportH, imgW, imgH, dpr, zoom) {
  return getFitRect(viewportW, viewportH, imgW, imgH, "contain", dpr, zoom);
}

// Anchors on the viewport's height only, ignoring width entirely. Guarantees
// the vertical framing (e.g. designed headroom above the pistons) is never
// cropped on any screen shape - only the sides, which have padding to
// spare, ever crop (wide viewport) or show backdrop (narrow viewport).
export function getFitHeightRect(viewportW, viewportH, imgW, imgH, dpr, zoom) {
  return getFitRect(viewportW, viewportH, imgW, imgH, "height", dpr, zoom);
}

// "Cover" fit, but falls back to "contain" on a portrait viewport. Every
// piece of landscape-shaped source art here (the M-letter fall/flip target,
// the engine pistons, the "Welcome to" lockup) has fixed important content
// that a strict cover-crop would push outside the frame on a phone held
// upright (a 1920x1080 source cover-fit against a 390x844 viewport only
// shows the middle ~26% of the source's width). Falling back to contain
// there instead means nothing important ever crops off-screen - the frame
// just letterboxes (filled by the existing blurred backdrop) rather than
// cropping. createCanvasRenderer's own default "cover" fit uses this same
// rule for its draw() below, so any caller computing an OVERLAY position
// (not just drawing a frame) must go through this function too, or its
// math will disagree with what's actually on screen on a portrait phone.
export function getResponsiveCoverRect(viewportW, viewportH, imgW, imgH, dpr, zoom) {
  return viewportH > viewportW
    ? getContainRect(viewportW, viewportH, imgW, imgH, dpr, zoom)
    : getCoverRect(viewportW, viewportH, imgW, imgH, dpr, zoom);
}

function getFitRect(viewportW, viewportH, imgW, imgH, fit, dpr, zoom = ZOOM_FACTOR) {
  let base;
  if (fit === "contain") base = Math.min(viewportW / imgW, viewportH / imgH);
  else if (fit === "height") base = viewportH / imgH;
  else base = Math.max(viewportW / imgW, viewportH / imgH);
  let scale = base * zoom;

  // Never stretch the source past its own native pixel density. Past that
  // point, upscaling only blurs the frame - it doesn't show more detail -
  // so on a viewport bigger than the source (or a high-DPI screen), it's
  // better to render at native size and let the blurred backdrop fill the
  // rest, than to blow the frame up and blur it.
  if (dpr) scale = Math.min(scale, 1 / dpr);

  const drawWidth = imgW * scale;
  const drawHeight = imgH * scale;
  const dx = (viewportW - drawWidth) / 2;
  const dy = (viewportH - drawHeight) / 2;
  return { scale, dx, dy };
}

// fit: "cover" (default, fills the viewport, crops overflow), "contain"
// (always shows the whole frame uncropped, backdrop fills the rest), or
// "height" (always fills full height, never crops top/bottom, only sides).
// zoom: fraction of a strict fit to actually draw at (default ZOOM_FACTOR,
// i.e. a touch under-filled); pass 1 for a true edge-to-edge fit with no
// intentional shrink. backdrop: false disables the blurred margin-fill
// entirely (plain black margin instead) - the end card sequence turns this
// off since its own frames already have a designed dark background right
// up to the edge, so the blur added nothing but a visible seam.
export function createCanvasRenderer(canvas, { fit = "cover", zoom = ZOOM_FACTOR, backdrop = true } = {}) {
  // Resolved per-draw (not once here) so the default "cover" fit can react
  // to the CURRENT viewport shape every frame - see getResponsiveCoverRect's
  // own comment for why "cover" specifically needs this instead of a fixed
  // function reference. "contain"/"height" callers are already portrait-safe
  // (they never crop), so they stay fixed.
  function fitRect(viewportW, viewportH, imgW, imgH, dpr, zoom) {
    if (fit === "contain") return getContainRect(viewportW, viewportH, imgW, imgH, dpr, zoom);
    if (fit === "height") return getFitHeightRect(viewportW, viewportH, imgW, imgH, dpr, zoom);
    return getResponsiveCoverRect(viewportW, viewportH, imgW, imgH, dpr, zoom);
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssWidth = window.innerWidth;
  let cssHeight = window.innerHeight;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  resize();
  window.addEventListener("resize", resize);

  let lastImg = null;

  // Fills the margin left by the under-fill zoom (and, in "contain" mode,
  // the letterbox/pillarbox bars) with a blurred, full-bleed copy of the
  // same frame instead of flat black, so the edge of the canvas always
  // reads as a soft continuation of that frame's own colors. The sharp
  // foreground frame drawn afterward is untouched - only the backdrop
  // behind it changes. Harmless no-op visually when zoom=1 in cover mode,
  // since there's no margin left for it to show through.
  function drawBackdrop(img) {
    const scale = Math.max(cssWidth / img.naturalWidth, cssHeight / img.naturalHeight) * BACKDROP_OVERSCAN;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const dx = (cssWidth - w) / 2;
    const dy = (cssHeight - h) / 2;

    ctx.save();
    ctx.filter = `blur(${BACKDROP_BLUR_PX}px) brightness(${BACKDROP_DARKEN})`;
    ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();
  }

  function draw(img) {
    if (!img || !img.naturalWidth) return;
    lastImg = img;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (backdrop) drawBackdrop(img);

    const { scale, dx, dy } = fitRect(cssWidth, cssHeight, img.naturalWidth, img.naturalHeight, dpr, zoom);
    ctx.drawImage(img, dx, dy, img.naturalWidth * scale, img.naturalHeight * scale);
  }

  function redrawLast() {
    if (lastImg) draw(lastImg);
  }

  window.addEventListener("resize", redrawLast);

  // Paints over a region of the *source* image (in its own pixel space) with
  // black, at whatever screen rect that region currently maps to under the
  // fit transform. Used to erase the baked-in "M" once the separate letter
  // overlay takes over, so the two never appear stacked.
  function blackoutSourceRegion(x, y, w, h) {
    if (!lastImg) return;
    const { scale, dx, dy } = fitRect(cssWidth, cssHeight, lastImg.naturalWidth, lastImg.naturalHeight, dpr, zoom);
    ctx.fillStyle = "#000";
    ctx.fillRect(dx + x * scale, dy + y * scale, w * scale, h * scale);
  }

  return {
    draw,
    blackoutSourceRegion,
    getViewportSize: () => ({ width: cssWidth, height: cssHeight }),
  };
}
