import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const DEFAULT_KEYWORDS = [
  "Interim Marketing",
  "Freelance Marketing",
  "Marketing Manager",
  "Campaign Manager",
  "Paid Media Manager",
  "Pl Marketing",
].join(", ");
const DEFAULT_LOCATION = "Nederland";
const DEFAULT_RECIPIENTS = "tvanzolingen@gmail.com,a.sarhatlic@gmail.com";
const DEFAULT_TIME_RANGE = "r864000"; // Last 10 days on LinkedIn.
const DEFAULT_GEO_ID = "102890719"; // LinkedIn geoId for the Netherlands.
const PAGE_SIZE = 25;
const REQUEST_DELAY_MS = 1200;
const REPORT_TIME_ZONE = "Europe/Amsterdam";
const DUTCH_LOCATION_MARKERS = [
  "netherlands",
  "nederland",
  "amsterdam",
  "rotterdam",
  "the hague",
  "den haag",
  "utrecht",
  "eindhoven",
  "groningen",
  "tilburg",
  "almere",
  "breda",
  "nijmegen",
  "enschede",
  "haarlem",
  "arnhem",
  "zaanstad",
  "amersfoort",
  "apeldoorn",
  "hoorn",
  "maastricht",
  "dordrecht",
  "leiden",
  "zwolle",
  "zoetermeer",
  "delft",
  "deventer",
  "leeuwarden",
  "s hertogenbosch",
  "den bosch",
  "noord-holland",
  "north holland",
  "zuid-holland",
  "south holland",
  "noord-brabant",
  "gelderland",
  "utrecht province",
  "limburg",
  "overijssel",
  "flevoland",
  "friesland",
  "drenthe",
  "zeeland",
];

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
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

