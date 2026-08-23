# schema

Statisk GitHub Pages-sajt med veckoschema för Lugnetgymnasiet (ES26ESM) och
Tunets skola (TuS-5-26), hämtat från Skola24.

Sajten har en översiktssida (`index.html`) med båda skolorna, samt en egen
sida per klass (`lugnetgymnasiet-es26esm.html`, `tunets-skola-tus-5-26.html`)
— bra att bokmärka på telefonen. Alla sidor visar innevarande och nästa
vecka och läser data från `data/schedule.json`.

## Uppdatera schemat

`data/schedule.json` genereras av `scripts/generate_schedule.py`, som
hämtar schema direkt från Skola24 för klasserna i `scripts/schools.json`.

Körs manuellt:

```
pip install -r scripts/requirements.txt
python3 scripts/generate_schedule.py
git add data/schedule.json
git commit -m "Uppdatera schema"
git push
```

Filen uppdateras även automatiskt varje natt av
[`.github/workflows/update-schedule.yml`](.github/workflows/update-schedule.yml),
som committar och pushar `data/schedule.json` om något ändrats. Eftersom
GitHub Pages byggs direkt från `main` syns nya scheman på sajten så fort
committen är pushad — inget separat deploy-steg behövs.

## Lägga till fler klasser

Redigera `scripts/schools.json` (samma format som i
[daniel-oster/verktyg](https://github.com/daniel-oster/verktyg)s
`skola24-schema`), kör generatorn och skapa en ny `<slug>.html`-sida
(kopiera en befintlig klassida och byt `initClassPage("...")`-anropet
samt titel/rubrik).

## Aktivera GitHub Pages (en gång)

Repo Settings → Pages → Source: **Deploy from a branch** → Branch: `main`,
mapp `/ (root)`. Sajten publiceras sedan på
`https://daniel-oster.github.io/schema/`.

## Struktur

```
index.html                        Översikt, båda skolorna
lugnetgymnasiet-es26esm.html      Egen sida för Lugnetgymnasiet / ES26ESM
tunets-skola-tus-5-26.html        Egen sida för Tunets skola / TuS-5-26
assets/style.css                  Design/tema (ljust + mörkt)
assets/app.js                     Renderar schemat från data/schedule.json
data/schedule.json                Genererad data (innevarande + nästa vecka)
scripts/generate_schedule.py      Hämtar schema från Skola24 och skriver JSON
scripts/skola24.py                Skola24-klient (vendorad kopia)
scripts/schools.json              Vilka skolor/klasser som ska hämtas
.github/workflows/update-schedule.yml  Nattlig auto-uppdatering
```
