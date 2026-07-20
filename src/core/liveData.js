// Wires the Live Data page to the daily ORION WEB snapshot
// (public/data/orionweb-daily.json), synced once per trading day by
// research/orion_web/export_website_snapshot.py in the AYMAR app repo (via a
// Mon-Fri-only Windows Scheduled Task - see aymar_website_deployment memory
// for the cross-repo context). Investment Amount picks one of 11 real
// capital tiers. Month/Year genuinely filter the Performance Summary card
// and calendar to that specific month (via computeMonthStats below) - but
// the export itself only ever populates the current trading month's data,
// so any other month correctly renders as all-zero/empty rather than
// showing real numbers, until the export starts backfilling history.

const SNAPSHOT_URL = "/data/orionweb-daily.json";

let snapshotPromise = null;

function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return snapshotPromise;
}

function fmtMoney(n) {
  const rounded = Math.round(n || 0);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(rounded).toLocaleString("en-IN")}`;
}

function selectedTierCode(livedataEl) {
  const opt = livedataEl.querySelector('.ld2-fx-field[data-field="amount"] .ld2-fx-option.is-selected');
  return opt?.dataset.tier || "T1L";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The calendar has no Month/Year controls of its own - it reads the same
// investment-projector dropdowns at the top of the page (data-field="month"
// / "year") so there's one selector driving both, not two that could
// disagree. Falls back to the snapshot's own market_date if the bar hasn't
// rendered yet.
function selectedMonthYear(livedataEl, fallbackMarketDate) {
  const monthOpt = livedataEl.querySelector('.ld2-fx-field[data-field="month"] .ld2-fx-option.is-selected');
  const yearOpt = livedataEl.querySelector('.ld2-fx-field[data-field="year"] .ld2-fx-option.is-selected');
  const monthIdx = MONTH_NAMES.indexOf(monthOpt?.dataset.value);
  const year = parseInt(yearOpt?.dataset.value, 10);
  if (monthIdx >= 0 && !Number.isNaN(year)) return { year, month: monthIdx + 1 };

  const [fy, fm] = fallbackMarketDate.split("-").map(Number);
  return { year: fy, month: fm };
}

function renderToday(livedataEl, tier) {
  const today = tier.today;
  const pnlEl = livedataEl.querySelector("#ld2-today-pnl");
  pnlEl.textContent = fmtMoney(today.total_pnl);
  pnlEl.classList.toggle("ld2-green", today.total_pnl >= 0);
  pnlEl.classList.toggle("ld2-red", today.total_pnl < 0);

  livedataEl.querySelector("#ld2-today-winrate").textContent = `${today.win_rate}%`;
  livedataEl.querySelector("#ld2-today-trades").textContent = today.total_trades;

  const statusEl = livedataEl.querySelector("#ld2-today-status");
  const status = today.total_pnl > 0 ? "PROFIT" : today.total_pnl < 0 ? "LOSS" : "FLAT";
  statusEl.textContent = status;
  statusEl.classList.toggle("ld2-green", today.total_pnl > 0);
  statusEl.classList.toggle("ld2-red", today.total_pnl < 0);

  livedataEl.querySelector("#ld2-today-capital").textContent = fmtMoney(tier.capital);

  const chartMsg = livedataEl.querySelector("#ld2-today-chart-msg");
  chartMsg.textContent =
    today.total_trades > 0
      ? `${today.total_trades} trade${today.total_trades === 1 ? "" : "s"} today - ${fmtMoney(today.total_pnl)}`
      : "No trading days in this range yet.";
}

function renderTradeBook(livedataEl, tradeBook) {
  const tbody = livedataEl.querySelector("#ld2-tradebook-body");
  if (!tradeBook || tradeBook.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="ld2-tradebook-empty">No trades in this range.</td></tr>';
    return;
  }
  tbody.innerHTML = tradeBook
    .map((t, i) => {
      const pnlClass = t.pnl >= 0 ? "ld2-green" : "ld2-red";
      return `<tr>
        <td>${i + 1}</td>
        <td>${t.date}</td>
        <td>${t.time}</td>
        <td>${t.symbol}</td>
        <td>${t.entry}</td>
        <td>${t.exit}</td>
        <td class="${pnlClass}">${fmtMoney(t.pnl)}</td>
        <td>${t.qty}</td>
      </tr>`;
    })
    .join("");
}

const RING_RADIUS = 82;
const RING_CENTER = 110;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Sweep=1 (clockwise) arc from `startAngle` to `endAngle` (0deg = 12
// o'clock) - traces a path for the moving shine dots, same clockwise-from-
// top convention the rotated stroke-dasharray rings use. Mirrors
// ProgressRing.jsx's describeShinePath exactly.
function describeShinePath(startAngleDeg, endAngleDeg) {
  if (endAngleDeg <= startAngleDeg) {
    const p = polarToCartesian(RING_CENTER, RING_CENTER, RING_RADIUS, startAngleDeg);
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
  }
  const start = polarToCartesian(RING_CENTER, RING_CENTER, RING_RADIUS, startAngleDeg);
  const end = polarToCartesian(RING_CENTER, RING_CENTER, RING_RADIUS, endAngleDeg);
  const largeArcFlag = endAngleDeg - startAngleDeg <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${RING_RADIUS} ${RING_RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

// Largest peak-to-trough dip in the cumulative P&L curve built by walking
// `dailySeries` in order - the standard "max drawdown" definition, same one
// the app's own equity-curve reporting uses (see aymar_reporting_style
// memory: always paired as % and Rs together).
function computeMaxDrawdown(dailySeries, capital) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  (dailySeries || []).forEach((d) => {
    cumulative += d.pnl || 0;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });
  const pct = capital > 0 ? (maxDrawdown / capital) * 100 : 0;
  return { amount: maxDrawdown, pct };
}

function renderPerformance(livedataEl, tier, stats, filteredDailySeries) {
  const pnlEl = livedataEl.querySelector("#ld2-perf-pnl");
  pnlEl.textContent = fmtMoney(stats.total_pnl);
  pnlEl.classList.toggle("ld2-green", stats.total_pnl >= 0);
  pnlEl.classList.toggle("ld2-red", stats.total_pnl < 0);

  livedataEl.querySelector("#ld2-perf-trades").textContent = stats.total_trades;
  livedataEl.querySelector("#ld2-perf-winrate").textContent = `${stats.win_rate}%`;
  livedataEl.querySelector("#ld2-ring-num").textContent = stats.wins;
  livedataEl.querySelector("#ld2-ring-wins").textContent = `${stats.wins} WINS`;
  livedataEl.querySelector("#ld2-ring-losses").textContent = `${stats.losses} LOSSES`;

  const pf = stats.total_loss > 0 ? stats.total_profit / stats.total_loss : null;
  livedataEl.querySelector("#ld2-perf-pf").textContent = pf != null ? pf.toFixed(2) : "--";

  const dd = computeMaxDrawdown(filteredDailySeries, tier.capital);
  livedataEl.querySelector("#ld2-perf-drawdown").textContent = `${fmtMoney(dd.amount)} (${dd.pct.toFixed(2)}%)`;

  const total = stats.wins + stats.losses;
  const hasData = total > 0;
  const winPercent = hasData ? (stats.wins / total) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, winPercent));
  const targetGreenOffset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  const targetRedOffset = hasData ? 0 : RING_CIRCUMFERENCE;

  const green = livedataEl.querySelector("#ld2-ring-green");
  const greenBloom = livedataEl.querySelector("#ld2-ring-greenbloom");
  const red = livedataEl.querySelector("#ld2-ring-red");
  const redBloom = livedataEl.querySelector("#ld2-ring-redbloom");
  const gloss = livedataEl.querySelector("#ld2-ring-gloss");
  const shineA = livedataEl.querySelector("#ld2-ring-shine-a");
  const shineB = livedataEl.querySelector("#ld2-ring-shine-b");

  // Snap both rings back to fully-empty (no transition) first, then let the
  // CSS stroke-dashoffset transition animate them out to their real target
  // on the next frame - same "animate in from empty" entrance ProgressRing
  // does on mount, so switching tiers re-plays the reveal instead of
  // jump-cutting straight to the new values.
  [green, greenBloom, red, redBloom].forEach((el) => {
    el.style.transition = "none";
    el.setAttribute("stroke-dashoffset", `${RING_CIRCUMFERENCE}`);
  });
  // Force layout so the "none" transition + full-offset actually commits
  // before we restore the transition and set the real target.
  void green.getBoundingClientRect();

  requestAnimationFrame(() => {
    [green, greenBloom, red, redBloom].forEach((el) => {
      el.style.transition = "";
    });
    green.setAttribute("stroke-dashoffset", `${targetGreenOffset}`);
    greenBloom.setAttribute("stroke-dashoffset", `${targetGreenOffset}`);
    red.setAttribute("stroke-dashoffset", `${targetRedOffset}`);
    redBloom.setAttribute("stroke-dashoffset", `${targetRedOffset}`);
  });

  gloss.style.display = hasData ? "" : "none";

  // Shine dots travel the green arc then the red arc, same split point.
  shineA.style.display = hasData && clamped > 0 ? "" : "none";
  shineB.style.display = hasData && clamped < 100 ? "" : "none";
  shineA.innerHTML = "";
  shineB.innerHTML = "";
  if (hasData && clamped > 0) {
    const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateMotion");
    anim.setAttribute("dur", "7s");
    anim.setAttribute("repeatCount", "indefinite");
    anim.setAttribute("path", describeShinePath(0, clamped * 3.6));
    shineA.appendChild(anim);
  }
  if (hasData && clamped < 100) {
    const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateMotion");
    anim.setAttribute("dur", "7s");
    anim.setAttribute("repeatCount", "indefinite");
    anim.setAttribute("path", describeShinePath(clamped * 3.6, 360));
    shineB.appendChild(anim);
  }
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// tier.month/tier.today are always the export's "current month"/"today"
// aggregates - correct when the selected Month/Year in the dropdown happens
// to match, but wrong (silently reused) for any other month, which is what
// made picking August show July's totals under an August-shaped calendar.
// Deriving every figure (Performance Summary card AND calendar footer)
// straight from dailySeries/tradeBook, filtered to the selected month,
// naturally yields zero for months with no data instead of a mislabeled
// copy of the current month's numbers.
function computeMonthStats(dailySeries, tradeBook, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = (dailySeries || []).filter((d) => d.date.startsWith(prefix));
  const trades = (tradeBook || []).filter((t) => t.date.startsWith(prefix));
  const total_profit = days.filter((d) => d.pnl > 0).reduce((s, d) => s + d.pnl, 0);
  const total_loss = -days.filter((d) => d.pnl < 0).reduce((s, d) => s + d.pnl, 0);
  const total_pnl = days.reduce((s, d) => s + d.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const total_trades = trades.length;
  const win_rate = total_trades > 0 ? Math.round((wins / total_trades) * 10000) / 100 : 0;
  return { days, total_profit, total_loss, total_pnl, total_trades, wins, losses, win_rate };
}

function renderCalendar(livedataEl, year, month, dailySeries, monthStats) {
  livedataEl.querySelector("#ld2-cal-month").textContent = `${MONTH_NAMES[month - 1]} ${year}`;

  const pnlByDate = {};
  (dailySeries || []).forEach((d) => {
    pnlByDate[d.date] = d.pnl;
  });

  const total = daysInMonth(year, month);
  const cells = [];
  let week = 0;
  let prevWeekday = null;
  for (let day = 1; day <= total; day++) {
    const jsWeekday = new Date(year, month - 1, day).getDay(); // 0 Sun .. 6 Sat
    if (jsWeekday === 0 || jsWeekday === 6) continue;
    const weekdayIdx = jsWeekday - 1; // Mon=0 .. Fri=4
    if (prevWeekday !== null && weekdayIdx <= prevWeekday) week += 1;
    prevWeekday = weekdayIdx;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, weekdayIdx, week, dateStr, pnl: pnlByDate[dateStr] });
  }
  const weekCount = week + 1;
  const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.pnl || 0)));

  // Same dip-then-rise/rise-then-dip Catmull-Rom squiggle MiniSparkline uses
  // in the real app's "enhanced" calendar - a single traded day has no
  // sub-points to plot, so this is a decorative rhythm, not real intraday
  // data, matching that component's own comment.
  const SPARK_UP = "M 7,32 C 12,30.2 27,22.2 37,21 C 47,19.8 57,27.5 67,25 C 77,22.5 92,9.2 97,6";
  const SPARK_DOWN = "M 7,6 C 12,7.8 27,15.8 37,17 C 47,18.2 57,10.5 67,13 C 77,15.5 92,28.8 97,32";
  const ARROW_UP_RIGHT = '<path d="M7 17 17 7" /><path d="M7 7h10v10" />';
  const ARROW_DOWN_RIGHT = '<path d="m7 7 10 10" /><path d="M17 7v10H7" />';

  const grid = livedataEl.querySelector("#ld2-cal-grid");
  grid.style.gridTemplateColumns = `repeat(${weekCount}, 1fr)`;
  grid.innerHTML = cells
    .map((c) => {
      const hasTrade = c.pnl != null && c.pnl !== 0;
      const cls = hasTrade ? (c.pnl > 0 ? "ld2-cal-profit" : "ld2-cal-loss") : "";
      let style = `grid-column:${c.week + 1};grid-row:${c.weekdayIdx + 1};`;
      let extra = "";
      if (hasTrade) {
        const isProfit = c.pnl > 0;
        const color = isProfit ? "#22c55e" : "#ef4444";
        const darkIntensity = (0.45 + 0.45 * (Math.abs(c.pnl) / maxAbs)).toFixed(2);
        const bg = isProfit ? `rgba(20,83,45,${darkIntensity})` : `rgba(127,29,29,${darkIntensity})`;
        style += `background:${bg};border-color:${color}59;`;
        extra = `
          <div class="ld2-cal-badge" style="background:${color}33;color:${color};">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isProfit ? ARROW_UP_RIGHT : ARROW_DOWN_RIGHT}</svg>
          </div>
          <svg class="ld2-cal-spark" viewBox="0 0 100 36" preserveAspectRatio="none">
            <path d="${isProfit ? SPARK_UP : SPARK_DOWN}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" vector-effect="non-scaling-stroke" />
            <circle r="2" fill="white" opacity="0.95">
              <animateMotion dur="7s" repeatCount="indefinite" path="${isProfit ? SPARK_UP : SPARK_DOWN}" />
            </circle>
          </svg>`;
      }
      const pnlHtml = hasTrade
        ? `<span class="ld2-cal-pl">${c.pnl > 0 ? "+" : ""}${Math.round(c.pnl).toLocaleString("en-IN")}</span>`
        : "";
      return `<div class="ld2-cal-cell ${cls}" style="${style}">
        <span class="ld2-cal-daynum">${c.day}</span>${pnlHtml}${extra}
      </div>`;
    })
    .join("");

  livedataEl.querySelector("#ld2-cal-profit").textContent = fmtMoney(monthStats.total_profit);
  livedataEl.querySelector("#ld2-cal-loss").textContent = fmtMoney(monthStats.total_loss);
  livedataEl.querySelector("#ld2-cal-trades").textContent = monthStats.total_trades;

  const realisedEl = livedataEl.querySelector("#ld2-cal-realised");
  realisedEl.textContent = fmtMoney(monthStats.total_pnl);
  realisedEl.classList.toggle("ld2-green", monthStats.total_pnl >= 0);
  realisedEl.classList.toggle("ld2-red", monthStats.total_pnl < 0);
}

function renderTier(livedataEl, snapshot, tierCode) {
  const tier = snapshot?.tiers?.[tierCode];
  if (!tier) return;
  renderToday(livedataEl, tier);
  renderTradeBook(livedataEl, tier.trade_book);

  const { year, month } = selectedMonthYear(livedataEl, snapshot.market_date);
  const stats = computeMonthStats(tier.daily_series, tier.trade_book, year, month);
  renderPerformance(livedataEl, tier, stats, stats.days);
  renderCalendar(livedataEl, year, month, tier.daily_series, stats);
}

export function initLiveData(livedataEl, onRendered) {
  const applyBtn = livedataEl.querySelector(".ld2-fx-apply");

  function renderCurrent() {
    return loadSnapshot().then((snapshot) => {
      if (snapshot) renderTier(livedataEl, snapshot, selectedTierCode(livedataEl));
      onRendered?.();
    });
  }

  applyBtn?.addEventListener("click", renderCurrent);

  return { render: renderCurrent };
}
