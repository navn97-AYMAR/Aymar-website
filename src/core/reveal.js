import { getResponsiveCoverRect } from "./canvasRenderer.js";

// The corrected animation now forms the candle directly behind the AYMAR
// logo and ends with the logo already centered — no separate detach/slide
// choreography needed anymore. This just fades "Welcome to" in above it,
// positioned from the logo's actual bounding box in the source frame.
const SOURCE_W = 1620;
const SOURCE_H = 1080;
const LOGO_TOP_Y = 425; // top edge of the AYMAR wordmark in the final frame

export function createReveal({ welcomeEl }) {
  function update(progress) {
    const p = Math.min(Math.max(progress, 0), 1);
    const ease = p * p * (3 - 2 * p); // smoothstep

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Must match the SAME dpr clamp canvasRenderer.js's own draw() uses,
    // or this drifts from what's actually painted on #stage at 100% zoom
    // (dpr=1 triggers the native-resolution clamp there; this call was
    // computing the unclamped rect, only accidentally matching at zoom
    // levels where dpr stays low enough to never engage the clamp).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Responsive (not plain getCoverRect): on a portrait phone, #stage's own
    // draw() falls back to contain-fit so the AYMAR logo never crops off
    // frame - this must use the identical rule or "Welcome to" would float
    // at the position the logo WOULD be at under a strict cover-crop,
    // rather than where it actually is.
    const { scale, dy } = getResponsiveCoverRect(vw, vh, SOURCE_W, SOURCE_H, dpr);
    const logoTopScreenY = dy + LOGO_TOP_Y * scale;

    welcomeEl.style.opacity = String(ease);
    welcomeEl.style.transform = `translate(-50%, ${logoTopScreenY - 64 + (1 - ease) * 16}px)`;
  }

  return { update };
}
