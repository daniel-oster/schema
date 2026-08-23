"use strict";

const WEEKDAY_NAMES = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_FULL = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const CATEGORY_COUNT = 10;

// Pixel-height thresholds for how much a lesson block can show inline
// before it hands off to the tap-to-open modal for the rest. Small
// because the whole week now has to fit one screen with no scrolling.
const TIER_FULL_MIN = 56;
const TIER_COMPACT_MIN = 22;

const HEADER_ROW_H = 44; // day-header row height inside the grid, px
const GUTTER_W = 26; // hour-label column width, px
const SWIPE_THRESHOLD = 40; // px

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function fullDayLabel(dayNum, dateIso) {
  if (!dateIso) return WEEKDAY_FULL[dayNum - 1] || "";
  const [, m, d] = dateIso.split("-").map(Number);
  return `${WEEKDAY_FULL[dayNum - 1]} ${d} ${MONTH_NAMES[m - 1]}`;
}

function weekLabel(week) {
  return `v${week.week} · ${fmtDate(week.start_date)}–${fmtDate(week.end_date)}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIsoWeekday() {
  const d = new Date().getDay(); // 0=Sun..6=Sat
  return clamp(d === 0 ? 7 : d, 1, 5);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function categoryIndex(subject) {
  return hashString(subject || "") % CATEGORY_COUNT;
}

function isLunch(subject) {
  return /lunch/i.test(subject || "");
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Merge duplicate lesson rows Skola24 sometimes emits for multi-teacher
 * groups (same subject/day/time, different teacher signup). */
function mergeLessons(lessons) {
  const byKey = new Map();
  for (const l of lessons) {
    const key = `${l.day_of_week}|${l.time_start}|${l.time_end}|${l.subject}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...l, teachers: new Set(), rooms: new Set() });
    }
    const entry = byKey.get(key);
    if (l.teacher) l.teacher.split(",").forEach((t) => entry.teachers.add(t.trim()));
    if (l.room) l.room.split(",").forEach((r) => entry.rooms.add(r.trim()));
  }
  return [...byKey.values()].map((e) => ({
    subject: e.subject,
    day_of_week: e.day_of_week,
    time_start: e.time_start,
    time_end: e.time_end,
    teacher: [...e.teachers].join(", "),
    room: [...e.rooms].join(", "),
    inferred: e.inferred || false,
  }));
}

/** Greedy interval-graph column assignment so overlapping lessons split
 * width instead of stacking illegibly on top of each other. Lessons that
 * land in the same column are guaranteed non-overlapping in time, so a
 * block's height can never be forced past where the next one starts. */
