"use strict";

const WEEKDAY_NAMES = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_FULL = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const CATEGORY_COUNT = 10;
const HOUR_HEIGHT = 64; // px per hour in the grid
const DEFAULT_DAY_START = 8; // fallback axis bounds when a week has no lessons
const DEFAULT_DAY_END = 16;

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
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
 * width instead of stacking illegibly on top of each other. */
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

/** Builds the full day-grid DOM for one school entry's lessons in one week. */
function renderDayGrid(rawLessons) {
  const merged = mergeLessons(rawLessons);
  const daysPresent = new Set(merged.map((l) => l.day_of_week));
  const dayNumbers = [1, 2, 3, 4, 5].concat([6, 7].filter((d) => daysPresent.has(d)));

  const lessonsByDay = new Map(dayNumbers.map((d) => [d, merged.filter((l) => l.day_of_week === d)]));
  const { startHour, endHour } = axisBoundsFor(lessonsByDay);
  const totalMinutes = (endHour - startHour) * 60;
  const bodyHeight = (endHour - startHour) * HOUR_HEIGHT;

  const gridCols = `72px repeat(${dayNumbers.length}, 1fr)`;
  const today = todayIso();

  const wrap = el("div", { class: "grid-scroll" });
  const grid = el("div", { class: "day-grid", style: `--grid-cols:${gridCols}` });

  // Header row
  const headerRow = el("div", { class: "day-grid__row-header" });
  headerRow.appendChild(el("div", { class: "gutter-cell" }));
  const dayDates = computeDayDates(rawLessons, dayNumbers);
  for (const dayNum of dayNumbers) {
    const isToday = dayDates.get(dayNum) === today;
    const headerCell = el("div", { class: "day-col__header" + (isToday ? " is-today" : "") });
    headerCell.appendChild(el("span", { class: "weekday", text: WEEKDAY_NAMES[dayNum - 1] }));
    const dateStr = dayDates.get(dayNum);
    if (dateStr) {
      headerCell.appendChild(document.createElement("br"));
      headerCell.appendChild(el("span", { class: "date", text: fmtDate(dateStr) }));
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
        const height = Math.max(20, ((endMin - startMin) / totalMinutes) * bodyHeight - 2);
        const widthPct = 100 / totalCols;
        const leftPct = colIdx * widthPct;
        const cat = categoryIndex(lesson.subject);

        const block = el("div", {
          class: "lesson",
          style: `top:${top}px; height:${height}px; left:calc(${leftPct}% + 3px); width:calc(${widthPct}% - 6px); --cat-color:var(--cat-${cat}); --cat-tint:var(--cat-${cat}-tint);`,
        });
        block.appendChild(el("span", { class: "lesson__time", text: `${lesson.time_start}–${lesson.time_end}` }));
        block.appendChild(el("span", { class: "lesson__subject", text: lesson.subject || "(okänt)" }));
        const metaParts = [lesson.teacher, lesson.room].filter(Boolean);
        if (metaParts.length) {
          block.appendChild(el("span", { class: "lesson__meta", text: metaParts.join(" · ") }));
        }
        col.appendChild(block);
      }
    }

    if (dayDates.get(dayNum) === today) {
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
function computeDayDates(rawLessons, dayNumbers) {
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
        section.appendChild(renderDayGrid(school.weeks[weekKey] || []));
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
      gridSlot.appendChild(renderDayGrid(school.weeks[weekKey] || []));
    }

    render();
    root.appendChild(gridSlot);
  } catch (err) {
    root.innerHTML = "";
    root.appendChild(el("p", { class: "load-state is-error", text: `Kunde inte läsa schemat: ${err.message}` }));
  }
}
