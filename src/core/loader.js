export function initLoader() {
  const screen = document.getElementById("loading-screen");
  const fill = screen.querySelector(".loader-fill");
  const pct = screen.querySelector(".loader-pct");

  document.body.style.overflow = "hidden";

  function setProgress(p) {
    const pctValue = Math.round(p * 100);
    fill.style.width = `${pctValue}%`;
    pct.textContent = `${pctValue}%`;
  }

  function hide() {
    screen.classList.add("is-hidden");
    document.body.style.overflow = "";
  }

  return { setProgress, hide };
}
