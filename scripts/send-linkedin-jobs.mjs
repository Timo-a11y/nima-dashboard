import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const DEFAULT_KEYWORDS = "Appointment Setter";
const DEFAULT_RECIPIENTS = "suuz@studiobenedek.nl,tvanzolingen@gmail.com";
const DEFAULT_TIME_RANGE = "r864000"; // Last 10 days on LinkedIn.
const DEFAULT_SEARCH_LOCATIONS = ["Netherlands", "Belgium", "United States"];
const DEFAULT_POSTS_ENABLED = true;
const DEFAULT_POSTS_MAX_RESULTS = 20;
const PAGE_SIZE = 25;
const REQUEST_DELAY_MS = 1800;
const POST_SEARCH_DELAY_MS = 900;
const POST_PAGE_OFFSETS = [0];
const POST_INTENT_QUERY_HINT =
  'hiring OR "looking for" OR "op zoek naar" OR "ik zoek" OR vacature OR vacancy';
const SIMILAR_TITLE_PATTERNS = [
  "sales development representative",
  "sdr",
  "lead generator",
  "business development representative",
  "inside sales",
  "account executive",
  "cold caller",
  "acquisiteur",
  "telemarketer",
];

const APPOINTMENT_LEAD_INCLUDE_TERMS = [
  "appointment setter",
  "appointment setting",
  "appointmentsetter",
  "afspraakmaker",
  "afsprakenmaker",
  "afspraak inplanner",
  "afspraken inplanner",
  "lead generator",
  "lead generation",
  "business development representative",
  "sales development representative",
  "cold caller",
  "acquisiteur",
  "telemarketer",
  "inside sales",
  "appointment specialist",
  "appointment scheduler",
  "appointment coordinator",
  "sales representative",
  "sales rep",
  "business developer",
  "outbound sales",
  "sales executive",
  "call center agent",
  "contact center agent",
];

const APPOINTMENT_LEAD_INCLUDE_REGEXES = [/\bsdr\b/i, /\bbdr\b/i];

const IRRELEVANT_ROLE_EXCLUDE_TERMS = [
  "technisch tekenaar",
  "tekenaar",
  "drafter",
  "cad",
  "autocad",
  "mechanical engineer",
  "electrical engineer",
  "software engineer",
  "software developer",
  "developer",
  "architect",
  "civil engineer",
  "project engineer",
  "werkvoorbereider",
  "constructeur",
  "machine operator",
];

const POST_INTENT_SIGNAL_TERMS = [
  "hiring",
  "looking for",
  "we are hiring",
  "op zoek naar",
  "ik zoek",
  "vacature",
  "vacancy",
  "recruiting",
  "gezocht",
];

const REGION_PRIORITY = new Map([
  ["netherlands", 0],
  ["nederland", 0],
  ["belgium", 1],
  ["belgie", 1],
  ["united states", 2],
  ["usa", 2],
  ["us", 2],
  ["global", 3],
]);

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

function readBooleanEnv(name, fallback) {
  const value = readEnv(name, "");
  if (!value) return fallback;

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;

  return fallback;
}

