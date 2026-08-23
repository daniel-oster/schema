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
   `<tool-name>/`.
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

Structure:

- `schedule/index.html` — overview page showing both schools' schedules
  together, current + next week, with a week switcher.
- `schedule/<slug>.html` — one page per class (e.g.
  `lugnetgymnasiet-es26esm.html`), same rendering, focused on a single
  class — meant to be bookmarked on a phone home screen.
- `schedule/assets/style.css` — design tokens (light + dark themes) and
  layout for the timetable grid.
- `schedule/assets/app.js` — fetches `data/schedule.json` and renders
  the proportional day-grid (lessons positioned by actual time, merges
  Skola24's duplicate multi-teacher rows, splits genuinely overlapping
  lessons into side-by-side columns, color-codes by subject).
- `schedule/data/schedule.json` — generated data. Never hand-edit;
  regenerate it instead (see below). Structure: `weeks` (list of
  `{year, week, start_date, end_date}`) and `schools` (list of
  `{name, school, class, slug, weeks: {"<year>-W<week>": [lesson, ...]}}`).
- `schedule/scripts/generate_schedule.py` — fetches current + next
  week (configurable via `--weeks-ahead`) from Skola24 for every entry
  in `schedule/scripts/schools.json` and writes `schedule/data/schedule.json`.
- `schedule/scripts/skola24.py` — the vendored Skola24 client (same
  code as `verktyg`'s `skola24-schema/skola24.py`). If you fix a bug in
  one, port it to the other.
- `schedule/scripts/schools.json` — which host/school/class combos to
  fetch. Same format as `verktyg`'s `skola24-schema/schools.json`.

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
copy an existing `schedule/<slug>.html` to a new slug and update its
`initClassPage("...")` call and heading/title text.
