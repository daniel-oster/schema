"""Hämtar skolmatsedlar från Matilda Menu (menu.matildaplatform.com).

Sidan `/meals/week/<distributor-id>` är statiskt genererad och innehåller
ingen matsedel i sin HTML — frontend hämtar veckans måltider klientsidan
från `/api/menu`, samma JSON-endpoint som denna modul anropar direkt.
`distributor-id` i schools.json/URL:en är `<id>_<skolnamn>` (för
läsbarhet); API:et vill bara ha `<id>`, så suffixet klipps bort här,
precis som sidans egen kod gör (`id.split("_")[0]`).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta

import requests

BASE_URL = "https://menu.matildaplatform.com"


class MatildaMenuError(Exception):
    """Fel vid hämtning eller tolkning av en matsedel."""


@dataclass
class Course:
    name: str
    option_name: str | None
    tags: list[str] = field(default_factory=list)


@dataclass
class DayMenu:
    date: date
    description: str | None
    courses: list[Course] = field(default_factory=list)


def iso_week_monday(year: int, week: int) -> date:
    """Måndagen i ett givet ISO-år/vecka."""
    return date.fromisocalendar(year, week, 1)


def fetch_week_menu(distributor_id: str, monday: date) -> list[DayMenu]:
    """Hämtar matsedeln för veckan som börjar på `monday`."""
    sunday = monday + timedelta(days=6)
    bare_id = distributor_id.split("_", 1)[0]
    params = {
        "distributorId": bare_id,
        "startDate": monday.isoformat(),
        "endDate": sunday.isoformat(),
        "lang": "sv",
    }

    try:
        resp = requests.get(f"{BASE_URL}/api/menu", params=params, timeout=15)
    except requests.RequestException as exc:
        raise MatildaMenuError(f"Kunde inte hämta matsedel: {exc}") from exc

    if resp.status_code == 404:
        raise MatildaMenuError(f"Hittade ingen matsedel för distributor-id {distributor_id!r} (kontrollera id:t).")
    try:
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise MatildaMenuError(f"Kunde inte hämta matsedel: {exc}") from exc

    try:
        meals = resp.json()["meals"]
    except (json.JSONDecodeError, KeyError) as exc:
        raise MatildaMenuError(f"Oväntat svarsformat från Matilda Menu: {exc}") from exc

    days = []
    for meal in meals:
        meal_date = date.fromisoformat(meal["date"][:10])
        courses = [
            Course(
                name=course.get("name") or "",
                option_name=course.get("optionName"),
                tags=[tag.get("name") for tag in course.get("tags", []) if tag.get("name")],
            )
            for course in meal.get("courses", [])
            if course.get("name")
        ]
        days.append(DayMenu(date=meal_date, description=meal.get("description"), courses=courses))
    return days
