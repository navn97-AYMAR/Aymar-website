import { getCoverRect } from "./canvasRenderer.js";

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
    const { scale, dy } = getCoverRect(vw, vh, SOURCE_W, SOURCE_H);
    const logoTopScreenY = dy + LOGO_TOP_Y * scale;

    welcomeEl.style.opacity = String(ease);
    welcomeEl.style.transform = `translate(-50%, ${logoTopScreenY - 64 + (1 - ease) * 16}px)`;
  }

  return { update };
}
