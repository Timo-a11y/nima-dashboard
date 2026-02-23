import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const DEFAULT_KEYWORDS = "Appointment Setter";
const DEFAULT_RECIPIENTS = "suuz@studiobenedek.nl,tvanzolingen@gmail.com";
const DEFAULT_TIME_RANGE = "r86400"; // Last 24 hours on LinkedIn.
const PAGE_SIZE = 25;
const REQUEST_DELAY_MS = 1200;

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined) return fallback;

  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function readNumberEnv(name, fallback) {
  const value = readEnv(name, "");
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function requiredEnv(name) {
  const value = readEnv(name, "");
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeLinkedInUrl(input) {
  try {
    const parsed = new URL(input);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return input;
  }
}

function buildSearchUrl({ keywords, location, start, timeRange }) {
  const params = new URLSearchParams({
    keywords,
    start: String(start),
    sortBy: "DD",
    f_TPR: timeRange,
  });

  if (location) {
    params.set("location", location);
  }

  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
}

function extractJobsFromHtml(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $("li").each((_, li) => {
    const element = $(li);
    const title = element.find("h3.base-search-card__title").text().trim();
    const company = element.find("h4.base-search-card__subtitle").text().trim();
    const location = element.find(".job-search-card__location").text().trim();
    const postedAt = element.find("time").attr("datetime") || element.find("time").text().trim();
    const href =
      element.find("a.base-card__full-link").attr("href") ||
      element.find("a").first().attr("href") ||
      "";
    const link = normalizeLinkedInUrl(href);

    if (!title || !link) {
      return;
    }

    jobs.push({
      title,
      company: company || "Unknown company",
      location: location || "Unknown location",
      postedAt: postedAt || "Unknown date",
      link,
    });
  });

  return jobs;
}

function uniqueJobs(items) {
  const deduped = [];
  const seen = new Set();

  for (const item of items) {
    const key = item.link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeLinkedInJobs({ keywords, location, timeRange, maxPages }) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const allJobs = [];

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * PAGE_SIZE;
    const url = buildSearchUrl({ keywords, location, start, timeRange });
    console.log(`[linkedin] Fetching page ${page + 1}/${maxPages}: ${url}`);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`LinkedIn request failed with status ${response.status} at page ${page + 1}`);
    }

    const html = await response.text();
    const jobs = extractJobsFromHtml(html);
    console.log(`[linkedin] Page ${page + 1} returned ${jobs.length} jobs.`);

    if (jobs.length === 0) {
      break;
    }

    allJobs.push(...jobs);
    await sleep(REQUEST_DELAY_MS);
  }

  return uniqueJobs(allJobs);
}

function buildEmailContent({ jobs, keywords, location }) {
  const now = new Date().toISOString();
  const criteriaLine = location ? `${keywords} in ${location}` : keywords;

  if (jobs.length === 0) {
    return {
      subject: `[LinkedIn Vacatures] Geen resultaten voor "${criteriaLine}"`,
      text: [
        `Dagelijkse LinkedIn check`,
        ``,
        `Zoekopdracht: ${criteriaLine}`,
        `Tijdstip: ${now}`,
        ``,
        `Er zijn geen nieuwe vacatures gevonden in de ingestelde tijdsrange.`,
      ].join("\n"),
      html: `
        <p><strong>Dagelijkse LinkedIn check</strong></p>
        <p>Zoekopdracht: <strong>${criteriaLine}</strong><br/>Tijdstip: ${now}</p>
        <p>Er zijn geen nieuwe vacatures gevonden in de ingestelde tijdsrange.</p>
      `,
    };
  }

  const listText = jobs
    .map(
      (job, index) =>
        `${index + 1}. ${job.title} — ${job.company} (${job.location})\n   ${job.link}\n   Geplaatst: ${job.postedAt}`
    )
    .join("\n\n");

  const listHtml = jobs
    .map(
      (job, index) => `
        <li style="margin-bottom:12px;">
          <a href="${job.link}"><strong>${index + 1}. ${job.title}</strong></a><br/>
          ${job.company} &middot; ${job.location}<br/>
          Geplaatst: ${job.postedAt}
        </li>
      `
    )
    .join("");

  return {
    subject: `[LinkedIn Vacatures] ${jobs.length}x "${criteriaLine}" gevonden`,
    text: [
      `Dagelijkse LinkedIn check`,
      ``,
      `Zoekopdracht: ${criteriaLine}`,
      `Tijdstip: ${now}`,
      ``,
      listText,
    ].join("\n"),
    html: `
      <p><strong>Dagelijkse LinkedIn check</strong></p>
      <p>Zoekopdracht: <strong>${criteriaLine}</strong><br/>Tijdstip: ${now}</p>
      <ol>${listHtml}</ol>
    `,
  };
}

async function sendEmail({ to, from, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, subject, text, html }) {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  console.log(`[email] Sent successfully. Message ID: ${info.messageId}`);
}

async function main() {
  const keywords = readEnv("LINKEDIN_KEYWORDS", DEFAULT_KEYWORDS);
  const location = readEnv("LINKEDIN_LOCATION", "");
  const timeRange = readEnv("LINKEDIN_TIME_RANGE", DEFAULT_TIME_RANGE);
  const maxPages = readNumberEnv("LINKEDIN_MAX_PAGES", 4);

  const smtpHost = requiredEnv("SMTP_HOST");
  const smtpPort = readNumberEnv("SMTP_PORT", 587);
  const smtpSecure = readEnv("SMTP_SECURE", "").toLowerCase() === "true" || smtpPort === 465;
  const smtpUser = requiredEnv("SMTP_USER");
  const smtpPass = requiredEnv("SMTP_PASS");

  const to = readEnv("EMAIL_TO", DEFAULT_RECIPIENTS);
  const from = readEnv("EMAIL_FROM", smtpUser);

  console.log(`[config] keywords="${keywords}" location="${location || "ANY"}" maxPages=${maxPages}`);
  console.log(`[config] email to="${to}" from="${from}"`);

  const jobs = await scrapeLinkedInJobs({
    keywords,
    location,
    timeRange,
    maxPages,
  });

  console.log(`[linkedin] Total unique jobs found: ${jobs.length}`);

  const emailContent = buildEmailContent({
    jobs,
    keywords,
    location,
  });

  await sendEmail({
    to,
    from,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPass,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
