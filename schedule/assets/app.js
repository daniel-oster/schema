"use strict";

const WEEKDAY_NAMES = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAY_FULL = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const CATEGORY_COUNT = 12;

const HEADER_ROW_H = 24; // weekday/date strip above the grid, px
const GUTTER_W = 28; // hour-rail width, px
const SWIPE_THRESHOLD = 40; // px

// A block shorter than this can't carry a readable line of text, so the
// layout grows it and pushes its neighbours down instead of letting it
// collapse into an unreadable sliver (see enforceMinHeights).
const MIN_BLOCK_H = 17;
const BLOCK_GAP = 2; // vertical breathing room between stacked blocks, px
// Empty axis kept below the last lesson of the week, minutes. Without it a day
// that ends on a half hour puts its final block flush against the bottom rule.
const AXIS_TAIL = 30;
const BLOCK_PAD_V = 4; // total vertical padding inside .lesson, px
const BLOCK_PAD_H = 14; // padding + left signal bar inside .lesson, px

// Type steps for lesson text, picked from the block's real pixel width so a
// half-width block shrinks its type instead of ellipsing the subject away.
const TYPE_STEPS = [
  { minWidth: 118, size: 11.5, line: 13 },
  { minWidth: 78, size: 10.5, line: 12 },
  { minWidth: 0, size: 9.5, line: 11 },
];

const NARROW_STACK = '"Archivo Narrow", "Archivo", "Arial Narrow", Arial, sans-serif';
const LUNCH_TAG = "LUNCH";
const MONO_STACK = '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace';

// Text is measured against the fonts the browser actually resolved, not
// guessed from an average glyph width — "does this subject fit" has to be
// true of the face on screen, including when Google Fonts never loads and
// the fallback is wider.
const _measureCtx = document.createElement("canvas").getContext("2d");
const _measureCache = new Map();

function textWidth(text, font) {
  const key = `${font}\u0000${text}`;
  let w = _measureCache.get(key);
  if (w === undefined) {
    _measureCtx.font = font;
    w = _measureCtx.measureText(text).width;
    _measureCache.set(key, w);
  }
  return w;
}

/** Greedy word wrap, counting the lines `text` really needs at `size`. A word
 * too long for the line still costs exactly one line — the block breaks it
 * mid-word (overflow-wrap: anywhere), which is why long words don't blow the
 * count up. */
function wrapCount(text, maxWidth, size, weight) {
  if (maxWidth <= 0) return 99;
  const font = `${weight} ${size}px ${NARROW_STACK}`;
  if (textWidth(text, font) <= maxWidth) return 1;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wordW = textWidth(word, font);
    const spaceW = used ? textWidth(" ", font) : 0;
    if (used && used + spaceW + wordW > maxWidth) {
      lines++;
      used = Math.min(wordW, maxWidth);
    } else {
      used += spaceW + wordW;
    }
  }
  return lines;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fmtDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
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

/** FNV-ish string hash. Only needs to be stable and well spread — it decides
 * which of the twelve swatches a subject gets, and must give the same answer
 * across reloads, devices and regenerated data. */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isLunch(subject) {
  return /lunch/i.test(subject || "");
}

/** Skola24 spells a course out as "<ämne>, Nivå 1b". The level almost never
 * helps pick a block out of a grid, but it eats the width the subject needs,
 * so split it off and show it as metadata instead. */
function splitSubject(subject) {
  const raw = (subject || "").trim();
  const m = /^(.+?),\s*((?:nivå|steg|kurs)\s*.+)$/i.exec(raw);
  if (m) return { base: m[1].trim(), level: m[2].trim() };
  return { base: raw, level: "" };
}

/* ------------------------------ Colour map -------------------------------- */

/** Spread a school's subjects evenly across the twelve swatches by walking
 * them in sorted order — hashing each name independently was stable across
 * regenerations but clustered: six of ES26ESM's subjects landed in the
 * blue-green corner and the week read as one colour.
 *
 * With more subjects than swatches the walk wraps, so a second pass nudges
 * any pair that actually runs against each other off a shared slot. That is
 * decided once per school, not per day, so a subject looks the same
 * everywhere. */
