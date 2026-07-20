import { initLiveData } from "./liveData.js";

// The built scroll experience (frame sequence, smoke, bg1 loop, the three
// Why-Aymar chapters, and the spacer that drives it all) lives under "About".
// "Engines" is its own separate scroll-jacked sequence (own canvas, own
// spacer, own Lenis instance, lazy-loaded on first visit). Every other nav
// item swaps both out for a simple static view — no scroll hijacking there.
const ABOUT_SELECTORS = [
  "#stage-wrap",
  "#welcome-text",
  "#smoke-canvas",
  "#bg1-canvas",
  "#why-section",
  "#scroll-spacer",
  "#endcard-bridge-canvas",
  "#endcard-canvas",
];

export function initNav({ lenis, enginesView }) {
  const links = Array.from(document.querySelectorAll(".site-nav-link"));
  const aboutEls = ABOUT_SELECTORS.map((s) => document.querySelector(s)).filter(Boolean);
  const homeEl = document.getElementById("view-home");
  const placeholderEl = document.getElementById("view-placeholder");
  const placeholderTitle = placeholderEl.querySelector(".view-placeholder-title");
  const livedataEl = document.getElementById("view-livedata");
  const roadmapEl = document.getElementById("view-roadmap");
  const contactEl = document.getElementById("view-contact");
  const backtestsEl = document.getElementById("view-backtests");
  const privacyEl = document.getElementById("view-privacy");
  const termsEl = document.getElementById("view-terms");
  const riskEl = document.getElementById("view-risk");
  const disclaimerEl = document.getElementById("view-disclaimer");
  const refundEl = document.getElementById("view-refund");
  const liveData = initLiveData(livedataEl, () => requestAnimationFrame(syncTradebookHeight));

  function setView(view, label) {
    const showAbout = view === "about";
    aboutEls.forEach((el) => {
      el.style.display = showAbout ? "" : "none";
    });
    homeEl.style.display = view === "home" ? "flex" : "none";
    placeholderEl.style.display = view === "placeholder" ? "flex" : "none";
    livedataEl.style.display = view === "livedata" ? "flex" : "none";
    roadmapEl.style.display = view === "roadmap" ? "flex" : "none";
    contactEl.style.display = view === "contact" ? "block" : "none";
    backtestsEl.style.display = view === "backtests" ? "block" : "none";
    privacyEl.style.display = view === "privacy" ? "block" : "none";
    termsEl.style.display = view === "terms" ? "block" : "none";
    riskEl.style.display = view === "risk" ? "block" : "none";
    disclaimerEl.style.display = view === "disclaimer" ? "block" : "none";
    refundEl.style.display = view === "refund" ? "block" : "none";
    if (view === "placeholder" && label) placeholderTitle.textContent = label;

    if (showAbout) {
      lenis?.start();
    } else {
      lenis?.stop();
    }

    if (view === "engines") {
      enginesView?.activate();
    } else {
      enginesView?.deactivate();
    }

    // The onRendered callback passed to initLiveData() re-syncs the trade
    // book's height once real data actually paints (both here and on
    // Apply) - trade count varies per tier, so a fixed delay can't
    // substitute for waiting on the real async render to finish.
    if (view === "livedata") liveData.render();

    window.scrollTo(0, 0);
    lenis?.resize();

    links.forEach((l) => {
      const isMatch = l.dataset.view === view && (view !== "placeholder" || l.textContent === label);
      l.classList.toggle("is-active", isMatch);
    });
  }

  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setView(link.dataset.view, link.textContent);
      closeMobileMenu();
    });
  });

  // One-off links that live outside the top nav (footer, terms checkbox,
  // the legal page's own "Back to Home") but still need to switch views -
  // same click behavior as .site-nav-link, just not rendered in the nav bar.
  document.querySelectorAll(".legal-nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setView(link.dataset.view, link.textContent);
      closeMobileMenu();
    });
  });

  setView("about", "About");
  initHomeForm(homeEl);
  initMobileMenu();
  initNativeScrollFix([homeEl, livedataEl, contactEl, backtestsEl, privacyEl, termsEl, riskEl, disclaimerEl, refundEl]);
  initFxDropdowns(livedataEl);

  window.addEventListener("resize", () => {
    if (livedataEl.style.display !== "none") syncTradebookHeight();
  });
}

