"""Hämtar skolmatsedlar från Matilda Menu (menu.matildaplatform.com).

Matilda Menu är en Next.js-app som server-renderar sidan
`/meals/week/<distributor-id>` med all data inbäddad i ett
`__NEXT_DATA__`-script-block. Den datan parsas härifrån istället för att
skrapa synlig HTML.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

import requests

BASE_URL = "https://menu.matildaplatform.com"
NEXT_DATA_RE = re.compile(r'__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


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
    url = f"{BASE_URL}/meals/week/{distributor_id}"
    params = {"startDate": monday.isoformat(), "endDate": sunday.isoformat()}

    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise MatildaMenuError(f"Kunde inte hämta matsedel: {exc}") from exc

    match = NEXT_DATA_RE.search(resp.text)
    if not match:
        raise MatildaMenuError("Kunde inte tolka svaret från Matilda Menu (hittade inte __NEXT_DATA__).")

    try:
        data = json.loads(match.group(1))
        page_props = data["props"]["pageProps"]
    except (json.JSONDecodeError, KeyError) as exc:
        raise MatildaMenuError(f"Oväntat svarsformat från Matilda Menu: {exc}") from exc

    if "meals" not in page_props:
        raise MatildaMenuError(f"Hittade ingen matsedel för distributor-id {distributor_id!r} (kontrollera id:t).")

    days = []
    for meal in page_props["meals"]:
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