function buildCategoryMap(school) {
  const subjects = new Set();
  const conflicts = new Map(); // subject -> subjects it ever overlaps in time

  for (const lessons of Object.values(school.weeks || {})) {
    const byDay = new Map();
    for (const l of lessons) {
      const { base } = splitSubject(l.subject);
      if (!base || isLunch(base)) continue;
      subjects.add(base);
      if (!byDay.has(l.day_of_week)) byDay.set(l.day_of_week, []);
      byDay.get(l.day_of_week).push({ base, start: minutesOf(l.time_start), end: minutesOf(l.time_end) });
    }
    for (const items of byDay.values()) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.base === b.base || a.start >= b.end || b.start >= a.end) continue;
          if (!conflicts.has(a.base)) conflicts.set(a.base, new Set());
          if (!conflicts.has(b.base)) conflicts.set(b.base, new Set());
          conflicts.get(a.base).add(b.base);
          conflicts.get(b.base).add(a.base);
        }
      }
    }
  }

  const sorted = [...subjects].sort((a, b) => a.localeCompare(b, "sv"));
  const map = new Map();
  sorted.forEach((name, i) => map.set(name, i % CATEGORY_COUNT));

  for (const name of sorted) {
    const rivals = [...(conflicts.get(name) || [])];
    if (!rivals.some((other) => map.get(other) === map.get(name))) continue;
    for (let step = 1; step < CATEGORY_COUNT; step++) {
      const candidate = (map.get(name) + step) % CATEGORY_COUNT;
      if (!rivals.some((other) => map.get(other) === candidate)) {
        map.set(name, candidate);
        break;
      }
    }
  }
  return map;
}

/* ------------------------------ Lesson prep ------------------------------- */

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

/** Skola24 splits a double period into back-to-back rows (09:40–09:50 then
 * 09:50–10:40 of the same subject). Rendered literally that's a 10-minute
 * sliver too small to label, sitting on top of the block it belongs to — so
 * glue contiguous rows of the same subject/teacher/room back together. */
function coalesceRuns(lessons) {
  const sorted = [...lessons].sort(
    (a, b) => a.day_of_week - b.day_of_week || minutesOf(a.time_start) - minutesOf(b.time_start)
  );
  const out = [];
  const lastOfKind = new Map();
  for (const lesson of sorted) {
    // Keyed rather than "compare with the previous block": a double period
    // often has a parallel course starting between its two halves, and
    // comparing only with the block before would leave the run split.
    const key = [lesson.day_of_week, lesson.subject, lesson.teacher, lesson.room, lesson.inferred].join("|");
    const idx = lastOfKind.get(key);
    if (idx !== undefined && minutesOf(out[idx].time_end) === minutesOf(lesson.time_start)) {
      out[idx].time_end = lesson.time_end;
    } else {
      out.push({ ...lesson });
      lastOfKind.set(key, out.length - 1);
    }
  }
  return out;
}

/** Split a day into clusters of lessons that actually overlap, and lay each
 * cluster out on its own column count. Laying the whole day out on the day's
 * worst-case column count is what used to squeeze every block on Wednesday to
 * half width because two courses clashed at 10:40. Inside a cluster, a block
 * also expands rightwards across columns nothing else occupies. */
