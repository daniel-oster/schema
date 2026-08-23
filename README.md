# schema

Samlingsplats för familjens digitala verktyg, publicerade som GitHub Pages.
Roten (`index.html`) är en enkel hubb som länkar vidare — varje verktyg bor
i sin egen mapp. Se [CLAUDE.md](CLAUDE.md) för konventionen kring hur nya
verktyg läggs till.

## schedule/ — Veckoschema

Statisk sajt med veckoschema för Lugnetgymnasiet (ES26ESM) och Tunets skola
(TuS-5-26), hämtat från Skola24. Ligger på
`https://daniel-oster.github.io/schema/schedule/`.

Byggd som en app, inte en sida man scrollar — allt syns på en skärm:

- **Landskapsläge** visar hela veckan (mån–fre).
- **Porträttläge** visar bara idag (samma veckodag följer med om man
  byter vecka).
- Svep **vänster/höger** (eller ←/→) för innevarande/nästa vecka.
- Svep **upp/ner** (eller ↑/↓) för att byta skola.
- Tryck på ett pass (eller en dags lunch-chip) för en bottom sheet med
  mer info — lärare, sal och, om skolan har ett `lunch_id`
  konfigurerat, dagens matsedel från Matilda Menu.

Tre typer av sidor i `schedule/`:

- `schedule/index.html` — appen, svep mellan alla skolor/klasser.
- `schedule/lugnetgymnasiet-es26esm.html`,
  `schedule/tunets-skola-tus-5-26.html` — samma app men låst till en
  klass (svep upp/ner gör inget) — direktlänkar att bokmärka på
  hemskärmen.
- `schedule/links.html` — en enkel, statisk sida med alla länkar ovan,
  för den som bara vill ha en länk att dela eller spara.

### Uppdatera schemat

`schedule/data/schedule.json` genereras av
`schedule/scripts/generate_schedule.py`, som hämtar schema direkt från
Skola24 för klasserna i `schedule/scripts/schools.json`, och (för
klasser med ett `lunch_id`) lunchmeny från Matilda Menu.

Körs manuellt:

```
pip install -r schedule/scripts/requirements.txt
python3 schedule/scripts/generate_schedule.py
git add schedule/data/schedule.json
git commit -m "Uppdatera schema"
git push
```

Filen uppdateras även automatiskt varje natt av
[`.github/workflows/update-schedule.yml`](.github/workflows/update-schedule.yml),
som committar och pushar `schedule/data/schedule.json` om något ändrats.
Eftersom GitHub Pages byggs direkt från `main` syns nya scheman på sajten
så fort committen är pushad — inget separat deploy-steg behövs.

### Lägga till fler klasser

Redigera `schedule/scripts/schools.json` (samma format som i
[daniel-oster/verktyg](https://github.com/daniel-oster/verktyg)s
`skola24-schema`), kör generatorn, skapa en ny `<slug>.html`-sida i
`schedule/` (kopiera en befintlig klassida, byt
`initApp({ lockedSlug: "..." })`-anropet samt titel), och lägg till en
länk för den i `schedule/links.html` (den sidan är handskriven, inte
genererad).

### Struktur

```
schedule/index.html                        Appen, svep mellan alla skolor
schedule/lugnetgymnasiet-es26esm.html      Låst till Lugnetgymnasiet / ES26ESM
schedule/tunets-skola-tus-5-26.html        Låst till Tunets skola / TuS-5-26
schedule/links.html                        Statisk sida med alla länkar
schedule/assets/style.css                  Design/tema + app-skal (ljust + mörkt)
schedule/assets/app.js                     Svep-motor + renderar schemat mot skärmen
schedule/data/schedule.json                Genererad data (innevarande + nästa vecka)
schedule/scripts/generate_schedule.py      Hämtar schema (+ lunch) och skriver JSON
schedule/scripts/skola24.py                Skola24-klient (vendorad kopia)
schedule/scripts/matilda_menu.py           Matilda Menu-klient (vendorad kopia)
schedule/scripts/schools.json              Vilka skolor/klasser (+ ev. lunch_id) som ska hämtas
```

## Aktivera GitHub Pages (en gång)

Repo Settings → Pages → Source: **Deploy from a branch** → Branch: `main`,
mapp `/ (root)`. Sajten publiceras sedan på
`https://daniel-oster.github.io/schema/`.
