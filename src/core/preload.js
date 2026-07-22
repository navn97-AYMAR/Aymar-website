export const FRAME_COUNT = 269;
export const SMOKE_FRAME_COUNT = 135;
export const BG1_FRAME_COUNT = 274;
export const ENGINE_FRAME_COUNT = 689;
export const ENDCARD_FRAME_COUNT = 244;
// Short bridge clip: frame 1 matches the small dashboard card + "Wanna..."
// heading exactly, frame 16 matches the main end card sequence's own frame
// 1 exactly - it exists purely to connect those two other sequences smoothly.
export const BRIDGE_FRAME_COUNT = 16;

/**
 * Preloads a numbered image sequence and waits for the browser to fully
 * decode every frame (via HTMLImageElement.decode()) before resolving, so
 * scrubbing never stalls on a mid-scroll decode. onProgress receives 0..1
 * for this sequence alone — combine multiple calls upstream if needed.
 */
// blockUntil: how many of this sequence's frames the CALLER waits on before
// getting the `images` array back. Every frame's Image()/fetch is still
// kicked off immediately either way (the for-loop below never waits) -- this
// only controls how much of that work the caller blocks on. Real visitors
// (unlike localhost) pay real per-request latency across all `count`
// frames, so blocking on the whole sequence before first paint made the
// site feel like it hung; blocking on just the first frame instead lets the
// page render immediately while the rest stream in in the background as the
// visitor scrolls. canvasRenderer's own draw() already no-ops safely on an
// image that hasn't finished loading yet (keeps showing the last drawn
// frame), so there's nothing else to guard here.
async function preloadSequence(urlFor, count, onProgress, blockUntil = count) {
  const images = new Array(count);
  let blockLoaded = 0;

  const tasks = [];
  for (let i = 1; i <= count; i++) {
    const img = new Image();
    img.decoding = "async";
    img.src = urlFor(i);
    images[i - 1] = img;

    const isBlocking = i <= blockUntil;
    const task = (img.decode ? img.decode() : Promise.resolve()).catch(() => {
      // Some browsers reject decode() for edge-case images even though the
      // image is usable — fall back to a plain load-event wait.
      return new Promise((resolve) => {
        if (img.complete) return resolve();
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }).then(() => {
      // Only the blocking subset reports progress -- once the caller's
      // Promise.all below resolves and the loader hides, the remaining
      // background frames finishing shouldn't keep nudging a progress bar
      // that's no longer shown (that was making the bar look like it kept
      // climbing well past when the page had already become interactive).
      if (isBlocking) {
        blockLoaded += 1;
        onProgress?.(blockLoaded / blockUntil);
      }
    });

    tasks.push(task);
  }

  await Promise.all(tasks.slice(0, blockUntil));
  return images;
}

// These three feed the FIRST thing a visitor sees, so each only blocks on
// its own frame 1 -- the remaining 268/134/273 frames keep loading in the
// background (see preloadSequence's own comment for why).
export function preloadFrames(onProgress) {
  return preloadSequence(
    (i) => `/frames/frame_${String(i).padStart(3, "0")}.webp`,
    FRAME_COUNT,
    onProgress,
    1
  );
}

export function preloadSmokeFrames(onProgress) {
  return preloadSequence(
    (i) => `/smoke/smoke_${String(i).padStart(3, "0")}.webp`,
    SMOKE_FRAME_COUNT,
    onProgress,
    1
  );
}

export function preloadBg1Frames(onProgress) {
  return preloadSequence(
    (i) => `/bg1/bg1_${String(i).padStart(3, "0")}.webp`,
    BG1_FRAME_COUNT,
    onProgress,
    1
  );
}

export function preloadEngineFrames(onProgress) {
  return preloadSequence(
    (i) => `/engines/engine_${String(i).padStart(3, "0")}.webp`,
    ENGINE_FRAME_COUNT,
    onProgress
  );
}

export function preloadEndcardFrames(onProgress) {
  return preloadSequence(
    (i) => `/endcard/endcard_${String(i).padStart(3, "0")}.webp`,
    ENDCARD_FRAME_COUNT,
    onProgress
  );
}

export function preloadBridgeFrames(onProgress) {
  return preloadSequence(
    (i) => `/endcard-bridge/bridge_${String(i).padStart(3, "0")}.webp`,
    BRIDGE_FRAME_COUNT,
    onProgress
  );
}
