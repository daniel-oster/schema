"use strict";

const WEEKDAY_NAMES = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_FULL = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const CATEGORY_COUNT = 10;
const HOUR_HEIGHT = 64; // px per hour in the grid
const DEFAULT_DAY_START = 8; // fallback axis bounds when a week has no lessons
const DEFAULT_DAY_END = 16;

// Pixel-height thresholds for how much a lesson block can show inline
// before it hands off to the tap-to-open modal for the rest.
const TIER_FULL_MIN = 56; // room for time + subject + a third line
const TIER_COMPACT_MIN = 22; // room for one combined "time subject" line

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
  }));
}

/** Greedy interval-graph column assignment so overlapping lessons split
 * width instead of stacking illegibly on top of each other. Lessons that
 * land in the same column are guaranteed non-overlapping in time, so a
 * block's height can never be forced past where the next one starts. */
function layoutColumns(lessons) {
  const sorted = [...lessons].sort((a, b) => minutesOf(a.time_start) - minutesOf(b.time_start));
  const colEnds = []; // last end-minute occupying each column
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
    return { startHour: DEFAULT_DAY_START, endHour: DEFAULT_DAY_END };
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
    setTimeout(clear, 400); // safety net if transitionend doesn't fire
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
    class: `lesson tier-${tier}`,
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

/** Builds the full day-grid DOM for one school entry's lessons in one week.
 * ctx: { schoolName, lunchByDay: {"1": [...]}, lunchNote } */
function renderDayGrid(rawLessons, ctx) {
  const merged = mergeLessons(rawLessons);
  const daysPresent = new Set(merged.map((l) => l.day_of_week));
  const dayNumbers = [1, 2, 3, 4, 5].concat([6, 7].filter((d) => daysPresent.has(d)));

  const lessonsByDay = new Map(dayNumbers.map((d) => [d, merged.filter((l) => l.day_of_week === d)]));
  const { startHour, endHour } = axisBoundsFor(lessonsByDay);
  const totalMinutes = (endHour - startHour) * 60;
  const bodyHeight = (endHour - startHour) * HOUR_HEIGHT;

  const gridCols = `72px repeat(${dayNumbers.length}, 1fr)`;
  const today = todayIso();
  const dayDates = computeDayDates(dayNumbers);

  const wrap = el("div", { class: "grid-scroll" });
  const grid = el("div", { class: "day-grid", style: `--grid-cols:${gridCols}` });

  // Header row
  const headerRow = el("div", { class: "day-grid__row-header" });
  headerRow.appendChild(el("div", { class: "gutter-cell" }));
  for (const dayNum of dayNumbers) {
    const dateStr = dayDates.get(dayNum);
    const isToday = dateStr === today;
    const headerCell = el("div", { class: "day-col__header" + (isToday ? " is-today" : "") });
    headerCell.appendChild(el("span", { class: "weekday", text: WEEKDAY_NAMES[dayNum - 1] }));
    if (dateStr) {
      headerCell.appendChild(document.createElement("br"));
      headerCell.appendChild(el("span", { class: "date", text: fmtDate(dateStr) }));
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
  grid.appendChild(headerRow);

  // Body
  const body = el("div", { class: "day-grid__body", style: `--grid-cols:${gridCols}; height:${bodyHeight}px` });

  const gutter = el("div", { class: "gutter" });
  for (let h = startHour; h <= endHour; h++) {
    const top = (h - startHour) * HOUR_HEIGHT;
    gutter.appendChild(el("div", { class: "gutter__label", style: `top:${top}px`, text: `${String(h).padStart(2, "0")}:00` }));
  }
  body.appendChild(gutter);

  for (const dayNum of dayNumbers) {
    const dayLessons = lessonsByDay.get(dayNum) || [];
    const dateStr = dayDates.get(dayNum);
    const col = el("div", { class: "day-col" });

    for (let h = startHour; h <= endHour; h++) {
      const top = (h - startHour) * HOUR_HEIGHT;
      col.appendChild(el("div", { class: "hour-line", style: `top:${top}px` }));
    }

    if (dayLessons.length === 0) {
      col.appendChild(el("div", { class: "empty-note", text: "Inget schema" }));
    } else {
      const placed = layoutColumns(dayLessons);
      for (const { lesson, col: colIdx, totalCols } of placed) {
        const startMin = minutesOf(lesson.time_start) - startHour * 60;
        const endMin = minutesOf(lesson.time_end) - startHour * 60;
        const top = (startMin / totalMinutes) * bodyHeight;
        // Never extend past the natural slot: columns already guarantee
        // lessons sharing a column don't overlap in time, so leaving the
        // proportional height alone (just a small min for tap targets)
        // is what keeps blocks from visually covering their neighbour.
        const height = Math.max(10, ((endMin - startMin) / totalMinutes) * bodyHeight - 2);
        const widthPct = 100 / totalCols;
        const leftPct = colIdx * widthPct;
        col.appendChild(buildLessonBlock(lesson, top, height, leftPct, widthPct, ctx, dateStr));
      }
    }

    if (dateStr === today) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes() - startHour * 60;
      if (nowMin >= 0 && nowMin <= totalMinutes) {
        const top = (nowMin / totalMinutes) * bodyHeight;
        col.appendChild(el("div", { class: "now-line", style: `top:${top}px` }));
      }
    }

    body.appendChild(col);
  }

  grid.appendChild(body);
  wrap.appendChild(grid);
  return wrap;
}

/** Skola24 doesn't give us calendar dates per lesson, only day_of_week
 * numbers — derive real dates from the week's Monday. */
function computeDayDates(dayNumbers) {
  const map = new Map();
  const monday = window.__currentWeekMonday;
  if (!monday) return map;
  for (const dayNum of dayNumbers) {
    const d = new Date(monday);
    d.setDate(d.getDate() + (dayNum - 1));
    map.set(dayNum, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return map;
}

function buildWeekSwitcher(weeks, activeIndex, onChange) {
  const wrap = el("div", { class: "week-switcher", role: "tablist" });
  weeks.forEach((week, i) => {
    const btn = el("button", {
      class: "week-btn",
      type: "button",
      "aria-pressed": String(i === activeIndex),
      onclick: () => onChange(i),
    });
    btn.appendChild(el("span", { class: "week-btn__num", text: `v${week.week}` }));
    btn.appendChild(document.createTextNode(`${fmtDate(week.start_date)}–${fmtDate(week.end_date)}`));
    wrap.appendChild(btn);
  });
  return wrap;
}

async function loadSchedule() {
  const res = await fetch(new URL("data/schedule.json", document.baseURI), { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setWeekMonday(week) {
  const [y, m, d] = week.start_date.split("-").map(Number);
  window.__currentWeekMonday = new Date(y, m - 1, d);
}

function lunchContextFor(school, weekKey) {
  return {
    schoolName: school.name,
    lunchByDay: (school.lunch && school.lunch[weekKey]) || {},
    lunchNote: school.lunch_note || null,
  };
}

async function initIndexPage() {
  const root = document.getElementById("app");
  try {
    const data = await loadSchedule();
    root.innerHTML = "";

    let activeIndex = data.weeks.findIndex((w) => todayIso() >= w.start_date && todayIso() <= w.end_date);
    if (activeIndex === -1) activeIndex = 0;

    const switcherSlot = document.getElementById("week-switcher-slot");
    const updatedNote = document.getElementById("updated-note");
    if (updatedNote) updatedNote.textContent = `Uppdaterad ${data.generated_at}`;

    const quickNav = el("nav", { class: "quick-nav" });
    data.schools.forEach((school, i) => {
      const link = el("a", { href: `${school.slug}.html` });
      link.appendChild(el("span", { class: "dot", style: `background:var(--school-${i === 0 ? "a" : "b"})` }));
      link.appendChild(document.createTextNode(`${school.name} ↗`));
      quickNav.appendChild(link);
    });

    const sectionsContainer = el("div", { id: "sections" });

    function render() {
      switcherSlot.innerHTML = "";
      switcherSlot.appendChild(buildWeekSwitcher(data.weeks, activeIndex, (i) => {
        activeIndex = i;
        render();
      }));

      const week = data.weeks[activeIndex];
      setWeekMonday(week);
      const weekKey = `${week.year}-W${String(week.week).padStart(2, "0")}`;

      sectionsContainer.innerHTML = "";
      data.schools.forEach((school, i) => {
        const accentVar = i === 0 ? "--school-a" : "--school-b";
        const section = el("section", { class: "school-section" });
        const head = el("div", { class: "school-head" });
        const titleWrap = el("div", { class: "school-head__title" });
        titleWrap.appendChild(el("span", { class: "dot", style: `background:var(${accentVar})` }));
        titleWrap.appendChild(el("h2", { text: school.name }));
        head.appendChild(titleWrap);
        const right = el("div", { style: "display:flex;align-items:center;gap:14px;" });
        right.appendChild(el("span", { class: "school-head__meta", text: weekLabel(week) }));
        right.appendChild(el("a", { class: "open-link", href: `${school.slug}.html`, text: "Eget schema →" }));
        head.appendChild(right);
        section.appendChild(head);
        section.appendChild(renderDayGrid(school.weeks[weekKey] || [], lunchContextFor(school, weekKey)));
        sectionsContainer.appendChild(section);
      });
    }

    render();

    root.appendChild(quickNav);
    root.appendChild(sectionsContainer);
  } catch (err) {
    root.innerHTML = "";
    root.appendChild(el("p", { class: "load-state is-error", text: `Kunde inte läsa schemat: ${err.message}` }));
  }
}

async function initClassPage(slug) {
  const root = document.getElementById("app");
  try {
    const data = await loadSchedule();
    const school = data.schools.find((s) => s.slug === slug);
    if (!school) throw new Error(`Hittade ingen klass med slug ${slug}`);
    root.innerHTML = "";

    let activeIndex = data.weeks.findIndex((w) => todayIso() >= w.start_date && todayIso() <= w.end_date);
    if (activeIndex === -1) activeIndex = 0;

    const titleEl = document.getElementById("class-title");
    if (titleEl) titleEl.textContent = school.name;
    document.title = `${school.name} — Veckoschema`;

    const updatedNote = document.getElementById("updated-note");
    if (updatedNote) updatedNote.textContent = `Uppdaterad ${data.generated_at}`;

    const switcherSlot = document.getElementById("week-switcher-slot");
    const gridSlot = el("div", { id: "grid-slot" });

    function render() {
      switcherSlot.innerHTML = "";
      switcherSlot.appendChild(buildWeekSwitcher(data.weeks, activeIndex, (i) => {
        activeIndex = i;
        render();
      }));
      const week = data.weeks[activeIndex];
      setWeekMonday(week);
      const weekKey = `${week.year}-W${String(week.week).padStart(2, "0")}`;
      gridSlot.innerHTML = "";
      gridSlot.appendChild(renderDayGrid(school.weeks[weekKey] || [], lunchContextFor(school, weekKey)));
    }

    render();
    root.appendChild(gridSlot);
  } catch (err) {
    root.innerHTML = "";
    root.appendChild(el("p", { class: "load-state is-error", text: `Kunde inte läsa schemat: ${err.message}` }));
  }
}
