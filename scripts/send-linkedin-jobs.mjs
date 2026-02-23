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
const DEFAULT_INCLUDE_LINKEDIN_POSTS = true;
const DEFAULT_POST_SEARCH_PHRASE = "ik zoek";
const DEFAULT_POSTS_MAX_PER_KEYWORD = 8;
const PAGE_SIZE = 25;
const REQUEST_DELAY_MS = 1200;
const POST_REQUEST_DELAY_MS = 1000;
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

function readBooleanEnv(name, fallback) {
  const value = readEnv(name, "");
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
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

function buildDuckDuckGoSearchUrl(query) {
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

function buildBraveSearchUrl(query) {
  return `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
}

function unwrapDuckDuckGoRedirect(rawHref) {
  if (!rawHref) return "";
  const href = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;

  try {
    const parsed = new URL(href);
    const target = parsed.searchParams.get("uddg");
    return normalizeLinkedInUrl(target ? decodeURIComponent(target) : href);
  } catch {
    return normalizeLinkedInUrl(href);
  }
}

function parseActivityDateFromLinkedInUrl(url) {
  const match = url.match(/(?:activity-|activity:)(\d{10,})/i);
  if (!match) return null;

  try {
    const activityId = BigInt(match[1]);
    const timestampMs = Number(activityId >> 22n);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;

    const date = new Date(timestampMs);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function formatDateTimeForDisplay(date) {
  return date.toLocaleString("nl-NL", {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  });
}

function buildPostItem({ title, snippet, href, keyword }) {
  const link = normalizeLinkedInUrl(href || "");
  if (!link || !/linkedin\.com\/(posts\/|feed\/update\/)/i.test(link)) {
    return null;
  }

  const postedDate = parseActivityDateFromLinkedInUrl(link);
  return {
    title: title || "LinkedIn post",
    snippet: snippet || "",
    link,
    postedAt: postedDate ? formatDateTimeForDisplay(postedDate) : "Unknown date",
    postedAtDatetime: postedDate ? postedDate.toISOString() : "",
    location: "Nederland",
    matchedKeywords: [keyword],
    sourceType: "post",
  };
}

function extractPostsFromDuckDuckGoHtml(html, keyword) {
  const $ = cheerio.load(html);
  const posts = [];

  $("a.result__a").each((_, anchor) => {
    const element = $(anchor);
    const card = element.closest(".result");
    const titleRaw = element.text().trim();
    const title = titleRaw.replace(/\s*-\s*LinkedIn\s*$/i, "").trim();
    const snippet = card.find(".result__snippet").text().trim();
    const href = unwrapDuckDuckGoRedirect(element.attr("href") || "");
    const post = buildPostItem({ title, snippet, href, keyword });
    if (post) posts.push(post);
  });

  return posts;
}

function extractPostsFromBraveHtml(html, keyword) {
  const $ = cheerio.load(html);
  const posts = [];

  $('a[href*="linkedin.com/posts/"], a[href*="linkedin.com/feed/update/"]').each((_, anchor) => {
    const element = $(anchor);
    const href = (element.attr("href") || "").trim();
    if (!href.startsWith("http")) return;

    const rawText = element.text().replace(/\s+/g, " ").trim();
    const title = rawText.length > 0 ? rawText : "LinkedIn post";
    const snippet = rawText;
    const post = buildPostItem({ title, snippet, href, keyword });
    if (post) posts.push(post);
  });

  return posts;
}

function mergePostsByLink(items) {
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

    if ((!existing.snippet || existing.snippet.length < 20) && item.snippet) {
      existing.snippet = item.snippet;
    }
    if ((!existing.postedAtDatetime || existing.postedAtDatetime === "Unknown date") && item.postedAtDatetime) {
      existing.postedAtDatetime = item.postedAtDatetime;
    }
    if ((!existing.postedAt || existing.postedAt === "Unknown date") && item.postedAt) {
      existing.postedAt = item.postedAt;
    }
  }

  return Array.from(byLink.values());
}

function isLikelyDutchPost(post) {
  try {
    const host = new URL(post.link).hostname.toLowerCase();
    if (host === "nl.linkedin.com") {
      return true;
    }
  } catch {
    return false;
  }

  const combined = normalizeForLocationMatch(`${post.title || ""} ${post.snippet || ""}`);
  return DUTCH_LOCATION_MARKERS.some((marker) => combined.includes(marker));
}

function matchesPostIntent(post, keyword, phrase) {
  const normalizedText = normalizeForLocationMatch(`${post.title || ""} ${post.snippet || ""}`);
  const keywordTokens = normalizeForLocationMatch(keyword)
    .split(" ")
    .filter((token) => token.length >= 3);
  const normalizedPhrase = normalizeForLocationMatch(phrase);

  if (keywordTokens.length === 0) {
    return false;
  }

  const matchedTokenCount = keywordTokens.filter((token) => normalizedText.includes(token)).length;
  const requiredTokenCount = keywordTokens.length === 1 ? 1 : Math.max(2, Math.ceil(keywordTokens.length * 0.6));
  if (matchedTokenCount < requiredTokenCount) return false;

  if (!normalizedPhrase) return true;
  return normalizedText.includes(normalizedPhrase);
}

async function scrapeLinkedInPosts({ keywords, location, searchPhrase, maxPostsPerKeyword }) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const allPosts = [];

  for (const keyword of keywords) {
    const queryVariants = [
      `site:linkedin.com/posts "${searchPhrase}" "${keyword}" ${location}`.trim(),
      `site:linkedin.com/posts "${searchPhrase}" ${keyword} ${location}`.trim(),
    ];
    const keywordPosts = [];

    for (const query of queryVariants) {
      if (keywordPosts.length >= maxPostsPerKeyword) {
        break;
      }

      const duckDuckGoUrl = buildDuckDuckGoSearchUrl(query);
      console.log(`[posts] Searching (DDG) for keyword "${keyword}" using: ${duckDuckGoUrl}`);

      try {
        const response = await fetch(duckDuckGoUrl, { headers });
        const html = await response.text();
        const extracted = extractPostsFromDuckDuckGoHtml(html, keyword);

        let fromBrave = [];
        if (response.status === 202 || extracted.length === 0) {
          const braveUrl = buildBraveSearchUrl(query);
          console.log(`[posts] Falling back to Brave for keyword "${keyword}" using: ${braveUrl}`);
          const braveResponse = await fetch(braveUrl, { headers });
          if (braveResponse.ok) {
            const braveHtml = await braveResponse.text();
            fromBrave = extractPostsFromBraveHtml(braveHtml, keyword);
          }
        }

        const combined = mergePostsByLink([...extracted, ...fromBrave]);
        const filtered = combined.filter((post) => isLikelyDutchPost(post) && matchesPostIntent(post, keyword, searchPhrase));
        keywordPosts.push(...filtered);
      } catch (error) {
        console.warn(
          `[posts] Failed query for keyword "${keyword}": ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await sleep(POST_REQUEST_DELAY_MS);
    }

    const dedupedKeywordPosts = mergePostsByLink(keywordPosts).slice(0, maxPostsPerKeyword);
    allPosts.push(...dedupedKeywordPosts);
    console.log(`[posts] Keyword "${keyword}" yielded ${dedupedKeywordPosts.length} relevant posts after filtering.`);
  }

  return mergePostsByLink(allPosts);
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parsePostedDate(item, now) {
  const candidates = [item.postedAtDatetime, item.postedAt];

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

  return parseRelativeDate(item.postedAt || "", now);
}

function sortItemsNewestFirst(items, now) {
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

function groupItemsByDate(items, now, { includeUnknownInRecent = true } = {}) {
  const todayItems = [];
  const recentItems = [];
  const otherItems = [];

  const nowDayNumber = dateKeyToDayNumber(formatDateKey(now));

  for (const item of items) {
    const parsedDate = parsePostedDate(item, now);
    if (!parsedDate) {
      if (includeUnknownInRecent) {
        recentItems.push(item);
      } else {
        otherItems.push(item);
      }
      continue;
    }

    const itemDayNumber = dateKeyToDayNumber(formatDateKey(parsedDate));
    const diffDays = nowDayNumber - itemDayNumber;

    if (diffDays <= 0) {
      todayItems.push(item);
    } else if (diffDays <= 10) {
      recentItems.push(item);
    } else {
      otherItems.push(item);
    }
  }

  return {
    todayItems: sortItemsNewestFirst(todayItems, now),
    recentItems: sortItemsNewestFirst(recentItems, now),
    otherItems: sortItemsNewestFirst(otherItems, now),
  };
}

function truncateText(value, maxLength = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatTextVacancyList(jobs) {
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

function formatHtmlVacancyList(jobs) {
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

function formatTextPostList(posts) {
  if (posts.length === 0) {
    return "- Geen posts gevonden.";
  }

  return posts
    .map((post, index) => {
      const keywordText =
        post.matchedKeywords && post.matchedKeywords.length > 0
          ? `\n   Match op: ${post.matchedKeywords.join(", ")}`
          : "";
      const snippetText = post.snippet ? `\n   Snippet: ${truncateText(post.snippet, 260)}` : "";
      return `${index + 1}. ${post.title}\n   ${post.link}\n   Geplaatst: ${post.postedAt}${keywordText}${snippetText}`;
    })
    .join("\n\n");
}

function formatHtmlPostList(posts) {
  if (posts.length === 0) {
    return "<p>Geen posts gevonden.</p>";
  }

  const listHtml = posts
    .map((post, index) => {
      const keywordHtml =
        post.matchedKeywords && post.matchedKeywords.length > 0
          ? `<small>Match op: ${escapeHtml(post.matchedKeywords.join(", "))}</small><br/>`
          : "";
      const snippetHtml = post.snippet ? `<small>${escapeHtml(truncateText(post.snippet, 260))}</small><br/>` : "";
      return `
        <li style="margin-bottom:12px;">
          <a href="${escapeHtml(post.link)}"><strong>${index + 1}. ${escapeHtml(post.title)}</strong></a><br/>
          Geplaatst: ${escapeHtml(post.postedAt)}<br/>
          ${keywordHtml}
          ${snippetHtml}
        </li>
      `;
    })
    .join("");

  return `<ol>${listHtml}</ol>`;
}

function buildEmailContent({ jobs, posts, keywords, location, postSearchPhrase }) {
  const now = new Date();
  const generatedAt = now.toLocaleString("nl-NL", {
    timeZone: REPORT_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "medium",
  });
  const groupedJobs = groupItemsByDate(jobs, now, { includeUnknownInRecent: true });
  const groupedPosts = groupItemsByDate(posts, now, { includeUnknownInRecent: false });
  const todayJobs = groupedJobs.todayItems;
  const recentJobs = groupedJobs.recentItems;
  const todayPosts = groupedPosts.todayItems;
  const recentPosts = groupedPosts.recentItems;
  const totalInMainSections = todayJobs.length + recentJobs.length + todayPosts.length + recentPosts.length;

  if (totalInMainSections === 0) {
    return {
      subject: `[LinkedIn Marketing Vacatures] Geen resultaten voor "${location}"`,
      text: [
        `Dagelijkse LinkedIn check`,
        ``,
        `Zoekopdrachten: ${keywords.join(", ")}`,
        `Post-signaal: "${postSearchPhrase}"`,
        `Locatie: ${location || "Alle locaties"}`,
        `Tijdstip: ${generatedAt} (${REPORT_TIME_ZONE})`,
        ``,
        `Er zijn geen vacatures of relevante posts gevonden in de laatste 10 dagen.`,
      ].join("\n"),
      html: `
        <p><strong>Dagelijkse LinkedIn check</strong></p>
        <p>Zoekopdrachten: <strong>${escapeHtml(keywords.join(", "))}</strong><br/>Locatie: <strong>${escapeHtml(
          location || "Alle locaties"
        )}</strong><br/>Post-signaal: <strong>${escapeHtml(postSearchPhrase)}</strong><br/>Tijdstip: ${escapeHtml(
          generatedAt
        )} (${REPORT_TIME_ZONE})</p>
        <p>Er zijn geen vacatures of relevante posts gevonden in de laatste 10 dagen.</p>
      `,
    };
  }

  const todayJobsText = formatTextVacancyList(todayJobs);
  const recentJobsText = formatTextVacancyList(recentJobs);
  const todayPostsText = formatTextPostList(todayPosts);
  const recentPostsText = formatTextPostList(recentPosts);

  const todayJobsHtml = formatHtmlVacancyList(todayJobs);
  const recentJobsHtml = formatHtmlVacancyList(recentJobs);
  const todayPostsHtml = formatHtmlPostList(todayPosts);
  const recentPostsHtml = formatHtmlPostList(recentPosts);

  return {
    subject: `[LinkedIn Marketing] Vacatures vandaag: ${todayJobs.length}, Posts vandaag: ${todayPosts.length}`,
    text: [
      `Dagelijkse LinkedIn check`,
      ``,
      `Zoekopdrachten: ${keywords.join(", ")}`,
      `Post-signaal: "${postSearchPhrase}"`,
      `Locatie: ${location || "Alle locaties"}`,
      `Tijdstip: ${generatedAt} (${REPORT_TIME_ZONE})`,
      ``,
      `Vacatures van vandaag (${todayJobs.length})`,
      todayJobsText,
      ``,
      `Posts van vandaag (${todayPosts.length})`,
      todayPostsText,
      ``,
      `Vacatures van eerder die week t/m 10 dagen geleden (${recentJobs.length})`,
      recentJobsText,
      ``,
      `Posts van eerder die week t/m 10 dagen geleden (${recentPosts.length})`,
      recentPostsText,
    ].join("\n"),
    html: `
      <p><strong>Dagelijkse LinkedIn check</strong></p>
      <p>
        Zoekopdrachten: <strong>${escapeHtml(keywords.join(", "))}</strong><br/>
        Post-signaal: <strong>${escapeHtml(postSearchPhrase)}</strong><br/>
        Locatie: <strong>${escapeHtml(location || "Alle locaties")}</strong><br/>
        Tijdstip: ${escapeHtml(generatedAt)} (${REPORT_TIME_ZONE})
      </p>
      <h3>Vacatures van vandaag (${todayJobs.length})</h3>
      ${todayJobsHtml}
      <h3>Posts van vandaag (${todayPosts.length})</h3>
      ${todayPostsHtml}
      <h3>Vacatures van eerder die week t/m 10 dagen geleden (${recentJobs.length})</h3>
      ${recentJobsHtml}
      <h3>Posts van eerder die week t/m 10 dagen geleden (${recentPosts.length})</h3>
      ${recentPostsHtml}
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
  const includeLinkedInPosts = readBooleanEnv("LINKEDIN_INCLUDE_POSTS", DEFAULT_INCLUDE_LINKEDIN_POSTS);
  const postSearchPhrase = readEnv("LINKEDIN_POST_SEARCH_PHRASE", DEFAULT_POST_SEARCH_PHRASE);
  const postMaxPerKeyword = readNumberEnv("LINKEDIN_POST_MAX_PER_KEYWORD", DEFAULT_POSTS_MAX_PER_KEYWORD);

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
  console.log(
    `[config] includePosts=${includeLinkedInPosts} postPhrase="${postSearchPhrase}" postMaxPerKeyword=${postMaxPerKeyword}`
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

  let posts = [];
  if (includeLinkedInPosts) {
    posts = await scrapeLinkedInPosts({
      keywords,
      location,
      searchPhrase: postSearchPhrase,
      maxPostsPerKeyword: postMaxPerKeyword,
    });
  }
  console.log(`[posts] Total unique posts found: ${posts.length}`);

  const emailContent = buildEmailContent({
    jobs,
    posts,
    keywords,
    location,
    postSearchPhrase,
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
