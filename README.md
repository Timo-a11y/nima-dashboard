This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Dagelijkse LinkedIn vacatures per e-mail

Deze repository bevat nu een automatische flow die dagelijks LinkedIn-vacatures voor **"Appointment Setter"** ophaalt en mailt naar **suuz@studiobenedek.nl** en **tvanzolingen@gmail.com**.
Standaard zoekt het script in **Netherlands**, **Belgium** en **United States**.
Daarnaast zoekt het script ook in LinkedIn-posts op signalen zoals **"looking for"**, **"hiring"**, **"op zoek naar"** en **"ik zoek"** met je zoekterm.
Resultaten worden in de mail opgesplitst op:
- **Nieuw** (vandaag)
- **Eerder deze week** (in de afgelopen 10 dagen en items met onbekende datum)

Als er geen recente posts gevonden worden, voegt de flow automatisch oudere relevante posts toe als fallback (met duidelijke melding in de mail).

Sortering in de mail:
- Eerst **Nederlandse** bijdrages, dan **Belgische**, dan **Amerikaanse**
- Binnen die volgorde eerst titels met **Appointment Setter**, daarna soortgelijke titels
- Irrelevante rollen (zoals technische tekenaar/CAD/engineer) worden actief uitgefilterd
- Vacatures én posts blijven zichtbaar; voor vacatures is de filter iets ruimer zodat relevante sales/setting varianten behouden blijven

### Hoe het werkt

- Script: `scripts/send-linkedin-jobs.mjs`
- NPM command: `npm run jobs:linkedin`
- Scheduler: `.github/workflows/daily-linkedin-vacatures.yml`

De workflow draait dagelijks om **06:00 UTC** (en is ook handmatig te starten via `workflow_dispatch`).

### Vereiste GitHub Secrets

Voeg in je GitHub repository de volgende **Secrets** toe:

- `SMTP_HOST`
- `SMTP_PORT` (bijv. `587` of `465`)
- `SMTP_SECURE` (`true`/`false`)
- `SMTP_USER`
- `SMTP_PASS`

Optionele **Variables**:

- `LINKEDIN_LOCATIONS` (komma-gescheiden; default: `Netherlands,Belgium,United States`)
- `LINKEDIN_LOCATION` (legacy single-location fallback)
- `LINKEDIN_TIME_RANGE` (default script: `r864000`, laatste 10 dagen)
- `LINKEDIN_MAX_PAGES` (default script: `4`)
- `LINKEDIN_POSTS_ENABLED` (default: `true`)
- `LINKEDIN_POSTS_MAX_RESULTS` (default: `20`)
- `EMAIL_FROM` (default: `SMTP_USER`)
- `EMAIL_TO` (optioneel, meerdere ontvangers met komma's; default: `suuz@studiobenedek.nl,tvanzolingen@gmail.com`)

### Lokaal testen

1. Zet bovenstaande waarden als environment variables in je shell.
2. Run:

```bash
npm run jobs:linkedin
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
