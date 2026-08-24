# schema

This repo is a GitHub Pages site (`https://daniel-oster.github.io/schema/`)
that hosts small, self-contained tools for the family. It is **not** a
single app — it's a hub. The root `index.html` is a lightweight landing
page that links to each tool; every tool lives in its own top-level
folder and owns everything it needs (markup, styles, JS, data,
generator scripts). Don't add a shared build system or a shared
component library across tools — each folder should stay independently
understandable and deployable by just being static files under it.

Pages is configured to deploy from the `main` branch, root (`/`).
Anything committed to `main` is live within a minute or two — there is
no build step and no separate deploy job for the static files
themselves.

## Adding a new tool

1. Create `<tool-name>/` at the repo root.
2. Put its `index.html` (and any other pages, `assets/`, `data/`, a
   `scripts/` generator if it needs one) inside that folder, using
   relative paths so the folder works if it's ever moved.
3. Add a card to the root `index.html`'s `.tools` list linking to
   `<tool-name>/`. If the tool has meaningful sub-destinations (the way
   Veckoschema has one page per class), hang them off that card as a
   `.tool-links` list rather than adding them as sibling cards — they
   are ways into one tool, not separate tools.
4. If the tool needs to vendor logic from another repo (e.g. a client
   library from `daniel-oster/verktyg`), copy the minimal amount needed
   into `<tool-name>/scripts/` rather than adding a cross-repo runtime
   dependency — this repo should be deployable on its own.
5. If the tool's data needs to refresh on a schedule, add a GitHub
   Actions workflow scoped to that folder's paths (see
   `.github/workflows/update-schedule.yml` for the pattern: install
   deps, run the generator, commit the output file if it changed, push).

## schedule/ — Veckoschema

A weekly timetable viewer for two Skola24-tracked classes:
Lugnetgymnasiet (`ES26ESM`) and Tunets skola (`TuS-5-26`). Its origin
tool, `skola24-schema`, lives in `daniel-oster/verktyg` (a personal CLI
toolbox) — this folder vendors a copy of that Skola24 client so the
Pages deployment doesn't depend on that other repo being present or
stable.

This is a **swipeable, fit-to-screen app**, not a scrolling page — the
whole thing is one fixed-viewport "stage" (see `.stage` in
`style.css`), because a scrolling multi-day grid turned out to be
unusable on a phone. Nothing on `schedule/*.html` ever scrolls; swiping
changes what's showing instead:

- **Landscape** → the whole week (Mon–Fri), sized to fit exactly.
- **Portrait** → one day at a time — a full week is too narrow to read
  in portrait, so don't try to cram it in; single-day is the deliberate
  portrait behavior, not a fallback. It opens on today (clamped to
  Mon–Fri).
- Swipe **left/right** (or press ←/→) → **whatever the mode is showing**:
  the previous/next *week* in the week grid, the previous/next *day* in
  single-day mode, rolling past Friday into the next week's Monday. The
  marker row in the chrome bar switches to match (weekdays vs. weeks) so
  the gesture is never ambiguous. Stepping a whole week when the screen
  shows a single day is the wrong unit and was reported as broken —
  don't reintroduce it.
- Swipe **up/down** (or press ↑/↓) → previous/next class (no-op on a
  locked single-class page, see below).

Nothing scrolls, in either mode, which is *why* the fit-to-screen and
minimum-legibility work below has to hold: if a block doesn't fit, there
is no scrollbar to reach it with, and the vertical gesture belongs to
class switching.

Structure:

- `schedule/index.html` — the app, unlocked: swipe through every class
  in `schools.json`.
- `schedule/<slug>.html` — the same app **locked** to one class (e.g.
  `lugnetgymnasiet-es26esm.html` calls `initApp({ lockedSlug:
  "lugnetgymnasiet-es26esm" })`) — vertical swipe/the class dot-row is
  disabled since there's only one class to show; week swipe still
  works. These are the direct links meant for bookmarking one kid's
  schedule to a home screen.
- `schedule/links.html` — a plain static (mostly no-JS) page listing
  every URL above, for whoever just wants a link rather than the app.
  Update it by hand when adding/removing a class (see below) — it does
  not read `schools.json`.
- `schedule/assets/style.css` — design tokens (light + dark themes),
  the `.stage`/`.chrome` app shell, and the day-grid/lesson/modal
  component styles. The visual direction is a **departure board**:
  square corners everywhere (there is no `border-radius` anywhere in
  this repo — keep it that way), a mono hour rail, hairline day
  columns, and lessons as flat slabs with a solid signal bar down the
  left edge. Subject colour comes from twelve `--cat-*` swatches;
  "today" and the now-line are drawn in `--ink` (plain black/white)
  precisely so they can never be mistaken for a subject. Lunch is
  deliberately *not* a subject colour — it uses the neutral
  `--lunch-*` tokens so the teaching day is the coloured thing.