function layoutColumns(lessons) {
  const sorted = [...lessons].sort((a, b) => minutesOf(a.time_start) - minutesOf(b.time_start));
  const colEnds = [];
  const placed = [];
  for (const lesson of sorted) {
    const start = minutesOf(lesson.time_start);
    const end = minutesOf(lesson.time_end);
    let col = colEnds.findIndex((endMin) => endMin <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    placed.push({ lesson, col });
  }
  const totalCols = Math.max(1, colEnds.length);
  return placed.map((p) => ({ ...p, totalCols }));
}

function axisBoundsFor(lessonsByDay) {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const lessons of lessonsByDay.values()) {
    for (const l of lessons) {
      minStart = Math.min(minStart, minutesOf(l.time_start));
      maxEnd = Math.max(maxEnd, minutesOf(l.time_end));
    }
  }
  if (!isFinite(minStart)) {
    return { startHour: 8, endHour: 16 };
  }
  const startHour = Math.max(0, Math.floor(minStart / 60));
  const endHour = Math.min(24, Math.ceil(maxEnd / 60));
  return { startHour, endHour: Math.max(endHour, startHour + 1) };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

/* ------------------------------- Modal ---------------------------------- */

let modalRoot = null;
let modalReturnFocus = null;

function ensureModalRoot() {
  if (modalRoot) return modalRoot;
  modalRoot = el("div", { class: "modal-root" });
  document.body.appendChild(modalRoot);
  return modalRoot;
}

function onModalKeydown(e) {
  if (e.key === "Escape") closeModal();
}

function closeModal() {
  if (!modalRoot || !modalRoot.classList.contains("is-open")) return;
  modalRoot.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  window.removeEventListener("keydown", onModalKeydown);
  const toFocus = modalReturnFocus;
  modalReturnFocus = null;
  const clear = () => {
    modalRoot.innerHTML = "";
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    clear();
  } else {
    modalRoot.addEventListener("transitionend", clear, { once: true });
    setTimeout(clear, 400);
  }
  if (toFocus && typeof toFocus.focus === "function") toFocus.focus();
}

function openModal(buildContent, triggerEl) {
  const root = ensureModalRoot();
  modalReturnFocus = triggerEl || null;
  root.innerHTML = "";

  const backdrop = el("div", { class: "modal-backdrop", onclick: closeModal });
  const sheet = el("div", { class: "modal-sheet", role: "dialog", "aria-modal": "true" });
  const handle = el("div", { class: "modal-handle", "aria-hidden": "true" });
  const closeBtn = el("button", { class: "modal-close", type: "button", "aria-label": "Stäng", onclick: closeModal });
  closeBtn.textContent = "✕";
  const body = el("div", { class: "modal-body" });
  buildContent(body);

  sheet.appendChild(handle);
  sheet.appendChild(closeBtn);
  sheet.appendChild(body);
  root.appendChild(backdrop);
  root.appendChild(sheet);

  document.body.classList.add("modal-open");
  window.addEventListener("keydown", onModalKeydown);
  requestAnimationFrame(() => root.classList.add("is-open"));
}

function menuList(dishes) {
  const list = el("ul", { class: "modal-menu" });
  for (const dish of dishes) {
    const item = el("li", {});
    if (dish.vegetarian) item.appendChild(el("span", { class: "veg-mark", "aria-label": "Vegetariskt", text: "🌱" }));
    item.appendChild(document.createTextNode(dish.name));
    list.appendChild(item);
  }
  return list;
}

function buildLessonModal(body, { lesson, schoolName, dayLabel, lunchDishes, lunchNote }) {
  const cat = categoryIndex(lesson.subject);
  body.appendChild(el("span", { class: "modal-eyebrow", style: `--cat-color:var(--cat-${cat})`, text: schoolName }));
  body.appendChild(el("h3", { class: "modal-title", text: lesson.subject || "(okänt)" }));
  body.appendChild(el("p", { class: "modal-time", text: `${dayLabel} · ${lesson.time_start}–${lesson.time_end}` }));
  if (lesson.inferred) {
    body.appendChild(el("p", { class: "modal-note", text: "Uppskattad lunchtid utifrån schemats lucka — inte hämtad direkt från Skola24." }));
  }

  const rows = [];
  if (lesson.teacher) rows.push(["Lärare", lesson.teacher]);
  if (lesson.room) rows.push(["Sal", lesson.room]);
  if (rows.length) {
    const dl = el("dl", { class: "modal-meta" });
    for (const [k, v] of rows) {
      dl.appendChild(el("dt", { text: k }));
      dl.appendChild(el("dd", { text: v }));
    }
    body.appendChild(dl);
  }

  if (lunchDishes && lunchDishes.length) {
    body.appendChild(el("h4", { class: "modal-subheading", text: "Dagens lunch" }));
    body.appendChild(menuList(lunchDishes));
    if (lunchNote) body.appendChild(el("p", { class: "modal-note", text: lunchNote }));
  } else if (!rows.length) {
    body.appendChild(el("p", { class: "modal-empty", text: "Ingen mer information tillgänglig." }));
  }
}

function buildLunchModal(body, { schoolName, dayLabel, dishes, note }) {
  body.appendChild(el("span", { class: "modal-eyebrow", style: "--cat-color:var(--cat-6)", text: schoolName }));
  body.appendChild(el("h3", { class: "modal-title", text: "Dagens lunch" }));
  body.appendChild(el("p", { class: "modal-time", text: dayLabel }));
  body.appendChild(menuList(dishes));
  if (note) body.appendChild(el("p", { class: "modal-note", text: note }));
}

/* ---------------------------- Lesson blocks ------------------------------ */

function buildLessonBlock(lesson, top, height, leftPct, widthPct, ctx, dateIso) {
  const cat = categoryIndex(lesson.subject);
  const tier = height >= TIER_FULL_MIN ? "full" : height >= TIER_COMPACT_MIN ? "compact" : "minimal";
  const lunch = isLunch(lesson.subject) ? (ctx.lunchByDay[lesson.day_of_week] || null) : null;

  const block = el("button", {
    type: "button",
    class: `lesson tier-${tier}${lesson.inferred ? " is-inferred" : ""}`,
    style: `top:${top}px; height:${height}px; left:calc(${leftPct}% + 3px); width:calc(${widthPct}% - 6px); --cat-color:var(--cat-${cat}); --cat-tint:var(--cat-${cat}-tint);`,
  });

  if (tier === "full") {
    block.appendChild(el("span", { class: "lesson__time", text: `${lesson.time_start}–${lesson.time_end}` }));
    block.appendChild(el("span", { class: "lesson__subject", text: lesson.subject || "(okänt)" }));
    if (lunch && lunch.length) {
      block.appendChild(el("span", { class: "lesson__meta", text: lunch.map((d) => d.name).join(" · ") }));
    } else {
      const metaParts = [lesson.teacher, lesson.room].filter(Boolean);
      if (metaParts.length) {
        block.appendChild(el("span", { class: "lesson__meta", text: metaParts.join(" · ") }));
      }
    }
  } else if (tier === "compact") {
    block.appendChild(el("span", { class: "lesson__time lesson__time--inline", text: lesson.time_start }));
    block.appendChild(el("span", { class: "lesson__subject", text: lesson.subject || "(okänt)" }));
  } else {
    block.appendChild(el("span", { class: "lesson__subject", text: lesson.subject || "(okänt)" }));
  }

  block.addEventListener("click", () => {
    openModal(
      (body) =>
        buildLessonModal(body, {
          lesson,
          schoolName: ctx.schoolName,
          dayLabel: fullDayLabel(lesson.day_of_week, dateIso),
          lunchDishes: lunch,
          lunchNote: ctx.lunchNote,
        }),
      block
    );
  });

  return block;
}

/* ----------------------------- Fit-to-screen grid ------------------------- */

/** Skola24 doesn't give us calendar dates per lesson, only day_of_week
 * numbers — derive real dates from the week's Monday. */
function computeDayDates(dayNumbers, monday) {
  const map = new Map();
  if (!monday) return map;
  for (const dayNum of dayNumbers) {
    const d = new Date(monday);
    d.setDate(d.getDate() + (dayNum - 1));
    map.set(dayNum, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return map;
}

/** Renders lessons for `dayNumbers` (5 days in landscape, 1 in portrait)
 * sized to exactly fill `container` — no scrolling, ever. Short lessons
 * degrade to a more compact label instead of growing the container. */
function renderFitGrid(container, rawLessons, ctx, dayNumbers, monday) {
  container.innerHTML = "";
  const merged = mergeLessons(rawLessons);
  const lessonsByDay = new Map(dayNumbers.map((d) => [d, merged.filter((l) => l.day_of_week === d)]));
  const { startHour, endHour } = axisBoundsFor(lessonsByDay);
  const totalMinutes = (endHour - startHour) * 60;
  const dayDates = computeDayDates(dayNumbers, monday);
  const today = todayIso();

  const single = dayNumbers.length === 1;
  // In single-day (portrait) mode the chrome bar already names the day, so
  // the grid's own header only needs to exist when there's a lunch chip to
  // show — otherwise skip it entirely and hand that space to the grid.
  const singleHasLunch = single && (ctx.lunchByDay[String(dayNumbers[0])] || []).length > 0;
  const headerH = single ? (singleHasLunch ? 30 : 0) : HEADER_ROW_H;

  const rect = container.getBoundingClientRect();
  const W = Math.max(rect.width, 1);
  const H = Math.max(rect.height, 1);
  const bodyH = Math.max(40, H - headerH);
  const dayColW = (W - GUTTER_W) / dayNumbers.length;
  const pxPerHour = bodyH / (endHour - startHour);

  const gridCols = `${GUTTER_W}px repeat(${dayNumbers.length}, ${dayColW}px)`;

  const grid = el("div", { class: "day-grid", style: `--grid-cols:${gridCols}` });

  const headerRow = el("div", { class: "day-grid__row-header", style: `height:${headerH}px` });
  headerRow.appendChild(el("div", { class: "gutter-cell" }));
  for (const dayNum of dayNumbers) {
    const dateStr = dayDates.get(dayNum);
    const isToday = dateStr === today;
    const headerCell = el("div", { class: "day-col__header" + (isToday ? " is-today" : "") });
    if (!single) {
      const label = `${WEEKDAY_NAMES[dayNum - 1]} ${dateStr ? fmtDate(dateStr) : ""}`;
      headerCell.appendChild(el("span", { class: "weekday", text: label }));
    }
    const dayLunch = ctx.lunchByDay[String(dayNum)];
    if (dayLunch && dayLunch.length) {
      const chip = el("button", { type: "button", class: "lunch-chip" });
      chip.appendChild(el("span", { class: "lunch-chip__icon", "aria-hidden": "true", text: "🍽" }));
      chip.appendChild(el("span", { class: "lunch-chip__label", text: dayLunch[0].name }));
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal(
          (body) =>
            buildLunchModal(body, {
              schoolName: ctx.schoolName,
              dayLabel: fullDayLabel(dayNum, dateStr),
              dishes: dayLunch,
              note: ctx.lunchNote,
            }),
          chip
        );
      });
      headerCell.appendChild(chip);
    }
    headerRow.appendChild(headerCell);
  }
  if (headerH > 0) grid.appendChild(headerRow);

  const body = el("div", { class: "day-grid__body", style: `--grid-cols:${gridCols}; height:${bodyH}px` });

  const gutter = el("div", { class: "gutter" });
  for (let h = startHour; h <= endHour; h++) {
    const top = (h - startHour) * pxPerHour;
    gutter.appendChild(el("div", { class: "gutter__label", style: `top:${top}px`, text: String(h) }));
  }
  body.appendChild(gutter);

  for (const dayNum of dayNumbers) {
    const dayLessons = lessonsByDay.get(dayNum) || [];
    const dateStr = dayDates.get(dayNum);
    const col = el("div", { class: "day-col" });

    for (let h = startHour; h <= endHour; h++) {
      const top = (h - startHour) * pxPerHour;
      col.appendChild(el("div", { class: "hour-line", style: `top:${top}px` }));
    }

    if (dayLessons.length === 0) {
      col.appendChild(el("div", { class: "empty-note", text: "Inget schema" }));
    } else {
      const placed = layoutColumns(dayLessons);
      for (const { lesson, col: colIdx, totalCols } of placed) {
        const startMin = minutesOf(lesson.time_start) - startHour * 60;
        const endMin = minutesOf(lesson.time_end) - startHour * 60;
        const top = (startMin / totalMinutes) * bodyH;
        const height = Math.max(10, ((endMin - startMin) / totalMinutes) * bodyH - 2);
        const widthPct = 100 / totalCols;
        const leftPct = colIdx * widthPct;
        col.appendChild(buildLessonBlock(lesson, top, height, leftPct, widthPct, ctx, dateStr));
      }
    }

    if (dateStr === today) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes() - startHour * 60;
      if (nowMin >= 0 && nowMin <= totalMinutes) {
        const top = (nowMin / totalMinutes) * bodyH;
        col.appendChild(el("div", { class: "now-line", style: `top:${top}px` }));
      }
    }

    body.appendChild(col);
  }

  grid.appendChild(body);
  container.appendChild(grid);
}