function layoutColumns(lessons) {
  const sorted = [...lessons].sort(
    (a, b) => minutesOf(a.time_start) - minutesOf(b.time_start) || minutesOf(b.time_end) - minutesOf(a.time_end)
  );

  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  for (const lesson of sorted) {
    if (current.length && minutesOf(lesson.time_start) >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(lesson);
    clusterEnd = Math.max(clusterEnd, minutesOf(lesson.time_end));
  }
  if (current.length) clusters.push(current);

  const placed = [];
  for (const cluster of clusters) {
    const columns = []; // columns[i] = lessons assigned to column i
    for (const lesson of cluster) {
      const start = minutesOf(lesson.time_start);
      let col = columns.findIndex((items) => items.every((o) => minutesOf(o.time_end) <= start));
      if (col === -1) {
        col = columns.length;
        columns.push([]);
      }
      columns[col].push(lesson);
    }
    const totalCols = columns.length;
    columns.forEach((items, col) => {
      for (const lesson of items) {
        const start = minutesOf(lesson.time_start);
        const end = minutesOf(lesson.time_end);
        let span = 1;
        while (col + span < totalCols) {
          const blocked = columns[col + span].some(
            (o) => minutesOf(o.time_start) < end && minutesOf(o.time_end) > start
          );
          if (blocked) break;
          span++;
        }
        placed.push({ lesson, col, span, totalCols });
      }
    });
  }
  return placed;
}

/** Give every block at least MIN_BLOCK_H of height, pushing what follows it
 * down rather than letting a 20-minute lesson render as an unlabelled hairline
 * under the next block. A reverse pass pins the last block to the bottom edge
 * so the displacement can never run off the grid. */
function enforceMinHeights(items, bodyH) {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  let cursor = 0;
  for (const it of sorted) {
    it.height = Math.max(it.height, MIN_BLOCK_H);
    if (it.top < cursor) it.top = cursor;
    cursor = it.top + it.height + BLOCK_GAP;
  }
  let limit = bodyH;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const it = sorted[i];
    if (it.top + it.height > limit) it.top = limit - it.height;
    if (it.top < 0) {
      it.top = 0;
      it.height = Math.min(it.height, Math.max(limit, MIN_BLOCK_H));
    }
    limit = it.top - BLOCK_GAP;
  }
}

/** Snap the visible day to the half hour around the first and last lesson,
 * then keep a clear half hour below the last one. Rounding out to whole hours
 * donated up to an hour of dead band to a grid that has to fit a whole week on
 * one phone screen; ending exactly on the last lesson went too far the other
 * way and left the final block welded to the bottom edge. */
function axisBoundsFor(lessonsByDay) {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const lessons of lessonsByDay.values()) {
    for (const l of lessons) {
      minStart = Math.min(minStart, minutesOf(l.time_start));
      maxEnd = Math.max(maxEnd, minutesOf(l.time_end));
    }
  }
  if (!isFinite(minStart)) return { startMin: 8 * 60, endMin: 16 * 60 };
  const startMin = Math.max(0, Math.floor(minStart / 30) * 30);
  const endMin = Math.min(24 * 60, Math.ceil(maxEnd / 30) * 30 + AXIS_TAIL);
  return { startMin, endMin: Math.max(endMin, startMin + 60) };
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
  if (toFocus && typeof toFocus.focus === "function" && toFocus.isConnected) toFocus.focus();
}

function openModal(buildContent, triggerEl) {
  const root = ensureModalRoot();
  modalReturnFocus = triggerEl || null;
  root.innerHTML = "";

  const backdrop = el("div", { class: "modal-backdrop", onclick: closeModal });
  const sheet = el("div", { class: "modal-sheet", role: "dialog", "aria-modal": "true" });
  const closeBtn = el("button", { class: "modal-close", type: "button", "aria-label": "Stäng", onclick: closeModal });
  closeBtn.textContent = "✕";
  const body = el("div", { class: "modal-body" });
  buildContent(body);

  sheet.appendChild(closeBtn);
  sheet.appendChild(body);
  root.appendChild(backdrop);
  root.appendChild(sheet);

  document.body.classList.add("modal-open");
  window.addEventListener("keydown", onModalKeydown);
  requestAnimationFrame(() => {
    root.classList.add("is-open");
    closeBtn.focus();
  });
}

function menuList(dishes) {
  const list = el("ul", { class: "modal-menu" });
  for (const dish of dishes) {
    const item = el("li", {});
    if (dish.vegetarian) item.appendChild(el("span", { class: "veg-mark", title: "Vegetariskt", text: "🌱" }));
    item.appendChild(el("span", { text: dish.name }));
    list.appendChild(item);
  }
  return list;
}