- `schedule/assets/app.js` — `initApp({ lockedSlug? })` loads
  `data/schedule.json`, then `renderFitGrid` draws the grid sized
  exactly to `#stage-inner`'s real pixel box (`getBoundingClientRect`)
  for the current class/week/orientation — not a fixed px-per-hour, so
  it always fills the screen with no scroll.

  The layout exists to answer one question: *can you read every block
  without tapping it?* Four things serve that, and each is easy to
  regress:

  1. `mergeLessons` folds Skola24's duplicate multi-teacher rows, then
     `coalesceRuns` glues **contiguous rows of the same
     subject/teacher/room** back into one block. Skola24 splits a
     double period into e.g. 09:40–09:50 plus 09:50–10:40; rendered
     literally that's an unlabellable 10-minute sliver. It matches on a
     key rather than on "the previous block", because a parallel course
     often starts between a run's two halves.
  2. `layoutColumns` splits a day into **clusters that actually
     overlap** and gives each cluster its own column count, then lets a
     block expand rightwards over columns nothing occupies. Laying a
     whole day out on the day's worst-case column count squeezes every
     block to half width because two courses clash once at 10:40.
  3. `enforceMinHeights` guarantees `MIN_BLOCK_H`, pushing later blocks
     in the same column down and pinning the last one to the bottom
     edge, so a 20-minute lesson is legible without covering its
     neighbour.
  4. `contentPlan` **measures** text against the fonts the browser
     really resolved (canvas `measureText`, `wrapCount`) and steps the
     type down through `TYPE_STEPS` until the subject genuinely fits;
     only then does it spend leftover lines on the time and the
     teacher/room. Never swap this back for an average-glyph-width
     estimate — the fallback face when Google Fonts fails is much wider
     than Archivo Narrow, which is also why the app re-renders on
     `document.fonts.ready`. `splitSubject` strips Skola24's
     ", Nivå 1b" suffix off the headline and shows it as metadata,
     which is most of the width the subject needs.

  Colour is assigned per school by `buildCategoryMap`, which walks the
  sorted subject list so the twelve swatches are spread evenly, then
  nudges any pair that actually overlaps in time off a shared slot
  (Svenska vs. Svenska som andraspråk). The nudge is decided once per
  school, not per day, so a subject looks the same on every day of every
  week. Hashing each subject name independently was tried because it
  survives the nightly regeneration unchanged — but it clusters: six of
  ES26ESM's subjects landed in the blue-green corner and the whole week
  read as one colour. Even spread won; the cost is that colours can
  shift when a genuinely new subject enters the data window. A lunch block's headline is the **dish**, tagged
  `LUNCH hh:mm` in its time line (there is no separate lunch chip in
  the day header any more — it truncated the menu and stole height from
  the grid); if the dish can't fit even at the smallest type step it
  falls back to the word "Lunch" rather than ellipsing a menu into
  nonsense. Tapping any lesson opens a bottom-sheet modal
  (`openModal`/`buildLessonModal`) with full detail — phone-first, so
  it's a bottom sheet anchored to the thumb, not a centered dialog.
  `attachSwipe` reads pointer events on `#stage` (works for touch and
  mouse, so it's testable with a mouse drag too) and also binds arrow
  keys for keyboard/desktop use.
- `schedule/data/schedule.json` — generated data. Never hand-edit;
  regenerate it instead (see below). Structure: `weeks` (list of
  `{year, week, start_date, end_date}`) and `schools` (list of
  `{name, school, class, slug, weeks: {"<year>-W<week>": [lesson, ...]},
  lunch: {"<year>-W<week>": {"<isoweekday>": [{name, vegetarian}, ...]}},
  lunch_note}`). `lunch`/`lunch_note` are only present for schools whose
  config entry has a `lunch_id`.
- `schedule/scripts/generate_schedule.py` — fetches current + next
  week (configurable via `--weeks-ahead`) from Skola24 for every entry
  in `schedule/scripts/schools.json` and writes `schedule/data/schedule.json`.
  For entries with a `lunch_id`, also fetches that week's lunch menu
  from Matilda Menu and attaches it under `lunch`/`lunch_note`. Skola24
  lists an explicit "Lunch" lesson for some schools (Lugnetgymnasiet)
  but not others (grundskolor, e.g. Tunets skola, just leave a gap
  around midday). When a day has a fetched menu but no explicit lunch
  lesson, `add_inferred_lunch`/`infer_lunch_gap` synthesize one from the
  widest schedule gap inside a ~10:00–13:30 window, tagged
  `"inferred": true`. The frontend carries that flag through
  (`mergeLessons`/`coalesceRuns` in `app.js`) and both marks the block visually
  (`.lesson.is-inferred`, a dashed/hatched border) and says so in its
  modal — it's a guess from the day's timetable shape, not official
  Skola24 data, so never present it as equally authoritative.
- `schedule/scripts/skola24.py` — the vendored Skola24 client (same
  code as `verktyg`'s `skola24-schema/skola24.py`). If you fix a bug in
  one, port it to the other.
- `schedule/scripts/matilda_menu.py` — the vendored Matilda Menu client
  (same code as `verktyg`'s `skolmat/matilda_menu.py`). Same porting
  rule as above.
- `schedule/scripts/schools.json` — which host/school/class combos to
  fetch, same format as `verktyg`'s `skola24-schema/schools.json`, plus
  an optional `lunch_id` (a Matilda Menu distributor id, same format as
  `verktyg`'s `skolmat/schools.json`) to pull that school's lunch menu
  in too. Omit `lunch_id` for a school with no menu to show.

Regenerating data:

```
pip install -r schedule/scripts/requirements.txt
python3 schedule/scripts/generate_schedule.py
```

`.github/workflows/update-schedule.yml` does this nightly (04:00 UTC)
and on pushes touching `schedule/scripts/**`, committing
`schedule/data/schedule.json` back to `main` if it changed. Because
Pages serves `main` directly, that commit is the deploy.

Adding a class: edit `schedule/scripts/schools.json`, regenerate, then
copy an existing `schedule/<slug>.html` to a new slug, update its
`initApp({ lockedSlug: "..." })` call and `<title>`, and add a row for
it to **both** `schedule/links.html` and the `.tool-links` list under
the Veckoschema card in the root `index.html`. Both are hand-maintained
— neither is generated from `schools.json`.

## Checking the layout

`schedule/scripts/check_layout.mjs` is the guard on the one property the
grid exists for: **can you read every block without tapping it?** Run it
after any change to `app.js`, `style.css`, or the data shape:

```
node schedule/scripts/check_layout.mjs             # assert; exits 1 on failure
node schedule/scripts/check_layout.mjs --verbose   # print every case
node schedule/scripts/check_layout.mjs --shots out # also write PNGs to out/
```

It sweeps every class x week x weekday x viewport x theme (292 checks
today, and it reads the class and week counts out of `data/schedule.json`,
so adding a class widens the sweep automatically) and fails on a clipped
subject, two lessons overlapping, a block escaping the grid box, a grid
that does not fit its container, **a truncated chrome bar**, or any page
error. It also pins the clock to a weekday
inside the data range so the "today" column and the now-line actually
render — those states are invisible on a weekend and were shipped
unverified once because of it.

Do not eyeball this instead. The failure mode is a single subject silently
ellipsed to "S." at one screen size, in one theme, on one week, for one
class; there are far too many combinations to catch by looking.

It needs Playwright and Chromium:

```
npm i -D playwright && npx playwright install chromium
```

In a sandbox that ships Chromium already, set `PLAYWRIGHT_BROWSERS_PATH`
and skip the download — the script globs that directory for the versioned
`chromium-*/chrome-linux/chrome` rather than hard-coding a version, and
resolves the Playwright module from a global install if there is no local
one (`NODE_PATH=/opt/node22/lib/node_modules` in Claude Code on the web).

**The webfont caveat.** Sandboxes usually cannot reach Google Fonts, so a
run there measures against the fallback face and says so at the end. That
is the *wider* face, so a pass without the webfont still holds with it —
but the screenshots are then not what a phone renders, and judging colour
or density from them will mislead you.

To render what a phone actually gets, cache the fonts once with a tool
that *can* reach the network (curl works where Chromium's proxy does not)
and point the check at the directory:

```
mkdir -p /tmp/fc && cd /tmp/fc
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
  (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  "$(grep -o 'https://fonts.googleapis.com/css2[^\"]*' \
     "$OLDPWD/schedule/index.html")" -o fonts.css
grep -o 'https://fonts.gstatic.com[^)]*' fonts.css | sort -u | \
  while read -r u; do f="$(basename "$u")"; curl -s "$u" -o "$f"; \
    sed -i "s|$u|/__fonts/$f|g" fonts.css; done

FONT_CACHE=/tmp/fc node schedule/scripts/check_layout.mjs --shots out
```

The script serves that directory at `/__fonts/` and rewrites the Google
Fonts link in each page to point at it. Without `FONT_CACHE` nothing
changes — it just falls back to the fallback face.