// The Today and Performance Summary cards sit side by side with
// align-items:stretch so they always match height - but that only works for
// their OWN content. The trade book's flex-grow means a long trade list
// would otherwise pull both cards taller together instead of stopping at
// Performance's (calendar-driven) height and scrolling internally, since
// flexbox stretch settles on whichever card's natural content is tallest,
// not a fixed target. Measuring it directly is the only way to actually cap
// it: collapse the trade book to 0, read how tall the row settles at
// (Performance's height, since it's normally the taller one), then give the
// trade book exactly the leftover room inside Today's card.
function syncTradebookHeight() {
  const todayCard = document.querySelector(".ld2-card");
  const tradebook = todayCard?.querySelector(".ld2-tradebook");
  const scrollBox = todayCard?.querySelector(".ld2-tradebook-scroll");
  if (!todayCard || !tradebook || !scrollBox) return;

  scrollBox.style.maxHeight = "0px";
  const cardRect = todayCard.getBoundingClientRect();
  const tradebookRect = tradebook.getBoundingClientRect();
  const paddingBottom = parseFloat(getComputedStyle(todayCard).paddingBottom) || 0;
  const available = cardRect.bottom - paddingBottom - tradebookRect.top;
  scrollBox.style.maxHeight = `${Math.max(60, available)}px`;
}

// Lenis (used for the About page's cinematic scroll) binds its wheel
// listener to the window and calls preventDefault on every wheel event to
// drive its own virtual scroll - lenis.stop() pauses its updates but does
// NOT unbind that listener, so it silently swallows wheel events meant for
// any other view's native overflow:auto scrolling (Home's mobile-stacked
// layout, the Live Data dashboard). Intercepting in the capture phase (which
// runs before Lenis's own bubble-phase listener) lets us manually scroll the
// active view and stop the event before Lenis ever sees it.
//
// Nested scroll regions (the trade book, and every investment-projector
// dropdown's option list - Month's 12 entries and Year's 10 can both
// overflow their max-height on shorter screens too, not just Investment
// Amount) need the normal "scroll the inner box first, only bubble to the
// outer page once the inner box hits its own top/bottom" behavior - the
// naive version above always won regardless of pointer position, so
// hovering these scrolled the whole page instead of the box underneath
// the cursor.
const NESTED_SCROLL_SELECTOR = ".ld2-tradebook-scroll, .ld2-fx-options";

function initNativeScrollFix(scrollEls) {
  window.addEventListener(
    "wheel",
    (e) => {
      const target = scrollEls.find((el) => el && getComputedStyle(el).display !== "none");
      if (!target) return;

      const inner = e.target.closest(NESTED_SCROLL_SELECTOR);
      if (inner) {
        const goingDown = e.deltaY > 0;
        const canScrollDown = inner.scrollTop + inner.clientHeight < inner.scrollHeight - 1;
        const canScrollUp = inner.scrollTop > 0;
        if ((goingDown && canScrollDown) || (!goingDown && canScrollUp)) {
          inner.scrollTop += e.deltaY;
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }

      target.scrollTop += e.deltaY;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true, passive: false }
  );
}

// Custom dropdowns for the Live Data "investment projector" bar - plain
// <select> elements can't be styled to match the reference's glowing gold
// option list, so each field is a button + an absolutely-positioned option
// list toggled via a class, closing on outside click or after a selection.
function initFxDropdowns(livedataEl) {
  const fields = Array.from(livedataEl.querySelectorAll(".ld2-fx-field"));

  fields.forEach((field) => {
    const button = field.querySelector(".ld2-fx-select");
    const valueEl = field.querySelector(".ld2-fx-value");
    const options = Array.from(field.querySelectorAll(".ld2-fx-option"));

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !field.classList.contains("is-open");
      fields.forEach((f) => f.classList.remove("is-open"));
      field.classList.toggle("is-open", willOpen);
    });

    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        options.forEach((o) => o.classList.remove("is-selected"));
        opt.classList.add("is-selected");
        valueEl.textContent = opt.dataset.value;
        field.classList.remove("is-open");
      });
    });
  });

  document.addEventListener("click", () => {
    fields.forEach((f) => f.classList.remove("is-open"));
  });
}

