import { openai } from "@workspace/integrations-openai-ai-server";

export interface SearchTermData {
  searchTerm: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  cost?: number | null;
}

export interface SearchTermResult {
  searchTerm: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  cost?: number | null;
  relevance: "Relevant" | "Irrelevant";
  reason: string;
  addLevel: "Campaign" | "Ad Group" | "None";
  addAsKeyword: boolean;
  suggestedAdGroup?: string | null;
  isCompetitor: boolean;
  matchedKeyword?: string | null;
}

export interface AnalysisOptions {
  activeKeywords: string;
  searchTerms: string;
  accountName?: string;
  competitorBrands?: string[];
  excludePatterns?: string[];
  customRules?: string[];
  minConversionsForNewKeyword?: number;
  landingPageUrl?: string | null;
}

// ── Own-brand detection ───────────────────────────────────────────────────────

// Generic service/business words that are NOT brand identifiers
const GENERIC_BUSINESS_WORDS = new Set([
  "junk", "removal", "hauling", "service", "services", "cleaning", "movers",
  "moving", "disposal", "waste", "trash", "rubbish", "debris", "clutter",
  "llc", "inc", "co", "company", "group", "solutions", "pros", "team",
  "management", "enterprises", "local", "professional", "professionals",
]);

function extractBrandTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !GENERIC_BUSINESS_WORDS.has(w));
}

function isOwnBrandTerm(term: string, brandTokens: string[]): boolean {
  if (brandTokens.length === 0) return false;
  const termLower = term.toLowerCase();
  return brandTokens.some((token) => termLower.includes(token));
}

// ── Parser ────────────────────────────────────────────────────────────────────

// Header keyword sets for detecting header/metadata rows
const HEADER_KEYWORDS = new Set([
  "search term", "keyword", "match type", "campaign", "ad group", "clicks",
  "impressions", "impr.", "ctr", "cost", "conversions", "currency", "status",
  "added/excluded", "keyword status", "avg. cpc", "conv. rate",
]);

function looksLikeHeader(parts: string[]): boolean {
  const lower = parts[0]?.toLowerCase().trim() ?? "";
  return HEADER_KEYWORDS.has(lower) || lower === "";
}

function looksLikeMetaRow(line: string): boolean {
  const l = line.trim().toLowerCase();
  // Skip date ranges, empty, "total:", report title lines
  if (!l) return true;
  if (/^\d{4}/.test(l) || l.startsWith("total") || l.startsWith("--")) return true;
  // Lines like "May 3, 2026 - June 1, 2026"
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(l) && /\d{4}/.test(l)) return true;
  return false;
}

function safeNum(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[%,$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Parse Google Ads search term reports — handles both:
 *  - Simple format: term [tab] impressions [tab] clicks [tab] conversions [tab] cost
 *  - Full Google Ads export: Search term, Match type, Added/Excluded, Campaign, Ad group,
 *    Clicks, Impr., CTR, Currency code, Avg. CPC, Cost, Keyword, Conv. rate, Conversions, Cost / conv.
 */
function parseSearchTerms(raw: string): SearchTermData[] {
  const lines = raw.split(/\r?\n/);
  const results: SearchTermData[] = [];

  // Try to find header row and detect column indices
  let colSearchTerm = 0;
  let colClicks: number | null = null;
  let colImpressions: number | null = null;
  let colCost: number | null = null;
  let colConversions: number | null = null;
  let headerFound = false;

  for (const line of lines) {
    if (looksLikeMetaRow(line)) continue;
    const sep = line.includes("\t") ? "\t" : ",";
    const parts = line.split(sep).map((p) => p.trim().replace(/^["']|["']$/g, ""));

    if (!headerFound && looksLikeHeader(parts)) {
      // Map column names to indices
      const cols = parts.map((p) => p.toLowerCase().trim());
      colSearchTerm = Math.max(0, cols.findIndex((c) => c === "search term" || c === "keyword"));
      colClicks = cols.findIndex((c) => c === "clicks");
      colImpressions = cols.findIndex((c) => c === "impr." || c === "impressions");
      colCost = cols.findIndex((c) => c === "cost");
      colConversions = cols.findIndex((c) => c === "conversions");
      headerFound = true;
      continue;
    }

    const term = parts[colSearchTerm]?.trim();
    if (!term || term.toLowerCase() === "total") continue;

    if (!headerFound) {
      // Simple 5-column format fallback
      results.push({
        searchTerm: term,
        impressions: safeNum(parts[1]),
        clicks: safeNum(parts[2]),
        conversions: safeNum(parts[3]),
        cost: safeNum(parts[4]),
      });
    } else {
      results.push({
        searchTerm: term,
        impressions: colImpressions != null && colImpressions >= 0 ? safeNum(parts[colImpressions]) : null,
        clicks: colClicks != null && colClicks >= 0 ? safeNum(parts[colClicks]) : null,
        conversions: colConversions != null && colConversions >= 0 ? safeNum(parts[colConversions]) : null,
        cost: colCost != null && colCost >= 0 ? safeNum(parts[colCost]) : null,
      });
    }
  }

  return results;
}

// ── URL scraping ──────────────────────────────────────────────────────────────

async function fetchPageText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SQRAnalyzer/1.0)" },
    });
    clearTimeout(timeout);
    const html = await resp.text();
    // Strip tags, collapse whitespace, limit length
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 3000);
    return text;
  } catch {
    return "";
  }
}

// ── Parallel batch runner ─────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── AI batch analysis ─────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const CONCURRENCY = 8;

