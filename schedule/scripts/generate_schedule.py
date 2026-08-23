#!/usr/bin/env python3
"""Genererar data/schedule.json för schema-sajten.

Hämtar Skola24-schema för innevarande vecka + kommande veckor för alla
klasser i schools.json och skriver resultatet som JSON som sajtens
sidor (index.html + klass-sidorna) läser via fetch().

Körs manuellt:

    python3 scripts/generate_schedule.py

... eller automatiskt av .github/workflows/update-schedule.yml.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from skola24 import Lesson, Skola24Error, get_class_schedule, iso_week_for

SCRIPT_DIR = Path(__file__).parent
DEFAULT_CONFIG = SCRIPT_DIR / "schools.json"
DEFAULT_OUT = SCRIPT_DIR.parent / "data" / "schedule.json"


def load_config(path: Path) -> list[dict]:
    entries = json.loads(path.read_text(encoding="utf-8"))
    for entry in entries:
        for key in ("host", "school", "class"):
            if key not in entry:
                raise ValueError(f"Config-post saknar fältet {key!r}: {entry}")
    return entries


def slugify(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9åäö]+", "-", slug)
    return slug.strip("-") or "schema"


def week_range(year: int, week: int) -> tuple[date, date]:
    start = date.fromisocalendar(year, week, 1)
    end = date.fromisocalendar(year, week, 5)
    return start, end


def lesson_to_dict(lesson: Lesson) -> dict:
    return {
        "subject": lesson.subject,
        "teacher": lesson.teacher,
        "room": lesson.room,
        "day_of_week": lesson.day_of_week,
        "time_start": lesson.time_start[:5],
        "time_end": lesson.time_end[:5],
    }


def build_schedule(entries: list[dict], weeks_ahead: int) -> tuple[dict, bool]:
    today = date.today()
    base_year, base_week = iso_week_for(today)

    weeks: list[dict] = []
    week_keys: list[tuple[int, int]] = []
    year, week = base_year, base_week
    for _ in range(weeks_ahead + 1):
        start, end = week_range(year, week)
        weeks.append(
            {
                "year": year,
                "week": week,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            }
        )
        week_keys.append((year, week))
        year, week = iso_week_for(start + timedelta(days=7))

    schools = []
    ok = True
    for entry in entries:
        name = entry.get("name") or f"{entry['school']} / {entry['class']}"
        slug = slugify(name)
        week_lessons: dict[str, list[dict]] = {}
        for wyear, wweek in week_keys:
            key = f"{wyear}-W{wweek:02d}"
            try:
                lessons = get_class_schedule(entry["host"], entry["school"], entry["class"], wweek, wyear)
            except Skola24Error as exc:
                print(f"Fel för {name} v{wweek}: {exc}", file=sys.stderr)
                ok = False
                lessons = []
            week_lessons[key] = [lesson_to_dict(l) for l in lessons]
        schools.append(
            {
                "name": name,
                "school": entry["school"],
                "class": entry["class"],
                "slug": slug,
                "weeks": week_lessons,
            }
        )

    return {
        "generated_at": today.isoformat(),
        "weeks": weeks,
        "schools": schools,
    }, ok


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generera data/schedule.json från Skola24.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--weeks-ahead", type=int, default=1)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    try:
        entries = load_config(args.config)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"Kunde inte läsa config {args.config}: {exc}", file=sys.stderr)
        return 2
    if not entries:
        print(f"Ingen config hittades på {args.config}.", file=sys.stderr)
        return 2

    schedule, ok = build_schedule(entries, args.weeks_ahead)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Skrev {args.out}", file=sys.stderr)

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
