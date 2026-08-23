"""Litet klientbibliotek för att hämta scheman från Skola24 (web.skola24.se).

Skola24 exponerar inget publikt dokumenterat API, men samma anrop som
webbläsaren gör mot web.skola24.se kan användas direkt. Flödet är:

1. Hämta en sessionscookie genom att besöka timetable-viewer-sidan.
2. Hämta en "render key" (krävs för att rendera ett schema).
3. Slå upp skolans (unit) guid via skolans värdnamn, t.ex. falun.skola24.se.
4. Slå upp aktivt läsårs-guid för skolan.
5. Slå upp klassens (group) guid bland skolans klasser.
6. Rendera schemat för en given vecka -> en lista med lektioner.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

BASE_URL = "https://web.skola24.se"
X_SCOPE = "8a22163c-8662-4535-9050-bc5e1923df48"


class Skola24Error(RuntimeError):
    """Fel vid kommunikation med Skola24 eller om skola/klass inte hittas."""


@dataclass
class Lesson:
    subject: str
    teacher: str
    room: str
    day_of_week: int  # 1 = måndag .. 5 = fredag
    time_start: str  # "HH:MM:SS"
    time_end: str  # "HH:MM:SS"

    @property
    def time_range(self) -> str:
        return f"{self.time_start[:5]}-{self.time_end[:5]}"


class Skola24Client:
    """Klient för ett enskilt skolvärdnamn, t.ex. falun.skola24.se."""

    def __init__(self, host: str, timeout: float = 15.0):
        self.host = host
        self.timeout = timeout
        self.session = requests.Session()
        self._warmed_up = False

    def _post(self, path: str, body: dict, response_key: Optional[str] = None) -> dict:
        self._warm_up()
        try:
            resp = self.session.post(
                f"{BASE_URL}/{path}",
                json=body,
                headers={"X-Scope": X_SCOPE},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            envelope = resp.json()
        except requests.RequestException as exc:
            raise Skola24Error(f"Nätverksfel mot Skola24 ({path}): {exc}") from exc

        if envelope.get("exception"):
            raise Skola24Error(f"Skola24 svarade med fel för {path}: {envelope['exception']}")
        if envelope.get("validation"):
            raise Skola24Error(f"Skola24 avvisade anropet mot {path}: {envelope['validation']}")

        data = envelope.get("data") or {}
        if response_key is None:
            return data

        value = data.get(response_key)
        if value is None:
            problems = data.get("validationErrors") or data.get("errors")
            if problems:
                raise Skola24Error(f"Skola24 avvisade anropet mot {path}: {problems}")
            raise Skola24Error(f"Skola24 gav inget svar för {path} (tomt {response_key!r}).")
        return value

    def _warm_up(self) -> None:
        # Skola24 sätter sessionscookies (bl.a. s24_tenant) när
        # timetable-viewer-sidan besöks första gången. Utan dem svarar
        # API:et med fel längre fram i flödet.
        if self._warmed_up:
            return
        self.session.get(
            f"{BASE_URL}/timetable/timetable-viewer/{self.host}/",
            timeout=self.timeout,
        )
        self._warmed_up = True

    def render_key(self) -> str:
        data = self._post("api/get/timetable/render/key", {})
        return data["key"]

    def list_units(self) -> list[dict]:
        response = self._post(
            "api/services/skola24/get/timetable/viewer/units",
            {"getTimetableViewerUnitsRequest": {"hostName": self.host}},
            response_key="getTimetableViewerUnitsResponse",
        )
        return response.get("units") or []

    def find_unit(self, school_name: str) -> dict:
        needle = school_name.strip().lower()
        units = self.list_units()
        for unit in units:
            if unit["unitId"].strip().lower() == needle:
                return unit
        matches = [u for u in units if needle in u["unitId"].strip().lower()]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            names = ", ".join(u["unitId"] for u in units)
            raise Skola24Error(
                f"Hittade ingen skola som matchar {school_name!r} på {self.host}. "
                f"Tillgängliga skolor: {names}"
            )
        names = ", ".join(u["unitId"] for u in matches)
        raise Skola24Error(f"{school_name!r} matchar flera skolor på {self.host}: {names}")

    def active_school_year_guid(self) -> str:
        data = self._post(
            "api/get/active/school/years",
            {"hostName": self.host, "checkSchoolYearsFeatures": False},
        )
        years = data.get("activeSchoolYears") or []
        if not years:
            raise Skola24Error(f"Inget aktivt läsår hittades för {self.host}")
        return years[0]["guid"]

    def list_classes(self, unit_guid: str) -> list[dict]:
        data = self._post(
            "api/get/timetable/selection",
            {"hostName": self.host, "unitGuid": unit_guid, "filters": {"class": True}},
        )
        return data.get("classes") or []

    def find_class(self, unit_guid: str, class_name: str) -> dict:
        needle = class_name.strip().lower()
        classes = self.list_classes(unit_guid)
        for group in classes:
            if group["groupName"].strip().lower() == needle:
                return group
        names = ", ".join(g["groupName"] for g in classes)
        raise Skola24Error(
            f"Hittade ingen klass som matchar {class_name!r}. Tillgängliga klasser: {names}"
        )

    def render_timetable(
        self,
        unit_guid: str,
        school_year_guid: str,
        selection_guid: str,
        week: int,
        year: int,
        selection_type: int = 0,
    ) -> list[Lesson]:
        body = {
            "renderKey": self.render_key(),
            "host": self.host,
            "unitGuid": unit_guid,
            "schoolYear": school_year_guid,
            "startDate": None,
            "endDate": None,
            "scheduleDay": 0,
            "blackAndWhite": False,
            "width": 1200,
            "height": 850,
            "selectionType": selection_type,
            "selection": selection_guid,
            "showHeader": True,
            "week": week,
            "year": year,
            "periodText": "",
            "privateFreeTextMode": None,
            "privateSelectionMode": False,
        }
        data = self._post("api/render/timetable", body)
        lesson_info = data.get("lessonInfo") or []
        lessons = []
        for entry in lesson_info:
            texts = entry.get("texts") or []
            subject = texts[0] if len(texts) > 0 else ""
            teacher = texts[1] if len(texts) > 1 else ""
            room = texts[2] if len(texts) > 2 else ""
            lessons.append(
                Lesson(
                    subject=subject,
                    teacher=teacher,
                    room=room,
                    day_of_week=entry["dayOfWeekNumber"],
                    time_start=entry["timeStart"],
                    time_end=entry["timeEnd"],
                )
            )
        lessons.sort(key=lambda l: (l.day_of_week, l.time_start))
        return lessons


def get_class_schedule(
    host: str,
    school_name: str,
    class_name: str,
    week: int,
    year: int,
) -> list[Lesson]:
    """Slår upp skola + klass på given Skola24-host och hämtar veckoschemat."""
    client = Skola24Client(host)
    unit = client.find_unit(school_name)
    school_year_guid = client.active_school_year_guid()
    group = client.find_class(unit["unitGuid"], class_name)
    return client.render_timetable(
        unit_guid=unit["unitGuid"],
        school_year_guid=school_year_guid,
        selection_guid=group["groupGuid"],
        week=week,
        year=year,
    )


def iso_week_for(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return iso.year, iso.week


def weekday_number(d: date) -> int:
    """1 = måndag .. 7 = söndag, samma som Skola24:s dayOfWeekNumber."""
    return d.isoweekday()
