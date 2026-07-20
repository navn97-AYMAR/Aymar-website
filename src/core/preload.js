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
async function preloadSequence(urlFor, count, onProgress) {
  const images = new Array(count);
  let loaded = 0;

  const tasks = [];
  for (let i = 1; i <= count; i++) {
    const img = new Image();
    img.decoding = "async";
    img.src = urlFor(i);
    images[i - 1] = img;

    const task = (img.decode ? img.decode() : Promise.resolve()).catch(() => {
      // Some browsers reject decode() for edge-case images even though the
      // image is usable — fall back to a plain load-event wait.
      return new Promise((resolve) => {
        if (img.complete) return resolve();
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }).then(() => {
      loaded += 1;
      onProgress?.(loaded / count);
    });

    tasks.push(task);
  }

  await Promise.all(tasks);
  return images;
}

export function preloadFrames(onProgress) {
  return preloadSequence(
    (i) => `/frames/frame_${String(i).padStart(3, "0")}.webp`,
    FRAME_COUNT,
    onProgress
  );
}

export function preloadSmokeFrames(onProgress) {
  return preloadSequence(
    (i) => `/smoke/smoke_${String(i).padStart(3, "0")}.webp`,
    SMOKE_FRAME_COUNT,
    onProgress
  );
}

export function preloadBg1Frames(onProgress) {
  return preloadSequence(
    (i) => `/bg1/bg1_${String(i).padStart(3, "0")}.webp`,
    BG1_FRAME_COUNT,
    onProgress
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