function requiredEnv(name) {
  const value = readEnv(name, "");
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCommaSeparatedList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSearchLocations() {
  const multiLocationValue = readEnv("LINKEDIN_LOCATIONS", "");
  const parsedMultiLocations = parseCommaSeparatedList(multiLocationValue);
  if (parsedMultiLocations.length > 0) {
    return parsedMultiLocations;
  }

  const singleLocationValue = readEnv("LINKEDIN_LOCATION", "");
  if (singleLocationValue) {
    return [singleLocationValue];
  }

  return [...DEFAULT_SEARCH_LOCATIONS];
}

function dateFromRelativeParts(amount, unit) {
  const now = new Date();
  const loweredUnit = unit.toLowerCase();
  const numericAmount = Number.parseInt(amount, 10);
  if (Number.isNaN(numericAmount) || numericAmount < 0) {
    return null;
  }

  const multipliers = {
    second: 1000,
    seconds: 1000,
    sec: 1000,
    secs: 1000,
    minuut: 60 * 1000,
    minuten: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    uur: 60 * 60 * 1000,
    uren: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    dag: 24 * 60 * 60 * 1000,
    dagen: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weken: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
    maand: 30 * 24 * 60 * 60 * 1000,
    maanden: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000,
    jaar: 365 * 24 * 60 * 60 * 1000,
    jaren: 365 * 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  const ms = multipliers[loweredUnit];
  if (!ms) return null;

  return new Date(now.getTime() - numericAmount * ms);
}

function parseFlexibleDate(input) {
  if (!input) return null;

  const raw = input.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const lowered = raw.toLowerCase();
  if (
    lowered.includes("today") ||
    lowered.includes("vandaag") ||
    lowered.includes("just now") ||
    lowered.includes("zojuist")
  ) {
    return new Date();
  }

  if (lowered.includes("yesterday") || lowered.includes("gisteren")) {
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  const verboseRelativeMatch = lowered.match(
    /(\d+)\s*(seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr|days?|day|weeks?|week|months?|month|years?|year|minuut|minuten|uur|uren|dag|dagen|weken|week|maand|maanden|jaar|jaren)\b/
  );
  if (verboseRelativeMatch) {
    return dateFromRelativeParts(verboseRelativeMatch[1], verboseRelativeMatch[2]);
  }

  const shortRelativeMatch = lowered.match(/(^|\s)(\d+)\s*([hdw])(?=\s|$)/);
  if (shortRelativeMatch) {
    return dateFromRelativeParts(shortRelativeMatch[2], shortRelativeMatch[3]);
  }

  return null;
}

function getDayDifferenceFromNow(date) {
  const now = new Date();
  const utcNowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const utcDateStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const msDiff = utcNowStart - utcDateStart;
  return Math.floor(msDiff / (24 * 60 * 60 * 1000));
}

function getRecencyBucket(date) {
  if (!date) return "unknown";
  const diffDays = getDayDifferenceFromNow(date);

  if (diffDays <= 0) return "today";
  if (diffDays <= 10) return "last10days";
  return "older";
}

function getBestRegionPriority(sourceLabels) {
  if (!Array.isArray(sourceLabels) || sourceLabels.length === 0) {
    return 99;
  }

  let best = 99;
  for (const label of sourceLabels) {
    const lowered = label.toLowerCase();

    for (const [regionFragment, priority] of REGION_PRIORITY.entries()) {
      if (lowered.includes(regionFragment)) {
        best = Math.min(best, priority);
      }
    }
  }

  return best;
}

function getTitlePriority(title, keywords) {
  const loweredTitle = title.toLowerCase();
  const loweredKeywords = keywords.toLowerCase();

  if (loweredTitle.includes(loweredKeywords)) {
    return 0;
  }

  const keywordTokens = loweredKeywords
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  const matches = keywordTokens.filter((token) => loweredTitle.includes(token)).length;
  if (keywordTokens.length > 0 && matches === keywordTokens.length) {
    return 1;
  }

  if (matches > 0) {
    return 2;
  }

  if (SIMILAR_TITLE_PATTERNS.some((pattern) => loweredTitle.includes(pattern))) {
    return 3;
  }

  return 4;
}

function matchesAnyTerm(text, terms) {
  return terms.some((term) => text.includes(term));
}

function matchesAnyRegex(text, regexes) {
  return regexes.some((regex) => regex.test(text));
}

function extractKeywordTokens(keywords) {
  return keywords
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function hasKeywordTokenMatch(text, keywords) {
  const tokens = extractKeywordTokens(keywords);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.some((token) => text.includes(token));
}

function isAppointmentSetterSearch(keywords) {
  const lowered = keywords.toLowerCase();
  return (
    lowered.includes("appointment setter") ||
    lowered.includes("appointment setting") ||
    lowered.includes("appointmentsetter")
  );
}

function isRelevantJobItem({ title, snippet = "", keywords }) {
  const text = `${title} ${snippet}`.toLowerCase();

  const includeMatch =
    matchesAnyTerm(text, APPOINTMENT_LEAD_INCLUDE_TERMS) ||
    matchesAnyRegex(text, APPOINTMENT_LEAD_INCLUDE_REGEXES) ||
    hasKeywordTokenMatch(text, keywords);

  if (!includeMatch) {
    return false;
  }

  const excludeMatch = matchesAnyTerm(text, IRRELEVANT_ROLE_EXCLUDE_TERMS);
  return !excludeMatch;
}

function isRelevantPostItem({ title, snippet = "", keywords }) {
  const text = `${title} ${snippet}`.toLowerCase();

  const includeMatch = isAppointmentSetterSearch(keywords)
    ? matchesAnyTerm(text, APPOINTMENT_LEAD_INCLUDE_TERMS) ||
      matchesAnyRegex(text, APPOINTMENT_LEAD_INCLUDE_REGEXES) ||
      hasKeywordTokenMatch(text, keywords)
    : text.includes(keywords.toLowerCase());

  if (!includeMatch) {
    return false;
  }

  const hasIntentSignal = matchesAnyTerm(text, POST_INTENT_SIGNAL_TERMS);
  if (!hasIntentSignal) {
    return false;
  }

  const excludeMatch = matchesAnyTerm(text, IRRELEVANT_ROLE_EXCLUDE_TERMS);
  return !excludeMatch;
}

function sortByPriority(items, { keywords, getSourceLabels, getDateInput, includeOlder = false }) {
  const enriched = items
    .map((item) => {
      const parsedDate = parseFlexibleDate(getDateInput(item));
      const recencyBucket = getRecencyBucket(parsedDate);
      const regionPriority = getBestRegionPriority(getSourceLabels(item));
      const titlePriority = getTitlePriority(item.title, keywords);

      return {
        ...item,
        parsedDate,
        recencyBucket,
        regionPriority,
        titlePriority,
      };
    })
    .filter((item) => includeOlder || item.recencyBucket !== "older");

  return enriched.sort((a, b) => {
    const bucketPriority = {
      today: 0,
      last10days: 1,
      unknown: 2,
      older: 3,
    };

    if (bucketPriority[a.recencyBucket] !== bucketPriority[b.recencyBucket]) {
      return bucketPriority[a.recencyBucket] - bucketPriority[b.recencyBucket];
    }

    if (a.regionPriority !== b.regionPriority) {
      return a.regionPriority - b.regionPriority;
    }

    if (a.titlePriority !== b.titlePriority) {
      return a.titlePriority - b.titlePriority;
    }

    const aTime = a.parsedDate ? a.parsedDate.getTime() : 0;
    const bTime = b.parsedDate ? b.parsedDate.getTime() : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return a.title.localeCompare(b.title);
  });
}

function splitByRecency(items) {
  const groups = {
    today: [],
    earlierWeek: [],
  };

  for (const item of items) {
    if (item.recencyBucket === "today") {
      groups.today.push(item);
      continue;
    }
    groups.earlierWeek.push(item);
  }

  return groups;
}

function buildKeywordVariants(keywords) {
  const base = keywords.trim();
  const lowered = base.toLowerCase();
  const variants = [base];

  if (lowered === "appointment setter") {
    variants.push("appointment setting");
    variants.push("appointmentsetter");
    return variants;
  }

  if (!lowered.endsWith("s")) {
    variants.push(`${base}s`);
  }

  return variants;
}

function buildPostSearchTargets({ keywords, searchLocations }) {
  const keywordVariants = buildKeywordVariants(keywords);
  const locationTargets = [
    { label: "Global", locationTerm: "" },
    ...searchLocations.map((location) => ({
      label: location,
      locationTerm: `"${location}"`,
    })),
  ];

  const targets = [];
  const seenQueries = new Set();

  for (const locationTarget of locationTargets) {
    for (const keywordVariant of keywordVariants) {
      const queryCandidates = [
        `site:linkedin.com/posts ${keywordVariant} ${locationTarget.locationTerm} (${POST_INTENT_QUERY_HINT})`,
        `site:linkedin.com ${keywordVariant} ${locationTarget.locationTerm} (${POST_INTENT_QUERY_HINT})`,
      ];

      for (const queryCandidate of queryCandidates) {
        const normalizedQuery = queryCandidate.replace(/\s+/g, " ").trim();
        if (seenQueries.has(normalizedQuery)) {
          continue;
        }

        seenQueries.add(normalizedQuery);
        targets.push({
          label: locationTarget.label,
          query: normalizedQuery,
        });
      }
    }
  }

  return targets;
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

function normalizeSearchResultUrl(input) {
  if (!input) return "";

  try {
    const parsed = new URL(input, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    const candidate = redirected ? decodeURIComponent(redirected) : parsed.toString();
    return normalizeLinkedInUrl(candidate);
  } catch {
    return input;
  }
}

function isLikelyLinkedInPostUrl(input) {
  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (!hostname.endsWith("linkedin.com")) {
      return false;
    }

    const hasPostPath = /\/posts\/[^/?#]+/i.test(parsed.pathname);
    const hasFeedUpdatePath = /\/feed\/update\/[^/?#]+/i.test(parsed.pathname);
    return hasPostPath || hasFeedUpdatePath;
  } catch {
    return false;
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

function extractJobsFromHtml(html, searchLocation) {
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
      sourceSearchLocations: searchLocation ? [searchLocation] : [],
    });
  });

  return jobs;
}

function uniqueJobs(items) {
  const byLink = new Map();

  for (const item of items) {
    const key = item.link.toLowerCase();

    if (!byLink.has(key)) {
      byLink.set(key, {
        ...item,
        sourceSearchLocations: [...item.sourceSearchLocations],
      });
      continue;
    }

    const existing = byLink.get(key);
    const mergedSourceLocations = new Set(existing.sourceSearchLocations);
    for (const sourceLocation of item.sourceSearchLocations) {
      mergedSourceLocations.add(sourceLocation);
    }
    existing.sourceSearchLocations = [...mergedSourceLocations];
  }

  return [...byLink.values()];
}

function uniquePosts(items) {
  const byLink = new Map();

  for (const item of items) {
    const key = item.link.toLowerCase();

    if (!byLink.has(key)) {
      byLink.set(key, {
        ...item,
        sourceTargets: [...item.sourceTargets],
      });
      continue;
    }

    const existing = byLink.get(key);
    const mergedTargets = new Set(existing.sourceTargets);
    for (const sourceTarget of item.sourceTargets) {
      mergedTargets.add(sourceTarget);
    }
    existing.sourceTargets = [...mergedTargets];
  }

  return [...byLink.values()];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithRetries({
  url,
  headers,
  context,
  timeoutMs = 15000,
  maxAttempts = 4,
  baseDelayMs = 2000,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers }, timeoutMs);
      if (response.ok) {
        return await response.text();
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt === maxAttempts) {
        throw new Error(`${context} failed with status ${response.status}`);
      }

      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[retry] ${context} returned ${response.status}. Retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts}).`
      );
      await sleep(backoffMs);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }

      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[retry] ${context} request error: ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts}).`
      );
      await sleep(backoffMs);
    }
  }

  throw (
    lastError ||
    new Error(`${context} failed after ${maxAttempts} attempts without a specific error.`)
  );
}