function lunchContextFor(school, weekKey) {
  return {
    schoolName: school.name,
    lunchByDay: (school.lunch && school.lunch[weekKey]) || {},
    lunchNote: school.lunch_note || null,
  };
}

/* ------------------------------- Swipe app -------------------------------- */

function attachSwipe(el, { onHorizontal, onVertical }) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    },
    { passive: true }
  );

  el.addEventListener(
    "pointerup",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        onHorizontal(dx < 0 ? 1 : -1);
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_THRESHOLD) {
        onVertical(dy < 0 ? 1 : -1);
      }
    },
    { passive: true }
  );

  el.addEventListener("pointercancel", () => {
    tracking = false;
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") onHorizontal(-1);
    else if (e.key === "ArrowRight") onHorizontal(1);
    else if (e.key === "ArrowUp") onVertical(-1);
    else if (e.key === "ArrowDown") onVertical(1);
    else return;
    e.preventDefault();
  });
}

function bounce(stage, axis) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cls = axis === "x" ? "bounce-x" : "bounce-y";
  stage.classList.remove(cls);
  // force reflow so the animation restarts if triggered twice quickly
  void stage.offsetWidth;
  stage.classList.add(cls);
  setTimeout(() => stage.classList.remove(cls), 220);
}

async function loadSchedule() {
  const res = await fetch(new URL("data/schedule.json", document.baseURI), { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function initApp({ lockedSlug } = {}) {
  const stage = document.getElementById("stage");
  const stageInner = document.getElementById("stage-inner");
  const chromeClass = document.getElementById("chrome-class");
  const chromeDot = document.getElementById("chrome-dot");
  const chromePeriod = document.getElementById("chrome-period");
  const dotsClass = document.getElementById("dots-class");
  const dotsWeek = document.getElementById("dots-week");

  let data;
  try {
    data = await loadSchedule();
  } catch (err) {
    stageInner.innerHTML = "";
    stageInner.appendChild(el("p", { class: "load-state is-error", text: `Kunde inte läsa schemat: ${err.message}` }));
    return;
  }

  const classes = lockedSlug ? data.schools.filter((s) => s.slug === lockedSlug) : data.schools;
  if (!classes.length) {
    stageInner.innerHTML = "";
    stageInner.appendChild(el("p", { class: "load-state is-error", text: "Hittade inget schema." }));
    return;
  }

  let classIdx = 0;
  let weekIdx = data.weeks.findIndex((w) => todayIso() >= w.start_date && todayIso() <= w.end_date);
  if (weekIdx === -1) weekIdx = 0;
  const todayDay = todayIsoWeekday();

  function orientationIsPortrait() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  function render() {
    const school = classes[classIdx];
    const week = data.weeks[weekIdx];
    const weekKey = `${week.year}-W${String(week.week).padStart(2, "0")}`;
    const ctx = lunchContextFor(school, weekKey);
    const [my, mm, md] = week.start_date.split("-").map(Number);
    const monday = new Date(my, mm - 1, md);
    const dayNumbers = orientationIsPortrait() ? [todayDay] : [1, 2, 3, 4, 5];

    renderFitGrid(stageInner, school.weeks[weekKey] || [], ctx, dayNumbers, monday);

    // chrome
    chromeDot.style.background = `var(--school-${classIdx === 0 ? "a" : "b"})`;
    chromeClass.textContent = school.class;
    chromePeriod.textContent = orientationIsPortrait() ? fullDayLabel(todayDay, computeDayDates([todayDay], monday).get(todayDay)) : weekLabel(week);

    dotsWeek.innerHTML = "";
    data.weeks.forEach((_, i) => dotsWeek.appendChild(el("i", { class: i === weekIdx ? "is-active" : "" })));

    dotsClass.innerHTML = "";
    dotsClass.style.display = classes.length > 1 ? "" : "none";
    classes.forEach((_, i) => dotsClass.appendChild(el("i", { class: i === classIdx ? "is-active" : "" })));
  }

  function go(deltaWeek, deltaClass) {
    const newWeek = clamp(weekIdx + deltaWeek, 0, data.weeks.length - 1);
    const newClass = clamp(classIdx + deltaClass, 0, classes.length - 1);
    if (newWeek === weekIdx && newClass === classIdx) {
      if (deltaWeek !== 0) bounce(stage, "x");
      if (deltaClass !== 0) bounce(stage, "y");
      return;
    }
    weekIdx = newWeek;
    classIdx = newClass;
    render();
  }

  attachSwipe(stage, {
    onHorizontal: (dir) => go(dir, 0),
    onVertical: (dir) => go(0, dir),
  });

  window.addEventListener("resize", render);
  window.matchMedia("(orientation: portrait)").addEventListener("change", render);

  render();
}