function buildLessonModal(body, { lesson, cat, schoolName, dayLabel, lunchDishes, lunchNote }) {
  const { base, level } = splitSubject(lesson.subject);
  const lunch = isLunch(lesson.subject);
  const swatch = lunch ? "var(--lunch-line)" : `var(--cat-${cat})`;

  body.appendChild(el("span", { class: "modal-eyebrow", style: `--cat-color:${swatch}`, text: schoolName }));
  body.appendChild(el("h3", { class: "modal-title", text: lunch ? "Dagens lunch" : base || "(okänt)" }));
  body.appendChild(
    el("p", { class: "modal-time", text: `${dayLabel} · ${lesson.time_start}–${lesson.time_end}` })
  );

  const rows = [];
  if (level) rows.push(["Nivå", level]);
  if (lesson.teacher) rows.push([lesson.teacher.includes(",") ? "Lärare" : "Lärare", lesson.teacher]);
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
    if (!lunch) body.appendChild(el("h4", { class: "modal-subheading", text: "Dagens lunch" }));
    body.appendChild(menuList(lunchDishes));
  }

  if (lesson.inferred) {
    body.appendChild(
      el("p", {
        class: "modal-note",
        text: "Uppskattad lunchtid utifrån schemats lucka — inte hämtad direkt från Skola24.",
      })
    );
  }
  if (lunchDishes && lunchDishes.length && lunchNote) {
    body.appendChild(el("p", { class: "modal-note", text: lunchNote }));
  }
  if (!rows.length && !(lunchDishes && lunchDishes.length)) {
    body.appendChild(el("p", { class: "modal-empty", text: "Ingen mer information tillgänglig." }));
  }
}

/* ---------------------------- Lesson blocks ------------------------------ */

/** Decide what fits, and shrink the type a step at a time until the subject
 * genuinely does. Everything a block still can't hold is one tap away in the
 * sheet, but the subject always wins the space it needs first. */
function contentPlan(text, timeText, width, height) {
  const avail = width - BLOCK_PAD_H;
  const startIdx = Math.max(
    0,
    TYPE_STEPS.findIndex((s) => width >= s.minWidth)
  );
  let chosen = null;
  for (let i = startIdx; i < TYPE_STEPS.length; i++) {
    const step = TYPE_STEPS[i];
    const lines = Math.max(1, Math.floor((height - BLOCK_PAD_V) / step.line));
    const need = wrapCount(text, avail, step.size, 700);
    if (!chosen) chosen = { step, lines, need };
    if (need <= lines) {
      chosen = { step, lines, need };
      break;
    }
    chosen = { step, lines, need };
  }
  const { step, lines, need } = chosen;
  const subjectLines = clamp(Math.min(need, lines), 1, 4);
  let left = lines - subjectLines;
  const timeFont = `${step.size - 1.5}px ${MONO_STACK}`;
  const showTime = left > 0 && textWidth(timeText, timeFont) <= avail;
  if (showTime) left--;
  return { step, subjectLines, showTime, showMeta: left > 0, clipped: need > subjectLines };
}