// Collapses the nav links into a hamburger-triggered dropdown below 880px,
// so narrow windows get a single-line nav instead of wrapped links eating
// into the viewport (that wrapping was the root cause of the Home page's
// signup card overlapping the nav at narrow widths).
function initMobileMenu() {
  const nav = document.getElementById("site-nav");
  const toggle = document.getElementById("site-nav-toggle");

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}

function closeMobileMenu() {
  const nav = document.getElementById("site-nav");
  const toggle = document.getElementById("site-nav-toggle");
  nav.classList.remove("menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

// Toggles each password field's visibility independently and prevents the
// signup form from attempting a real navigation, since there's no backend
// wired up yet - this is a design-only form for now.
const REGISTER_TITLE = "CREATE YOUR ACCOUNT";
const REGISTER_SUB = "Join AYMAR and experience next-gen trading technology.";
const LOGIN_TITLE = "WELCOME BACK";
const LOGIN_SUB = "Login to your AYMAR account.";

function initHomeForm(homeEl) {
  homeEl.querySelectorAll(".home-eye").forEach((btn) => {
    const input = btn.previousElementSibling;
    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });

  const titleEl = homeEl.querySelector("#home-signup-title");
  const subEl = homeEl.querySelector("#home-signup-sub");

  const form = homeEl.querySelector("#home-signup-form");
  const fields = homeEl.querySelector("#home-signup-fields");
  const success = homeEl.querySelector("#home-signup-success");

  const loginBtn = homeEl.querySelector("#home-signup-login-btn");
  const loginForm = homeEl.querySelector("#home-login-form");
  const loginToRegister = homeEl.querySelector("#home-login-to-register");
  const loginSuccess = homeEl.querySelector("#home-login-success");
  const loginUsername = homeEl.querySelector("#home-login-username");
  const successBack = homeEl.querySelector("#home-success-back");
  const loginSuccessBack = homeEl.querySelector("#home-login-success-back");

  // Only one of these four blocks is ever visible at a time - switching
  // between them also resets whichever form was left mid-submission
  // (fields cleared via form.reset(), not just hidden), so registering a
  // second person on the same device starts from a genuinely blank form
  // instead of showing the previous person's details.
  function showRegisterForm() {
    form.reset();
    form.hidden = false;
    fields.hidden = false;
    success.hidden = true;
    loginForm.hidden = true;
    loginSuccess.hidden = true;
    titleEl.textContent = REGISTER_TITLE;
    subEl.textContent = REGISTER_SUB;
  }

  function showLoginForm() {
    loginForm.reset();
    form.hidden = true;
    loginForm.hidden = false;
    success.hidden = true;
    loginSuccess.hidden = true;
    titleEl.textContent = LOGIN_TITLE;
    subEl.textContent = LOGIN_SUB;
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    fields.hidden = true;
    success.hidden = false;
  });

  loginBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    showLoginForm();
  });

  loginToRegister?.addEventListener("click", (e) => {
    e.preventDefault();
    showRegisterForm();
  });

  loginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = loginForm.querySelector('input[type="text"]')?.value.trim();
    loginUsername.textContent = username || "trader";
    loginForm.hidden = true;
    loginSuccess.hidden = false;
  });

  // Lets a visitor register a second (or third...) person on the same
  // device instead of being stuck on the success screen - each back link
  // returns to the form it came from, reset and ready for fresh input.
  successBack?.addEventListener("click", (e) => {
    e.preventDefault();
    showRegisterForm();
  });

  loginSuccessBack?.addEventListener("click", (e) => {
    e.preventDefault();
    showLoginForm();
  });
}