async function analyzeTermsBatch(
  terms: SearchTermData[],
  activeKeywords: string,
  options: AnalysisOptions,
  pageContext: string
): Promise<SearchTermResult[]> {
  const competitorList = options.competitorBrands?.length
    ? `Competitor brands to flag as negatives: ${options.competitorBrands.join(", ")}`
    : "No specific competitor brands provided.";

  const excludeList = options.excludePatterns?.length
    ? `Exclude patterns (mark irrelevant if term contains any): ${options.excludePatterns.join(", ")}`
    : "";

  const customRulesList = options.customRules?.length
    ? `Custom rules:\n${options.customRules.map((r) => `- ${r}`).join("\n")}`
    : "";

  const minConversions = options.minConversionsForNewKeyword ?? 1;

  const pageSection = pageContext
    ? `\nLanding page content (use to judge relevance — terms matching what this page sells are Relevant):\n"""\n${pageContext}\n"""\n`
    : "";

  const ownBrandSection = options.accountName
    ? `\nOWN BRAND: The account being analyzed is "${options.accountName}". Search terms that reference THIS account's own brand name are NOT competitors — do NOT set isCompetitor=true for them. Only set isCompetitor=true for search terms that clearly reference a DIFFERENT competing brand.\n`
    : "";

  const termsJson = JSON.stringify(
    terms.map((t) => ({
      searchTerm: t.searchTerm,
      impressions: t.impressions,
      clicks: t.clicks,
      conversions: t.conversions,
      cost: t.cost,
    }))
  );

  const prompt = `You are a Google Ads search query analysis expert following Search Engine Land best practices.

Active Keywords in this account (keyword | match type | ad group):
${activeKeywords || "Not provided"}
${pageSection}${ownBrandSection}
${competitorList}
${excludeList ? excludeList + "\n" : ""}${customRulesList ? customRulesList + "\n" : ""}
Rules:
1. RELEVANCE: "Relevant" if the term matches the business intent (what the landing page sells, or what the active keywords target). "Irrelevant" if off-topic, navigational to another brand, or too informational with no purchase intent.
2. COMPETITOR: isCompetitor=true ONLY if the term contains a DIFFERENT competitor brand name — these need to be added as negatives. NEVER flag own-brand terms as competitors (see OWN BRAND above).
3. ADD LEVEL: "Campaign" = broadly irrelevant to all ad groups; "Ad Group" = irrelevant to only one ad group; "None" = relevant (no negative needed).
4. ADD AS KEYWORD: addAsKeyword=true ONLY if: relevant AND >= ${minConversions} conversions AND not already covered by an existing exact-match keyword.
5. SUGGESTED AD GROUP: If addAsKeyword=true, suggest the best ad group from the active keywords list.
6. MATCHED KEYWORD: The active keyword this search term matched or is closest to.
7. REASON: Be concise and specific (max 15 words).

Search terms to analyze:
${termsJson}

Return ONLY a valid JSON array with exactly ${terms.length} objects, one per search term, in this exact format — no markdown, no explanation:
[{"searchTerm":"...","relevance":"Relevant","reason":"...","addLevel":"None","addAsKeyword":false,"suggestedAdGroup":null,"isCompetitor":false,"matchedKeyword":"..."}]`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "[]";
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Could not parse AI response as JSON array");

  const parsed = JSON.parse(match[0]) as Array<{
    searchTerm: string;
    relevance: "Relevant" | "Irrelevant";
    reason: string;
    addLevel: "Campaign" | "Ad Group" | "None";
    addAsKeyword: boolean;
    suggestedAdGroup: string | null;
    isCompetitor: boolean;
    matchedKeyword: string | null;
  }>;

  return parsed.map((item, i) => ({
    ...terms[i],
    searchTerm: item.searchTerm ?? terms[i]?.searchTerm ?? "",
    relevance: item.relevance ?? "Irrelevant",
    reason: item.reason ?? "",
    addLevel: item.addLevel ?? "None",
    addAsKeyword: item.addAsKeyword ?? false,
    suggestedAdGroup: item.suggestedAdGroup ?? null,
    isCompetitor: item.isCompetitor ?? false,
    matchedKeyword: item.matchedKeyword ?? null,
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeSearchQueries(options: AnalysisOptions): Promise<SearchTermResult[]> {
  const terms = parseSearchTerms(options.searchTerms);
  if (terms.length === 0) return [];

  // Fetch landing page context in parallel with setup
  const pageContext = options.landingPageUrl
    ? await fetchPageText(options.landingPageUrl)
    : "";

  // Split into batches
  const batches: SearchTermData[][] = [];
  for (let i = 0; i < terms.length; i += BATCH_SIZE) {
    batches.push(terms.slice(i, i + BATCH_SIZE));
  }

  // Run all batches in parallel (up to CONCURRENCY at once)
  const tasks = batches.map(
    (batch) => () => analyzeTermsBatch(batch, options.activeKeywords, options, pageContext)
  );

  const batchResults = await runWithConcurrency(tasks, CONCURRENCY);
  const allResults = batchResults.flat();

  // Post-process: un-flag own-brand terms that the AI incorrectly marked as competitors
  if (options.accountName) {
    const brandTokens = extractBrandTokens(options.accountName);
    if (brandTokens.length > 0) {
      for (const r of allResults) {
        if (r.isCompetitor && isOwnBrandTerm(r.searchTerm, brandTokens)) {
          r.isCompetitor = false;
        }
      }
    }
  }

  return allResults;
}