function parseKeywords(input) {
  const values = input
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const seen = new Set();
  const deduped = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
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

function buildSearchUrl({ keywords, location, start, timeRange, geoId }) {
  const params = new URLSearchParams({
    keywords,
    start: String(start),
    sortBy: "DD",
    f_TPR: timeRange,
  });

  if (location) {
    params.set("location", location);
  }
  if (geoId) {
    params.set("geoId", geoId);
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
    const timeElement = element.find("time").first();
    const postedAtDatetime = (timeElement.attr("datetime") || "").trim();
    const postedAtText = timeElement.text().trim();
    const postedAt = postedAtText || postedAtDatetime || "Unknown date";
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
      postedAtDatetime,
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

function mergeJobsByLink(items) {
  const byLink = new Map();

  for (const item of items) {
    const key = item.link.toLowerCase();
    const existing = byLink.get(key);

    if (!existing) {
      byLink.set(key, {
        ...item,
        matchedKeywords: [...new Set(item.matchedKeywords || [])],
      });
      continue;
    }

    const mergedKeywords = new Set([...(existing.matchedKeywords || []), ...(item.matchedKeywords || [])]);
    existing.matchedKeywords = Array.from(mergedKeywords);

    if ((!existing.postedAtDatetime || existing.postedAtDatetime === "Unknown date") && item.postedAtDatetime) {
      existing.postedAtDatetime = item.postedAtDatetime;
    }
    if ((!existing.postedAt || existing.postedAt === "Unknown date") && item.postedAt) {
      existing.postedAt = item.postedAt;
    }
  }

  return Array.from(byLink.values());
}

function normalizeForLocationMatch(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDutchLocation(location) {
  const normalized = normalizeForLocationMatch(location || "");
  if (!normalized || normalized === "unknown location") return false;

  return DUTCH_LOCATION_MARKERS.some((marker) => normalized.includes(marker));
}

function keepOnlyDutchJobs(jobs) {
  const dutchJobs = [];
  const excludedJobs = [];

  for (const job of jobs) {
    if (isDutchLocation(job.location)) {
      dutchJobs.push(job);
    } else {
      excludedJobs.push(job);
    }
  }

  return {
    dutchJobs,
    excludedJobs,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeLinkedInJobs({ keywords, location, timeRange, maxPages, geoId }) {
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
    const url = buildSearchUrl({ keywords, location, start, timeRange, geoId });
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

function formatDateKey(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to derive date key for report grouping.");
  }

  return `${year}-${month}-${day}`;
}

function dateKeyToDayNumber(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function parseRelativeDate(raw, now) {
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  if (/(today|vandaag|just now|zojuist|moments ago)/.test(input)) {
    return now;
  }
  if (/(yesterday|gisteren)/.test(input)) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const minuteMatch = input.match(/(\d+)\s*(minute|minutes|minuten|mins|minuut)/);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    return new Date(now.getTime() - minutes * 60 * 1000);
  }

  const hourMatch = input.match(/(\d+)\s*(hour|hours|uur|uren)/);
  if (hourMatch) {
    const hours = Number.parseInt(hourMatch[1], 10);
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
  }

  const dayMatch = input.match(/(\d+)\s*(day|days|dag|dagen)/);
  if (dayMatch) {
    const days = Number.parseInt(dayMatch[1], 10);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  const weekMatch = input.match(/(\d+)\s*(week|weeks|weken)/);
  if (weekMatch) {
    const weeks = Number.parseInt(weekMatch[1], 10);
    return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
  }

  return null;
}

function parsePostedDate(job, now) {
  const candidates = [job.postedAtDatetime, job.postedAt];

  for (const candidateRaw of candidates) {
    const candidate = (candidateRaw || "").trim();
    if (!candidate) continue;

    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return new Date(`${candidate}T12:00:00Z`);
    }

    const directDate = new Date(candidate);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate;
    }
  }

  return parseRelativeDate(job.postedAt || "", now);
}

function sortJobsNewestFirst(items, now) {
  return [...items].sort((left, right) => {
    const leftDate = parsePostedDate(left, now);
    const rightDate = parsePostedDate(right, now);

    if (leftDate && rightDate) {
      return rightDate.getTime() - leftDate.getTime();
    }
    if (leftDate) return -1;
    if (rightDate) return 1;
    return left.title.localeCompare(right.title);
  });
}

function groupJobsByDate(jobs, now) {
  const todayJobs = [];
  const recentJobs = [];
  const otherJobs = [];

  const nowDayNumber = dateKeyToDayNumber(formatDateKey(now));

  for (const job of jobs) {
    const parsedDate = parsePostedDate(job, now);
    if (!parsedDate) {
      recentJobs.push(job);
      continue;
    }

    const jobDayNumber = dateKeyToDayNumber(formatDateKey(parsedDate));
    const diffDays = nowDayNumber - jobDayNumber;

    if (diffDays <= 0) {
      todayJobs.push(job);
    } else if (diffDays <= 10) {
      recentJobs.push(job);
    } else {
      otherJobs.push(job);
    }
  }

  return {
    todayJobs: sortJobsNewestFirst(todayJobs, now),
    recentJobs: sortJobsNewestFirst(recentJobs, now),
    otherJobs: sortJobsNewestFirst(otherJobs, now),
  };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTextList(jobs) {
  if (jobs.length === 0) {
    return "- Geen vacatures gevonden.";
  }

  return jobs
    .map((job, index) => {
      const keywordText =
        job.matchedKeywords && job.matchedKeywords.length > 0
          ? `\n   Match op: ${job.matchedKeywords.join(", ")}`
          : "";
      return `${index + 1}. ${job.title} - ${job.company} (${job.location})\n   ${job.link}\n   Geplaatst: ${job.postedAt}${keywordText}`;
    })
    .join("\n\n");
}

function formatHtmlList(jobs) {
  if (jobs.length === 0) {
    return "<p>Geen vacatures gevonden.</p>";
  }

  const listHtml = jobs
    .map((job, index) => {
      const keywordHtml =
        job.matchedKeywords && job.matchedKeywords.length > 0
          ? `<small>Match op: ${escapeHtml(job.matchedKeywords.join(", "))}</small><br/>`
          : "";
      return `
        <li style="margin-bottom:12px;">
          <a href="${escapeHtml(job.link)}"><strong>${index + 1}. ${escapeHtml(job.title)}</strong></a><br/>
          ${escapeHtml(job.company)} &middot; ${escapeHtml(job.location)}<br/>
          Geplaatst: ${escapeHtml(job.postedAt)}<br/>
          ${keywordHtml}
        </li>
      `;
    })
    .join("");

  return `<ol>${listHtml}</ol>`;
}

function buildEmailContent({ jobs, keywords, location }) {
  const now = new Date();
  const generatedAt = now.toLocaleString("nl-NL", {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "medium",
  });
  const { todayJobs, recentJobs, otherJobs } = groupJobsByDate(jobs, now);
  const totalInMainSections = todayJobs.length + recentJobs.length;

  if (totalInMainSections === 0 && otherJobs.length === 0) {
    return {
      subject: `[LinkedIn Marketing Vacatures] Geen resultaten voor "${location}"`,
      text: [
        `Dagelijkse LinkedIn check`,
        ``,
        `Zoekopdrachten: ${keywords.join(", ")}`,
        `Locatie: ${location || "Alle locaties"}`,
        `Tijdstip: ${generatedAt} (${REPORT_TIME_ZONE})`,
        ``,
        `Er zijn geen vacatures gevonden in de laatste 10 dagen.`,
      ].join("\n"),
      html: `
        <p><strong>Dagelijkse LinkedIn check</strong></p>
        <p>Zoekopdrachten: <strong>${escapeHtml(keywords.join(", "))}</strong><br/>Locatie: <strong>${escapeHtml(
          location || "Alle locaties"
        )}</strong><br/>Tijdstip: ${escapeHtml(generatedAt)} (${REPORT_TIME_ZONE})</p>
        <p>Er zijn geen vacatures gevonden in de laatste 10 dagen.</p>
      `,
    };
  }

  const todayText = formatTextList(todayJobs);
  const recentText = formatTextList(recentJobs);
  const otherText = formatTextList(otherJobs);

  const todayHtml = formatHtmlList(todayJobs);
  const recentHtml = formatHtmlList(recentJobs);
  const otherHtml = formatHtmlList(otherJobs);

  return {
    subject: `[LinkedIn Marketing Vacatures] Vandaag: ${todayJobs.length}, Eerder (1-10 dagen): ${recentJobs.length}`,
    text: [
      `Dagelijkse LinkedIn check`,
      ``,
      `Zoekopdrachten: ${keywords.join(", ")}`,
      `Locatie: ${location || "Alle locaties"}`,
      `Tijdstip: ${generatedAt} (${REPORT_TIME_ZONE})`,
      ``,
      `Vacatures van vandaag (${todayJobs.length})`,
      todayText,
      ``,
      `Posts/vacatures van eerder die week t/m 10 dagen geleden (${recentJobs.length})`,
      recentText,
      ...(otherJobs.length > 0
        ? ["", `Overige resultaten (${otherJobs.length})`, otherText]
        : []),
    ].join("\n"),
    html: `
      <p><strong>Dagelijkse LinkedIn check</strong></p>
      <p>
        Zoekopdrachten: <strong>${escapeHtml(keywords.join(", "))}</strong><br/>
        Locatie: <strong>${escapeHtml(location || "Alle locaties")}</strong><br/>
        Tijdstip: ${escapeHtml(generatedAt)} (${REPORT_TIME_ZONE})
      </p>
      <h3>Vacatures van vandaag (${todayJobs.length})</h3>
      ${todayHtml}
      <h3>Posts/vacatures van eerder die week t/m 10 dagen geleden (${recentJobs.length})</h3>
      ${recentHtml}
      ${
        otherJobs.length > 0
          ? `<h3>Overige resultaten (${otherJobs.length})</h3>${otherHtml}`
          : ""
      }
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
  const keywordInput = readEnv("LINKEDIN_KEYWORDS", DEFAULT_KEYWORDS);
  const keywords = parseKeywords(keywordInput);
  if (keywords.length === 0) {
    throw new Error("No valid LINKEDIN_KEYWORDS were provided.");
  }

  const location = readEnv("LINKEDIN_LOCATION", DEFAULT_LOCATION);
  const timeRange = readEnv("LINKEDIN_TIME_RANGE", DEFAULT_TIME_RANGE);
  const maxPages = readNumberEnv("LINKEDIN_MAX_PAGES", 4);
  const geoId = readEnv("LINKEDIN_GEO_ID", DEFAULT_GEO_ID);

  const smtpHost = requiredEnv("SMTP_HOST");
  const smtpPort = readNumberEnv("SMTP_PORT", 587);
  const smtpSecure = readEnv("SMTP_SECURE", "").toLowerCase() === "true" || smtpPort === 465;
  const smtpUser = requiredEnv("SMTP_USER");
  const smtpPass = requiredEnv("SMTP_PASS");

  const to = readEnv("EMAIL_TO", DEFAULT_RECIPIENTS);
  const from = readEnv("EMAIL_FROM", smtpUser);

  console.log(
    `[config] keywords="${keywords.join(" | ")}" location="${location || "ANY"}" geoId="${geoId || "NONE"}" maxPages=${maxPages}`
  );
  console.log(`[config] email to="${to}" from="${from}"`);

  const allJobs = [];
  for (const keyword of keywords) {
    console.log(`[linkedin] Searching keyword "${keyword}"`);
    const jobsForKeyword = await scrapeLinkedInJobs({
      keywords: keyword,
      location,
      timeRange,
      maxPages,
      geoId,
    });
    const { dutchJobs, excludedJobs } = keepOnlyDutchJobs(jobsForKeyword);
    console.log(
      `[linkedin] Keyword "${keyword}" kept ${dutchJobs.length}/${jobsForKeyword.length} jobs in NL and excluded ${excludedJobs.length} outside NL.`
    );

    for (const job of dutchJobs) {
      allJobs.push({
        ...job,
        matchedKeywords: [keyword],
      });
    }
  }

  const jobs = mergeJobsByLink(allJobs);

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
