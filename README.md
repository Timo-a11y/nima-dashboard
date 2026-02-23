This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Dagelijkse LinkedIn vacatures per e-mail

Deze repository bevat een automatische flow die dagelijks LinkedIn-vacatures in **Nederland** ophaalt voor:

- **Interim Marketing**
- **Freelance Marketing**
- **Marketing Manager**
- **Campaign Manager**
- **Paid Media Manager**
- **Pl Marketing**

De resultaten worden gemaild naar:

- **tvanzolingen@gmail.com**
- **a.sarhatlic@gmail.com**

### Hoe het werkt

- Script: `scripts/send-linkedin-jobs.mjs`
- NPM command: `npm run jobs:linkedin`
- Scheduler: `.github/workflows/daily-linkedin-vacatures.yml`

De workflow draait dagelijks om **06:00 UTC** (en is ook handmatig te starten via `workflow_dispatch`).

De e-mail is opgebouwd in deze volgorde:

1. **Vacatures van vandaag**
2. **Posts van vandaag** (LinkedIn posts met o.a. "ik zoek {zoekterm}")
3. **Vacatures van eerder die week t/m 10 dagen geleden**
4. **Posts van eerder die week t/m 10 dagen geleden**

Het script forceert resultaten op **Nederland** met:

- LinkedIn locatie (`LINKEDIN_LOCATION`)
- LinkedIn geoId voor Nederland (`LINKEDIN_GEO_ID=102890719`)
- Een extra post-filter dat vacatures buiten Nederland uitsluit
- Post-query op `site:linkedin.com/posts` + phrase (`LINKEDIN_POST_SEARCH_PHRASE`) en NL-validatie

### Vereiste GitHub Secrets

Voeg in je GitHub repository de volgende **Secrets** toe:

- `SMTP_HOST`
- `SMTP_PORT` (bijv. `587` of `465`)
- `SMTP_SECURE` (`true`/`false`)
- `SMTP_USER`
- `SMTP_PASS`

Optionele **Variables**:

- `LINKEDIN_LOCATION` (default script: `Nederland`)
- `LINKEDIN_GEO_ID` (default script: `102890719`, Nederland)
- `LINKEDIN_TIME_RANGE` (default script: `r864000`, laatste 10 dagen)
- `LINKEDIN_MAX_PAGES` (default script: `4`)
- `LINKEDIN_INCLUDE_POSTS` (default script: `true`)
- `LINKEDIN_POST_SEARCH_PHRASE` (default script: `ik zoek`)
- `LINKEDIN_POST_MAX_PER_KEYWORD` (default script: `8`)
- `EMAIL_FROM` (default: `SMTP_USER`)
- `EMAIL_TO` (optioneel, meerdere ontvangers met komma's; default: `tvanzolingen@gmail.com,a.sarhatlic@gmail.com`)

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