async function scrapeLinkedInJobs({ keywords, searchLocations, timeRange, maxPages }) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const allJobs = [];

  for (const searchLocation of searchLocations) {
    console.log(`[linkedin] Searching location: ${searchLocation}`);
    let skipRemainingPagesForLocation = false;

    for (let page = 0; page < maxPages; page += 1) {
      const start = page * PAGE_SIZE;
      const url = buildSearchUrl({ keywords, location: searchLocation, start, timeRange });
      console.log(`[linkedin] Fetching page ${page + 1}/${maxPages}: ${url}`);

      let html = "";
      try {
        html = await fetchTextWithRetries({
          url,
          headers,
          context: `LinkedIn jobs page ${page + 1} for ${searchLocation}`,
        });
      } catch (error) {
        console.warn(
          `[linkedin] Skipping page ${page + 1} for "${searchLocation}" after retries: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        // If first page of a location fails repeatedly, continue with other locations.
        skipRemainingPagesForLocation = true;
        break;
      }

      const jobs = extractJobsFromHtml(html, searchLocation);
      const relevantJobs = jobs.filter((job) =>
        isRelevantJobItem({
          title: job.title,
          snippet: `${job.company} ${job.location}`,
          keywords,
        })
      );
      const filteredOutCount = jobs.length - relevantJobs.length;
      console.log(
        `[linkedin] Location "${searchLocation}" page ${page + 1} returned ${jobs.length} jobs.`
      );
      if (filteredOutCount > 0) {
        console.log(
          `[linkedin] Filtered out ${filteredOutCount} non-relevant jobs on page ${page + 1} for "${searchLocation}".`
        );
      }

      if (jobs.length === 0) {
        break;
      }

      allJobs.push(...relevantJobs);
      await sleep(REQUEST_DELAY_MS);
    }

    if (skipRemainingPagesForLocation) {
      continue;
    }
  }

  return uniqueJobs(allJobs);
}

function extractPostsFromSearchHtml(html, sourceLabel) {
  const $ = cheerio.load(html);
  const posts = [];

  const pushPost = (title, href, snippet) => {
    const link = normalizeSearchResultUrl(href);
    if (!title || !link || !isLikelyLinkedInPostUrl(link)) {
      return;
    }

    posts.push({
      title,
      snippet: snippet || "No snippet provided.",
      link,
      sourceTargets: sourceLabel ? [sourceLabel] : [],
    });
  };

  // Brave Search result structure
  $("div.snippet[data-type='web']").each((_, result) => {
    const element = $(result);
    const anchor = element.find("a[href*='linkedin.com']").first();
    const title =
      element.find("div.title").first().text().trim() ||
      element.find(".search-snippet-title").first().text().trim() ||
      anchor.text().trim();
    const href = anchor.attr("href") || "";
    const snippet =
      element.find("div.generic-snippet .content").first().text().replace(/\s+/g, " ").trim() ||
      element.find(".description").first().text().replace(/\s+/g, " ").trim();

    pushPost(title, href, snippet);
  });

  // DuckDuckGo fallback structure
  if (posts.length === 0) {
    $(".result").each((_, result) => {
      const element = $(result);
      const anchor = element.find("a.result__a").first();
      const title = anchor.text().trim();
      const href = anchor.attr("href") || "";
      const snippet =
        element.find(".result__snippet").first().text().trim() ||
        element.find(".result-snippet").first().text().trim() ||
        element.find(".result__body").text().trim();

      pushPost(title, href, snippet);
    });
  }

  return posts;
}

async function scrapeLinkedInPosts({ keywords, searchLocations, maxResults }) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const searchTargets = buildPostSearchTargets({ keywords, searchLocations });
  const allPosts = [];
  let stopSearch = false;

  for (const searchTarget of searchTargets) {
    for (const offset of POST_PAGE_OFFSETS) {
      const params = new URLSearchParams({
        q: searchTarget.query,
      });
      if (offset > 0) {
        params.set("offset", String(offset));
      }

      const braveUrl = `https://search.brave.com/search?${params.toString()}`;
      const ddgParams = new URLSearchParams({ q: searchTarget.query });
      if (offset > 0) {
        ddgParams.set("s", String(offset));
      }
      const ddgUrl = `https://duckduckgo.com/html/?${ddgParams.toString()}`;

      const providers = [
        { name: "brave", url: braveUrl },
        { name: "duckduckgo", url: ddgUrl },
      ];

      console.log(
        `[posts] Searching "${searchTarget.label}" (offset ${offset}) with query: ${searchTarget.query}`
      );

      let providerReturnedResults = false;

      for (const provider of providers) {
        try {
          const response = await fetchWithTimeout(provider.url, { headers }, 12000);
          if (!response.ok) {
            console.warn(
              `[posts] ${provider.name} failed for "${searchTarget.label}" (offset ${offset}) with status ${response.status}.`
            );
            continue;
          }

          const html = await response.text();
          const posts = extractPostsFromSearchHtml(html, searchTarget.label);
          const relevantPosts = posts.filter((post) =>
            isRelevantPostItem({
              title: post.title,
              snippet: post.snippet,
              keywords,
            })
          );
          console.log(
            `[posts] ${provider.name} "${searchTarget.label}" (offset ${offset}) returned ${posts.length} post candidates (${relevantPosts.length} relevant).`
          );
          allPosts.push(...relevantPosts);

          if (relevantPosts.length > 0) {
            providerReturnedResults = true;
            break;
          }
        } catch (error) {
          console.warn(
            `[posts] ${provider.name} failed for "${searchTarget.label}" (offset ${offset}): ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (!providerReturnedResults) {
        console.log(
          `[posts] No post candidates found for "${searchTarget.label}" at offset ${offset}.`
        );
      }

      if (uniquePosts(allPosts).length >= maxResults) {
        stopSearch = true;
        break;
      }

      await sleep(POST_SEARCH_DELAY_MS);
    }

    if (stopSearch) {
      break;
    }
  }

  return uniquePosts(allPosts).slice(0, maxResults);
}

function renderGroupedTextSection(title, groupedItems, renderItem) {
  const lines = [title];
  const appendGroup = (groupTitle, items) => {
    lines.push(groupTitle);
    if (items.length === 0) {
      lines.push("Geen resultaten.");
      lines.push("");
      return;
    }

    items.forEach((item, index) => {
      lines.push(renderItem(item, index + 1));
      lines.push("");
    });
  };

  appendGroup("Nieuw", groupedItems.today);
  appendGroup("Eerder deze week", groupedItems.earlierWeek);
  return lines.join("\n").trim();
}

function renderGroupedHtmlSection(title, groupedItems, renderItem) {
  const renderGroup = (groupTitle, items) => {
    if (items.length === 0) {
      return `<h5>${groupTitle}</h5><p>Geen resultaten.</p>`;
    }

    const listHtml = items.map((item, index) => renderItem(item, index + 1)).join("");
    return `<h5>${groupTitle}</h5><ol>${listHtml}</ol>`;
  };

  return `
    <h3>${title}</h3>
    ${renderGroup("Nieuw", groupedItems.today)}
    ${renderGroup("Eerder deze week", groupedItems.earlierWeek)}
  `;
}

function buildTopPostPreview(posts, limit = 5) {
  return posts.slice(0, limit);
}

function buildEmailContent({ jobs, posts, keywords, searchLocations }) {
  const now = new Date().toISOString();
  const criteriaLine =
    searchLocations.length > 0 ? `${keywords} in ${searchLocations.join(", ")}` : keywords;

  const sortedJobs = sortByPriority(jobs, {
    keywords,
    getSourceLabels: (job) => job.sourceSearchLocations || [],
    getDateInput: (job) => job.postedAt || "",
  });
  const sortedPostsInWindow = sortByPriority(posts, {
    keywords,
    getSourceLabels: (post) => post.sourceTargets || [],
    getDateInput: (post) => `${post.snippet || ""} ${post.title || ""}`,
  });

  const postsFallbackUsed = sortedPostsInWindow.length === 0 && posts.length > 0;
  const sortedPosts = postsFallbackUsed
    ? sortByPriority(posts, {
        keywords,
        getSourceLabels: (post) => post.sourceTargets || [],
        getDateInput: (post) => `${post.snippet || ""} ${post.title || ""}`,
        includeOlder: true,
      })
    : sortedPostsInWindow;

  const jobsByRecency = splitByRecency(sortedJobs);
  const postsByRecency = splitByRecency(sortedPosts);
  const topPostPreview = buildTopPostPreview(sortedPosts, 5);

  const jobsCount = sortedJobs.length;
  const postsCount = sortedPosts.length;

  const subject = `[LinkedIn Leads] Nieuw: ${jobsByRecency.today.length} vacatures / ${postsByRecency.today.length} posts · Eerder deze week: ${jobsByRecency.earlierWeek.length} vacatures / ${postsByRecency.earlierWeek.length} posts`;

  if (jobsCount === 0 && postsCount === 0) {
    return {
      subject,
      text: [
        `Dagelijkse LinkedIn check`,
        ``,
        `Zoekopdracht: ${criteriaLine}`,
        `Tijdstip: ${now}`,
        ``,
        `Geen vacatures of posts gevonden voor Nieuw of Eerder deze week.`,
      ].join("\n"),
      html: `
        <p><strong>Dagelijkse LinkedIn check</strong></p>
        <p>Zoekopdracht: <strong>${criteriaLine}</strong><br/>Tijdstip: ${now}</p>
        <p>Geen vacatures of posts gevonden voor Nieuw of Eerder deze week.</p>
      `,
    };
  }

  const jobsTextSection = renderGroupedTextSection("=== Vacatures ===", jobsByRecency, (job, index) => {
    const sourceLine =
      job.sourceSearchLocations && job.sourceSearchLocations.length > 0
        ? ` | Zoekregio: ${job.sourceSearchLocations.join(", ")}`
        : "";
    return `${index}. ${job.title} — ${job.company} (${job.location})\n   ${job.link}\n   Geplaatst: ${job.postedAt}${sourceLine}`;
  });

  const postsTextSection = renderGroupedTextSection(
    "=== Posts (mensen zoeken/huren) ===",
    postsByRecency,
    (post, index) =>
      `${index}. ${post.title}\n   ${post.link}\n   Context: ${post.snippet}\n   Zoekgebied: ${(post.sourceTargets || []).join(", ")}`
  );

  const jobsHtmlSection = renderGroupedHtmlSection("Vacatures", jobsByRecency, (job, index) => {
    const sourceLine =
      job.sourceSearchLocations && job.sourceSearchLocations.length > 0
        ? `<br/><em>Zoekregio: ${job.sourceSearchLocations.join(", ")}</em>`
        : "";
    return `
      <li style="margin-bottom:12px;">
        <a href="${job.link}"><strong>${index}. ${job.title}</strong></a><br/>
        ${job.company} &middot; ${job.location}<br/>
        Geplaatst: ${job.postedAt}${sourceLine}
      </li>
    `;
  });

  const postsHtmlSection = renderGroupedHtmlSection(
    "Posts (mensen zoeken/huren)",
    postsByRecency,
    (post, index) => `
      <li style="margin-bottom:12px;">
        <a href="${post.link}"><strong>${index}. ${post.title}</strong></a><br/>
        <em>Zoekgebied: ${(post.sourceTargets || []).join(", ")}</em><br/>
        Context: ${post.snippet}
      </li>
    `
  );

  return {
    subject,
    text: [
      `Dagelijkse LinkedIn check`,
      ``,
      `Zoekopdracht: ${criteriaLine}`,
      `Tijdstip: ${now}`,
      ``,
      `Vacatures totaal (Nieuw + Eerder deze week): ${jobsCount}`,
      `Posts totaal (Nieuw + Eerder deze week): ${postsCount}`,
      postsFallbackUsed
        ? `Let op: er zijn geen recente posts (Nieuw/Eerder deze week) gevonden; daarom tonen we oudere relevante posts als fallback.`
        : "",
      topPostPreview.length > 0 ? `Snelle post-links (top ${topPostPreview.length}):` : "",
      ...topPostPreview.map((post) => `- ${post.title}\n  ${post.link}`),
      ``,
      postsTextSection,
      ``,
      jobsTextSection,
    ].join("\n"),
    html: `
      <p><strong>Dagelijkse LinkedIn check</strong></p>
      <p>Zoekopdracht: <strong>${criteriaLine}</strong><br/>Tijdstip: ${now}</p>
      <p>
        Vacatures totaal (Nieuw + Eerder deze week): <strong>${jobsCount}</strong><br/>
        Posts totaal (Nieuw + Eerder deze week): <strong>${postsCount}</strong>
      </p>
      ${
        postsFallbackUsed
          ? `<p><em>Let op: er zijn geen recente posts (Nieuw/Eerder deze week) gevonden; daarom tonen we oudere relevante posts als fallback.</em></p>`
          : ""
      }
      ${
        topPostPreview.length > 0
          ? `<h3>Snelle post-links</h3><ul>${topPostPreview
              .map(
                (post) =>
                  `<li><a href="${post.link}"><strong>${post.title}</strong></a></li>`
              )
              .join("")}</ul>`
          : ""
      }
      ${postsHtmlSection}
      ${jobsHtmlSection}
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
  const searchLocations = getSearchLocations();
  const timeRange = readEnv("LINKEDIN_TIME_RANGE", DEFAULT_TIME_RANGE);
  const maxPages = readNumberEnv("LINKEDIN_MAX_PAGES", 4);
  const postsEnabled = readBooleanEnv("LINKEDIN_POSTS_ENABLED", DEFAULT_POSTS_ENABLED);
  const postsMaxResults = readNumberEnv("LINKEDIN_POSTS_MAX_RESULTS", DEFAULT_POSTS_MAX_RESULTS);

  const smtpHost = requiredEnv("SMTP_HOST");
  const smtpPort = readNumberEnv("SMTP_PORT", 587);
  const smtpSecure = readEnv("SMTP_SECURE", "").toLowerCase() === "true" || smtpPort === 465;
  const smtpUser = requiredEnv("SMTP_USER");
  const smtpPass = requiredEnv("SMTP_PASS");

  const to = readEnv("EMAIL_TO", DEFAULT_RECIPIENTS);
  const from = readEnv("EMAIL_FROM", smtpUser);

  console.log(
    `[config] keywords="${keywords}" locations="${searchLocations.join(", ")}" maxPages=${maxPages}`
  );
  console.log(`[config] postsEnabled=${postsEnabled} postsMaxResults=${postsMaxResults}`);
  console.log(`[config] email to="${to}" from="${from}"`);

  const jobs = await scrapeLinkedInJobs({
    keywords,
    searchLocations,
    timeRange,
    maxPages,
  });

  console.log(`[linkedin] Total unique jobs found: ${jobs.length}`);

  let posts = [];
  if (postsEnabled) {
    posts = await scrapeLinkedInPosts({
      keywords,
      searchLocations,
      maxResults: postsMaxResults,
    });
  } else {
    console.log(`[posts] Skipped because LINKEDIN_POSTS_ENABLED is disabled.`);
  }

  console.log(`[posts] Total unique post leads found: ${posts.length}`);

  const emailContent = buildEmailContent({
    jobs,
    posts,
    keywords,
    searchLocations,
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