function buildLessonBlock(lesson, geom, ctx, dateIso) {
  const { base, level } = splitSubject(lesson.subject);
  const lunch = isLunch(lesson.subject);
  const dishes = lunch ? ctx.lunchByDay[lesson.day_of_week] || ctx.lunchByDay[String(lesson.day_of_week)] || [] : [];
  const cat = ctx.categories.get(base);

  // A lunch block's headline is what's being served — the slot and the LUNCH
  // tag already say it's lunch, and the dish is what you actually look for.
  const headline = lunch ? (dishes.length ? dishes[0].name : "Lunch") : base || "(okänt)";
  const metaParts = lunch
    ? dishes.slice(1).map((d) => d.name)
    : [level, lesson.teacher, lesson.room].filter(Boolean);
  const meta = metaParts.join(" · ");

  const span = `${lesson.time_start}–${lesson.time_end}`;
  const timeText = lunch ? `LUNCH ${lesson.time_start}` : span;
  let plan = contentPlan(headline, timeText, geom.width, geom.height);

  // A short lunch block has no room for the time line, and a bare dish name in
  // a grey bar doesn't say "lunch" — so the tag moves inline. It only earns
  // its place when the dish still fits on one line beside it: measured in the
  // tag's own mono face and letter-spacing, not as if it were body text.
  let label = headline;
  let inlineTag = false;
  if (lunch && !plan.showTime && !plan.clipped) {
    const size = plan.step.size;
    const tagSize = size - 2;
    const tagWidth =
      textWidth(LUNCH_TAG, `${tagSize}px ${MONO_STACK}`) + LUNCH_TAG.length * tagSize * 0.08 + 6;
    const dishWidth = textWidth(headline, `700 ${size}px ${NARROW_STACK}`);
    inlineTag = dishWidth <= geom.width - BLOCK_PAD_H - tagWidth;
  }
  if (lunch && plan.clipped && label !== "Lunch") {
    label = "Lunch";
    plan = contentPlan(label, timeText, geom.width, geom.height);
  }
  const classes = ["lesson"];
  if (lunch) classes.push("is-lunch");
  if (lesson.inferred) classes.push("is-inferred");

  const style = [
    `top:${geom.top.toFixed(2)}px`,
    `height:${geom.height.toFixed(2)}px`,
    `left:${geom.left.toFixed(2)}px`,
    `width:${geom.width.toFixed(2)}px`,
    `--ls:${plan.step.size}px`,
    `--lh:${plan.step.line}px`,
    `--lines:${plan.subjectLines}`,
    lunch ? "--cat-color:var(--lunch-line); --cat-tint:var(--lunch-tint)" : `--cat-color:var(--cat-${cat}); --cat-tint:var(--cat-${cat}-tint)`,
  ].join("; ");

  const block = el("button", {
    type: "button",
    class: classes.join(" "),
    style,
    title: `${span} ${headline}${meta ? ` · ${meta}` : ""}`,
  });

  if (plan.showTime) block.appendChild(el("span", { class: "lesson__time", text: timeText }));
  const subject = el("span", { class: "lesson__subject", text: label });
  if (inlineTag) subject.prepend(el("span", { class: "lesson__tag", text: LUNCH_TAG }));
  block.appendChild(subject);
  if (plan.showMeta && meta) block.appendChild(el("span", { class: "lesson__meta", text: meta }));

  block.addEventListener("click", () => {
    openModal(
      (body) =>
        buildLessonModal(body, {
          lesson,
          cat,
          schoolName: ctx.schoolName,
          dayLabel: fullDayLabel(lesson.day_of_week, dateIso),
          lunchDishes: dishes,
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
 * sized to exactly fill `container` — no scrolling, ever. */
function renderFitGrid(container, rawLessons, ctx, dayNumbers, monday) {
  container.innerHTML = "";
  const prepared = coalesceRuns(mergeLessons(rawLessons));
  const lessonsByDay = new Map(dayNumbers.map((d) => [d, prepared.filter((l) => l.day_of_week === d)]));
  const { startMin, endMin } = axisBoundsFor(lessonsByDay);
  const totalMinutes = endMin - startMin;
  const dayDates = computeDayDates(dayNumbers, monday);
  const today = todayIso();

  const single = dayNumbers.length === 1;
  const headerH = single ? 0 : HEADER_ROW_H;

  const rect = container.getBoundingClientRect();
  const W = Math.max(rect.width, 1);
  const H = Math.max(rect.height, 1);
  const bodyH = Math.max(60, H - headerH);
  const dayColW = (W - GUTTER_W) / dayNumbers.length;
  const gridCols = `${GUTTER_W}px repeat(${dayNumbers.length}, ${dayColW}px)`;
  const yOf = (min) => ((min - startMin) / totalMinutes) * bodyH;

  const grid = el("div", { class: "day-grid", style: `--grid-cols:${gridCols}` });

  if (headerH > 0) {
    const headerRow = el("div", { class: "day-grid__row-header", style: `height:${headerH}px` });
    headerRow.appendChild(el("div", { class: "gutter-cell" }));
    for (const dayNum of dayNumbers) {
      const dateStr = dayDates.get(dayNum);
      const cell = el("div", { class: "day-col__header" + (dateStr === today ? " is-today" : "") });
      cell.appendChild(el("span", { class: "weekday", text: WEEKDAY_NAMES[dayNum - 1] }));
      if (dateStr) cell.appendChild(el("span", { class: "daydate", text: fmtDate(dateStr) }));
      headerRow.appendChild(cell);
    }
    grid.appendChild(headerRow);
  }

  const body = el("div", { class: "day-grid__body", style: `--grid-cols:${gridCols}; height:${bodyH}px` });

  // Hour rail. Labels at the extremes are pinned inside the box so they can't
  // ride up over the header rule or fall off the bottom edge.
  const gutter = el("div", { class: "gutter" });
  const firstHour = Math.ceil(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  for (let h = firstHour; h <= lastHour; h++) {
    const top = yOf(h * 60);
    const shift = top < 7 ? "0" : top > bodyH - 7 ? "-100%" : "-50%";
    gutter.appendChild(
      el("div", {
        class: "gutter__label",
        style: `top:${top.toFixed(2)}px; transform:translateY(${shift})`,
        text: String(h).padStart(2, "0"),
      })
    );
  }
  body.appendChild(gutter);

  for (const dayNum of dayNumbers) {
    const dayLessons = lessonsByDay.get(dayNum) || [];
    const dateStr = dayDates.get(dayNum);
    const isToday = dateStr === today;
    const col = el("div", { class: "day-col" + (isToday ? " is-today" : "") });

    for (let m = Math.ceil(startMin / 30) * 30; m <= endMin; m += 30) {
      const top = yOf(m);
      col.appendChild(
        el("div", { class: "hour-line" + (m % 60 === 0 ? " is-hour" : ""), style: `top:${top.toFixed(2)}px` })
      );
    }

    if (dayLessons.length === 0) {
      col.appendChild(el("div", { class: "empty-note", text: "Inget schema" }));
    } else {
      const placed = layoutColumns(dayLessons).map((p) => {
        const trackW = dayColW / p.totalCols;
        return {
          lesson: p.lesson,
          col: p.col,
          top: yOf(minutesOf(p.lesson.time_start)),
          height: Math.max(
            1,
            yOf(minutesOf(p.lesson.time_end)) - yOf(minutesOf(p.lesson.time_start)) - BLOCK_GAP
          ),
          // Floor the width so a block stays tappable, but never past the
          // day column — a day with many simultaneous courses must still
          // stay inside its own lane.
          left: p.col * trackW + 2,
          width: clamp(p.span * trackW - 5, Math.min(24, trackW), dayColW - p.col * trackW - 3),
        };
      });
      const byColumn = new Map();
      for (const item of placed) {
        if (!byColumn.has(item.col)) byColumn.set(item.col, []);
        byColumn.get(item.col).push(item);
      }
      for (const items of byColumn.values()) enforceMinHeights(items, bodyH);
      for (const item of placed) col.appendChild(buildLessonBlock(item.lesson, item, ctx, dateStr));
    }

    if (isToday) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= startMin && nowMin <= endMin) {
        col.appendChild(el("div", { class: "now-line", style: `top:${yOf(nowMin).toFixed(2)}px` }));
      }
    }

    body.appendChild(col);
  }

  grid.appendChild(body);
  container.appendChild(grid);
}

function lunchContextFor(school, weekKey, categories) {
  return {
    schoolName: school.name,
    lunchByDay: (school.lunch && school.lunch[weekKey]) || {},
    lunchNote: school.lunch_note || null,
    categories,
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

/** Files the app is built from. A hard refresh re-fetches exactly these,
 * bypassing the cache, before reloading the document. */
const APP_FILES = ["assets/app.js", "assets/style.css", "data/schedule.json"];

async function loadSchedule() {
  const res = await fetch(new URL("data/schedule.json", document.baseURI), { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Pull everything from the server again, for when the phone is showing a
 * build that has since been replaced.
 *
 * A page can't reach into Safari's cache the way ⌘⇧R does, but `cache:
 * "reload"` both bypasses the HTTP cache *and* writes the fresh response back
 * into it — so re-fetching the app's own files here leaves the cache holding
 * current copies, and the reload that follows picks those up rather than the
 * stale ones. The changed query string is what stops the document itself
 * coming from the back/forward cache. */
async function hardRefresh(button) {
  if (button) {
    button.disabled = true;
    button.classList.add("is-busy");
  }

  // Cache Storage throws rather than returning empty in some private modes.
  try {
    if (window.caches) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {
    /* nothing cached there to clear */
  }

  await Promise.all(
    APP_FILES.map((file) =>
      fetch(new URL(file, document.baseURI), { cache: "reload" }).catch(() => {
        // Offline, or the file moved. The reload below still gets us somewhere
        // honest — an error state beats sitting on a stale render.
      })
    )
  );

  const url = new URL(window.location.href);
  url.searchParams.set("r", Date.now().toString(36));
  window.location.replace(url.toString());
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

  const categoryMaps = classes.map(buildCategoryMap);

  let classIdx = 0;
  let weekIdx = data.weeks.findIndex((w) => todayIso() >= w.start_date && todayIso() <= w.end_date);
  if (weekIdx === -1) weekIdx = 0;
  // Which day single-day mode is showing. Starts on today, then moves with
  // horizontal swipes; kept across rotations so turning the phone twice
  // doesn't silently jump you back to today.
  let dayIdx = todayIsoWeekday();

  function orientationIsPortrait() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  function render() {
    const school = classes[classIdx];
    const week = data.weeks[weekIdx];
    const weekKey = `${week.year}-W${String(week.week).padStart(2, "0")}`;
    const ctx = lunchContextFor(school, weekKey, categoryMaps[classIdx]);
    const [my, mm, md] = week.start_date.split("-").map(Number);
    const monday = new Date(my, mm - 1, md);
    const portrait = orientationIsPortrait();
    const dayNumbers = portrait ? [dayIdx] : [1, 2, 3, 4, 5];

    renderFitGrid(stageInner, school.weeks[weekKey] || [], ctx, dayNumbers, monday);

    // chrome
    chromeDot.style.background = `var(--school-${classIdx === 0 ? "a" : "b"})`;
    chromeClass.textContent = school.class;
    // Short form in portrait: the full "Måndag 24 augusti" plus a week number
    // plus seven markers overflowed a 390px bar and ellipsised the class name.
    const dayDate = computeDayDates([dayIdx], monday).get(dayIdx);
    chromePeriod.textContent = portrait
      ? `v${week.week} · ${WEEKDAY_NAMES[dayIdx - 1]} ${dayDate ? fmtDate(dayDate) : ""}`
      : weekLabel(week);

    // The horizontal swipe means different things in the two modes, so the
    // marker row shows what it is actually stepping through: weekdays in
    // single-day mode, weeks in the week grid.
    dotsWeek.innerHTML = "";
    if (portrait) {
      for (let d = 1; d <= 5; d++) dotsWeek.appendChild(el("i", { class: d === dayIdx ? "is-active" : "" }));
    } else {
      data.weeks.forEach((_, i) => dotsWeek.appendChild(el("i", { class: i === weekIdx ? "is-active" : "" })));
    }

    dotsClass.innerHTML = "";
    dotsClass.style.display = classes.length > 1 ? "" : "none";
    classes.forEach((_, i) => dotsClass.appendChild(el("i", { class: i === classIdx ? "is-active" : "" })));
  }

  let frame = 0;
  function scheduleRender() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }

  /** Showing one day, a horizontal swipe should walk to the neighbouring day,
   * not skip a whole week — stepping past Friday rolls into the next week's
   * Monday. In the week grid there is no day to step, so it moves weeks. */
  function goHorizontal(dir) {
    if (orientationIsPortrait()) {
      let day = dayIdx + dir;
      let week = weekIdx;
      while (day > 5) {
        day -= 5;
        week += 1;
      }
      while (day < 1) {
        day += 5;
        week -= 1;
      }
      if (week < 0 || week > data.weeks.length - 1) {
        bounce(stage, "x");
        return;
      }
      dayIdx = day;
      weekIdx = week;
    } else {
      const week = clamp(weekIdx + dir, 0, data.weeks.length - 1);
      if (week === weekIdx) {
        bounce(stage, "x");
        return;
      }
      weekIdx = week;
    }
    render();
  }

  function goVertical(dir) {
    const next = clamp(classIdx + dir, 0, classes.length - 1);
    if (next === classIdx) {
      bounce(stage, "y");
      return;
    }
    classIdx = next;
    render();
  }

  attachSwipe(stage, { onHorizontal: goHorizontal, onVertical: goVertical });

  const refreshBtn = document.getElementById("chrome-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hardRefresh(refreshBtn);
    });
    // The stage owns pointer gestures; without this a tap on the button reads
    // as the start of a swipe.
    refreshBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      _measureCache.clear();
      scheduleRender();
    });
  }
  window.addEventListener("resize", scheduleRender);
  window.matchMedia("(orientation: portrait)").addEventListener("change", scheduleRender);
  // Keep the now-line honest on a phone that's left showing the schedule.
  setInterval(scheduleRender, 60000);

  render();
}
