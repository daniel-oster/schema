# schema

Samlingsplats för familjens digitala verktyg, publicerade som GitHub Pages.
Roten (`index.html`) är en enkel hubb som länkar vidare — varje verktyg bor
i sin egen mapp. Se [CLAUDE.md](CLAUDE.md) för konventionen kring hur nya
verktyg läggs till.

## schedule/ — Veckoschema

Statisk sajt med veckoschema för Lugnetgymnasiet (ES26ESM) och Tunets skola
(TuS-5-26), hämtat från Skola24. Ligger på
`https://daniel-oster.github.io/schema/schedule/`.

Sajten har en översiktssida (`schedule/index.html`) med båda skolorna, samt
en egen sida per klass (`schedule/lugnetgymnasiet-es26esm.html`,
`schedule/tunets-skola-tus-5-26.html`) — bra att bokmärka på telefonen.
Alla sidor visar innevarande och nästa vecka och läser data från
`schedule/data/schedule.json`.

### Uppdatera schemat

`schedule/data/schedule.json` genereras av
`schedule/scripts/generate_schedule.py`, som hämtar schema direkt från
Skola24 för klasserna i `schedule/scripts/schools.json`.

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
`skola24-schema`), kör generatorn och skapa en ny `<slug>.html`-sida i
`schedule/` (kopiera en befintlig klassida och byt
`initClassPage("...")`-anropet samt titel/rubrik).

### Struktur

```
schedule/index.html                        Översikt, båda skolorna
schedule/lugnetgymnasiet-es26esm.html      Egen sida för Lugnetgymnasiet / ES26ESM
schedule/tunets-skola-tus-5-26.html        Egen sida för Tunets skola / TuS-5-26
schedule/assets/style.css                  Design/tema (ljust + mörkt)
schedule/assets/app.js                     Renderar schemat från data/schedule.json
schedule/data/schedule.json                Genererad data (innevarande + nästa vecka)
schedule/scripts/generate_schedule.py      Hämtar schema från Skola24 och skriver JSON
schedule/scripts/skola24.py                Skola24-klient (vendorad kopia)
schedule/scripts/schools.json              Vilka skolor/klasser som ska hämtas
```

## Aktivera GitHub Pages (en gång)

Repo Settings → Pages → Source: **Deploy from a branch** → Branch: `main`,
mapp `/ (root)`. Sajten publiceras sedan på
`https://daniel-oster.github.io/schema/`.
