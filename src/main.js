import "./style.css";
import {
  FRAME_COUNT,
  SMOKE_FRAME_COUNT,
  BG1_FRAME_COUNT,
  preloadFrames,
  preloadSmokeFrames,
  preloadBg1Frames,
  preloadEndcardFrames,
  preloadBridgeFrames,
} from "./core/preload.js";
import { createCanvasRenderer } from "./core/canvasRenderer.js";
import { createScrollDriver } from "./core/scrollDriver.js";
import { initLoader } from "./core/loader.js";
import { initNav } from "./core/nav.js";
import { createEnginesView } from "./core/enginesView.js";

const canvas = document.getElementById("stage");
const renderer = createCanvasRenderer(canvas);
const loader = initLoader();

const progressWeights = { main: FRAME_COUNT, smoke: SMOKE_FRAME_COUNT, bg1: BG1_FRAME_COUNT };
const totalWeight = progressWeights.main + progressWeights.smoke + progressWeights.bg1;

// Each preloader reports its own 0..1; blend by frame-count weight so the
// bar reflects actual bytes/frames remaining rather than treating every
// sequence as equally sized.
function combinedProgress(mainProgress, smokeProgress, bg1Progress) {
  return (
    (mainProgress * progressWeights.main +
      smokeProgress * progressWeights.smoke +
      bg1Progress * progressWeights.bg1) /
    totalWeight
  );
}

let mainP = 0;
let smokeP = 0;
let bg1P = 0;

Promise.all([
  preloadFrames((p) => {
    mainP = p;
    loader.setProgress(combinedProgress(mainP, smokeP, bg1P));
  }),
  preloadSmokeFrames((p) => {
    smokeP = p;
    loader.setProgress(combinedProgress(mainP, smokeP, bg1P));
  }),
  preloadBg1Frames((p) => {
    bg1P = p;
    loader.setProgress(combinedProgress(mainP, smokeP, bg1P));
  }),
]).then(([images, smokeImages, bg1Images]) => {
  renderer.draw(images[0]);

  // The end card sequence (244 frames) is the very last thing in the About
  // scroll, well after What/Why/Who/Mission/Wanna - loaded in the
  // background, not part of the main Promise.all above, so it never delays
  // first paint. By the time a visitor scrolls that far, it's had the
  // entire rest of the chapter's worth of scrolling to finish loading.
  // endcardState is a mutable box (not a promise) because whyChapter reads
  // .images fresh on every scroll tick, well before this resolves.
  const endcardState = { images: null };
  preloadEndcardFrames().then((imgs) => {
    endcardState.images = imgs;
  });

  // Tiny 16-frame bridge clip connecting the small dashboard card to the end
  // card sequence's own frame 1 - loads fast, but still backgrounded for
  // consistency with the other lazy sequences.
  const bridgeState = { images: null };
  preloadBridgeFrames().then((imgs) => {
    bridgeState.images = imgs;
  });

  const { lenis } = createScrollDriver({ images, renderer, smokeImages, bg1Images, endcardState, bridgeState });
  const enginesView = createEnginesView();
  initNav({ lenis, enginesView });
  loader.hide();
});
