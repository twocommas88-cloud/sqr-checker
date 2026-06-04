import { openai } from "@workspace/integrations-openai-ai-server";

export interface SearchTermData {
  searchTerm: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  cost?: number | null;
  campaignName?: string | null;
  adGroupName?: string | null;
}

export interface SearchTermResult {
  searchTerm: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  cost?: number | null;
  campaignName?: string | null;
  adGroupName?: string | null;
  relevance: "Relevant" | "Irrelevant";
  reason: string;
  addLevel: "Campaign" | "Ad Group" | "None";
  addAsKeyword: boolean;
  suggestedAdGroup?: string | null;
  isCompetitor: boolean;
  matchedKeyword?: string | null;
  outOfAreaLocation?: string | null;
  relevanceScore?: number | null;
  /** Suggested negative term — the specific irrelevant word/phrase to add as a negative keyword (e.g., "how to" or "careers"), NOT the full search term. Only set when the term contains a brand name + an irrelevant modifier. */
  suggestedNegativeTerm?: string | null;
  /** English translation of the search term if it is not in English. Used for relevance analysis. */
  translation?: string | null;
}

export interface AnalysisOptions {
  activeKeywords: string;
  searchTerms: string;
  accountName?: string;
  targetLocations?: string | null;
  relevantBrandTerms?: string | null;
  competitorBrands?: string[];
  excludePatterns?: string[];
  customRules?: string[];
  minConversionsForNewKeyword?: number;
  landingPageUrl?: string | null;
}

// ── Location helper ───────────────────────────────────────────────────────────

function normalizeTargetLocations(locations: string): string[] {
  // Split by comma, semicolon, or newline
  const parts = locations.split(/[,;\n]+/);
  const normalized = new Set<string>();
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed) {
      // Add the exact value (e.g., "TN", "Georgia", "Atlanta")
      normalized.add(trimmed);
      // Also add lowercased version for flexible matching
      normalized.add(trimmed.toLowerCase());
    }
  }
  return Array.from(normalized);
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
 * Escape unescaped double quotes inside JSON string values.
 * Walks the JSON character by character, tracking whether we're inside a string,
 * and escapes any unescaped quotes that appear inside string values.
 */
function escapeUnescapedQuotes(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let lastNonStringChar = "";

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        // Look ahead: is this quote followed by a JSON structural character?
        // Valid JSON structure: after a key name, we see ':'
        // After a value, we see ',' or '}' or ']'
        const next = json[i + 1];
        const nextNonSpace = next === " " || next === "\n" || next === "\t" ? json[i + 2] : next;
        // A closing quote is followed by structural end-of-value chars OR ':' (end of key name)
        if (
          next === undefined ||
          next === "," ||
          next === "}" ||
          next === "]" ||
          next === " " ||
          next === "\n" ||
          next === "\t" ||
          next === ":"
        ) {
          // Closing quote
          result += ch;
          inString = false;
        } else {
          // Unescaped quote inside string value — escape it
          result += '\\"';
        }
      } else {
        result += ch;
        inString = true;
      }
      continue;
    }

    result += ch;
  }

  return result;
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
  let colCampaign: number | null = null;
  let colAdGroup: number | null = null;
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
      colCampaign = cols.findIndex((c) => c === "campaign" || c === "campaign name");
      colAdGroup = cols.findIndex((c) => c === "ad group" || c === "ad group name");
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
        campaignName: colCampaign != null && colCampaign >= 0 ? parts[colCampaign] : null,
        adGroupName: colAdGroup != null && colAdGroup >= 0 ? parts[colAdGroup] : null,
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

  const relevantBrandSection = options.relevantBrandTerms?.trim()
    ? `\nRELEVANT BRAND TERMS: The following brand names should ALWAYS be considered Relevant (even if they also look like competitors — they are your own brands or partner brands): ${options.relevantBrandTerms.trim()}
- IMPORTANT: Recognize and match VARIATIONS of these brand names — different spellings, misspellings, abbreviations, hyphens, spaces, and combined forms. For example, if brand is "JunkBros", also recognize "junkbros", "junk-bros", "junk bros", "junk bros llc", "junkbrosco", "junk brosco", etc. Any term that contains ANY recognizable variation of these brand names should be marked as Relevant and NOT as a competitor.\n`
    : "";

  const locationSection = options.targetLocations?.trim()
    ? `\nTARGET SERVICE LOCATIONS: ${options.targetLocations.trim()}
LOCATION MATCHING RULES — READ CAREFULLY:
- The location list above may include: city names, state names, state abbreviations (e.g., "FL" means Florida), county names, ZIP codes, or radius descriptions (e.g., "50 miles around Austin", "within 30 miles of Dallas").
- When matching locations, you MUST be flexible with: abbreviations, misspellings, partial matches, and common variants.
  Examples: "FL" matches "Florida", "florida", "floridas"; "KY" matches "Kentucky", "kentucky", "kentuckys"; "NYC" matches "New York", "new york city", "ny".
  IMPORTANT: The locations list may be entered with spaces only (e.g., "FL KY Nashville"). When the list is space-separated, treat each word/abbreviation as a separate location. "FL" means the entire state of Florida. "KY" means the entire state of Kentucky.
- If a state abbreviation is in the target list (e.g., "FL"), any city or location KNOWN to be in that state is ALSO considered in the target area. For example: "FL" is in the target list, and "Tampa" is a city in Florida, so "Tampa" is in the target area. "KY" is in the target list, and "Louisville" is a city in Kentucky, so "Louisville" is in the target area.
- CRITICAL: If the search term contains a state abbreviation that IS in the target list (e.g., "TN" is in the target list and the term contains "TN"), then the term is ALWAYS geographically relevant. Do NOT flag it as out-of-area. The same applies to city names that are in the target list.
- CRITICAL: Only flag a term as out-of-area when you are 100% certain the location is OUTSIDE the target area. If you are uncertain about a city's location, DO NOT flag it as out-of-area. Err on the side of Relevant.
- Search terms that mention a specific location OUTSIDE the target area → Irrelevant (addLevel: "Campaign"), reason: "Outside target service area", and set outOfAreaLocation to the location name found.
- Search terms with NO location or a location IN the target area → treat as geographically relevant (location alone does not make a term irrelevant).
- Generic location terms (e.g. "near me", "local", "close by") → geographically relevant.
- Specific addresses (e.g. "123 Main St, Austin TX") → if the city/area is in the target list, treat as relevant; if clearly outside, treat as irrelevant.
- Radius descriptions: if a term mentions a location WITHIN the described radius (e.g., a city 20 miles from Austin when the radius is 50 miles), treat as relevant.\n`
    : "";

  const termsJson = JSON.stringify(
    terms.map((t) => ({
      searchTerm: t.searchTerm,
      campaignName: t.campaignName,
      adGroupName: t.adGroupName,
      impressions: t.impressions,
      clicks: t.clicks,
      conversions: t.conversions,
      cost: t.cost,
    }))
  );

  const prompt = `You are a Google Ads search query analysis expert following Search Engine Land best practices.

Active Keywords in this account (keyword | match type | ad group):
${activeKeywords || "Not provided"}
${pageSection}${ownBrandSection}${relevantBrandSection}${locationSection}
${competitorList}
${excludeList ? excludeList + "\n" : ""}${customRulesList ? customRulesList + "\n" : ""}
RELEVANCE PHILOSOPHY — READ CAREFULLY:
- The active keywords above define what this business offers. Any search term that is semantically related to those keywords — even if broad, generic, or short — is RELEVANT.
- Broad service terms ARE relevant. Example: if the business does "junk removal", then "junk", "hauling", "pickup", "pick up", "mattress disposal" are ALL relevant — they represent people looking for the service.
- Do NOT mark terms irrelevant just because they are short, broad, or high-funnel. Broad terms that match the service category are still potential customers.
- Mark Irrelevant ONLY when the term is: (1) clearly a different industry/service, (2) navigating to a competitor brand, (3) outside the target service area, (4) explicitly excluded by rules below, or (5) purely informational with zero commercial intent (e.g. "what is junk removal" — but even then be conservative).
- When in doubt, lean Relevant.

Rules:
1. RELEVANCE: Apply the philosophy above. Use active keywords + landing page content as the primary signal.
2. COMPETITOR: isCompetitor=true ONLY if the term contains a DIFFERENT competitor brand name — these need to be added as negatives. NEVER flag own-brand terms as competitors (see OWN BRAND above).
3. ADD LEVEL: "Campaign" = broadly irrelevant to all ad groups; "Ad Group" = irrelevant only to one specific ad group; "None" = relevant (no negative needed).
4. ADD AS KEYWORD: addAsKeyword=true ONLY if: relevant AND has conversions (conversions > 0) AND >= ${minConversions} conversions AND not already covered by an existing exact-match keyword. If a term has 0 conversions, ALWAYS set addAsKeyword=false regardless of relevance.
5. SUGGESTED AD GROUP: If addAsKeyword=true, suggest the best ad group from the active keywords list.
6. MATCHED KEYWORD: The active keyword this search term matched or is closest to.
7. REASON: Be concise and specific (max 15 words).

Search terms to analyze:
${termsJson}

Return ONLY a valid JSON array with exactly ${terms.length} objects, one per search term, in this exact format — no markdown, no explanation:
[{"searchTerm":"...","translation":"English translation if non-English, otherwise null","relevance":"Relevant","reason":"...","addLevel":"None","addAsKeyword":false,"suggestedAdGroup":null,"isCompetitor":false,"matchedKeyword":"...","outOfAreaLocation":null,"relevanceScore":85,"suggestedNegativeTerm":null}]

TRANSLATION RULES:
- If the search term is in English, set translation to null.
- If the search term is in ANY other language, provide the English translation of the term. The translation should be the literal meaning of the search term, not an interpretation.
- Use the English translation (when available) to determine relevance against the active keywords.
- For example: "пломбир москва" → translation: "plumber moscow" → relevance: Irrelevant (out of area)
- Non-English terms must be evaluated using their English translation to determine if they match the business services.

relevanceScore field: Assess how closely this search term matches the business's core offerings (0-100). Use this scale:
- 90-100: Exact match or highly specific intent (e.g., "emergency plumbing repair" for a plumbing company)
- 70-89: Strong match, clear service intent (e.g., "leak repair" for a plumber)
- 50-69: Moderate match, some ambiguity (e.g., "pipe" for a plumber — could be a pipe supply store)
- 30-49: Weak match, borderline or broad (e.g., "water" for a plumber — too broad, could be anything water-related)
- 0-29: Very weak or irrelevant match (e.g., "how to paint a room" for a plumber)
- For "Relevant" terms: score should be 50-100 (higher for more specific intent)
- For "Irrelevant" terms: score should be 0-49 (lower for clearer irrelevance)

CRITICAL RULES FOR JSON OUTPUT:
- The "relevance" field MUST be exactly "Relevant" or "Irrelevant" — no other text, no sentence, no explanation. Just the single word.
- The "reason" field MUST be a separate concise sentence (max 15 words). Never put the reason text inside the "relevance" field.
- The "addAsKeyword" field MUST be false when the search term has 0 conversions. Only recommend as a new keyword when conversions > 0.
- The "addLevel" field MUST be "None" when addAsKeyword is false.
- Never suggest core service terms as negative terms — these are the words that define the business's primary offerings (e.g., terms from the active keywords list, words that represent the main products/services). Core business terms must remain Relevant.
- For any business type (not just junk removal): identify what the ACTIVE KEYWORDS reveal as the core business terms and NEVER mark those as irrelevant or suggest them as negatives.
- suggestedNegativeTerm: For any IRRELEVANT term, extract the specific word or short phrase that makes it irrelevant — this is what the advertiser should add as a Google Ads negative keyword to prevent wasted spend. Set to null for Relevant terms. Examples by category:
  - Web/directory noise: "junk removal .com" → ".com" | "www junk removal" → "www" | "junk removal website" → "website"
  - Social/video platforms: "junk bros facebook" → "facebook" | "junk removal youtube" → "youtube" | "junk removal instagram" → "instagram" | "junk removal reddit" → "reddit" | "junk removal yelp" → "yelp"
  - Informational/DIY intent: "how to remove junk yourself" → "how to" | "diy junk removal" → "diy" | "junk removal tutorial" → "tutorial" | "junk removal tips" → "tips" | "junk removal guide" → "guide"
  - Employment: "junk removal jobs near me" → "jobs" | "junk removal careers" → "careers" | "junk removal salary" → "salary" | "junk removal hiring" → "hiring"
  - Brand + irrelevant modifier: "Junk Bros how to" → "how to" | "Junk Bros reviews" → "reviews" | "Junk Bros complaints" → "complaints"
  - Out-of-area: set to null — the location is already captured in outOfAreaLocation
  - Competitor brand terms: set to null — the competitor brand is already captured in isCompetitor
  - Completely unrelated terms with no extractable modifier (e.g. "buy a car"): set to null
  - NEVER suggest core service/business terms as negatives (words from active keywords list)
  - The suggested negative MUST be SHORT (1-3 words max) — the actual word/phrase to type into Google Ads negative keywords, NOT the full search term
- Keep the exact JSON field order shown above.

outOfAreaLocation: If the term is flagged as outside the target service area, set this to the specific location word or phrase found in the search term that is NOT in the target locations list (e.g. "lewisburg", "nashville"). Otherwise null.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "[]";

  // Try to extract the JSON array — first find the outermost balanced array
  let jsonText: string | null = null;

  // Strategy 1: find the first '[' and the last ']' to capture the full array
  const firstBracket = content.indexOf("[");
  const lastBracket = content.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    jsonText = content.slice(firstBracket, lastBracket + 1);
  }

  // Strategy 2: if the whole content looks like an array, use it
  if (!jsonText && content.trim().startsWith("[") && content.trim().endsWith("]")) {
    jsonText = content.trim();
  }

  // Strategy 3: if nothing works, try a regex
  if (!jsonText) {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) jsonText = match[0];
  }

  if (!jsonText) {
    throw new Error("Could not extract JSON array from AI response");
  }

  let parsed: Array<{
    searchTerm: string;
    relevance: "Relevant" | "Irrelevant";
    reason: string;
    addLevel: "Campaign" | "Ad Group" | "None";
    addAsKeyword: boolean;
    suggestedAdGroup: string | null;
    isCompetitor: boolean;
    matchedKeyword: string | null;
    outOfAreaLocation: string | null;
    relevanceScore: number | null;
    suggestedNegativeTerm: string | null;
    translation: string | null;
  }>;

  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    // Aggressive JSON repair for AI-generated malformed JSON
    let cleaned = jsonText;

    // 1. Remove trailing commas before } or ]
    cleaned = cleaned.replace(/,(\s*[\}\]])/g, "$1");

    // 2. Remove newlines and tabs inside strings (replace with space)
    cleaned = cleaned.replace(/\n/g, " ");
    cleaned = cleaned.replace(/\t/g, " ");

    // 3. Remove control characters (0x00-0x1F except tab/newline which we already handled)
    cleaned = cleaned.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "");

    // 4. Fix unescaped quotes inside string values using a proper tokenizer
    //    This is the most reliable way to handle quotes inside JSON strings
    cleaned = escapeUnescapedQuotes(cleaned);

    // 5. Remove any BOM or zero-width characters
    cleaned = cleaned.replace(/\ufeff/g, "");

    // 6. If the AI wrapped the JSON in markdown code blocks, remove them
    cleaned = cleaned.replace(/^```json\s*/i, "");
    cleaned = cleaned.replace(/```\s*$/i, "");

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try using the raw content instead of the extracted text
      try {
        const rawMatch = content.match(/\[[\s\S]*\]/);
        if (rawMatch && rawMatch[0] !== jsonText) {
          parsed = JSON.parse(rawMatch[0]);
        } else {
          throw new Error("AI response is not valid JSON");
        }
      } catch {
        // Last resort: try to parse object-by-object and reconstruct
        try {
          const objects: Array<Record<string, unknown>> = [];
          const objRegex = /\{[^{}]*\}/g;
          let m: RegExpExecArray | null;
          while ((m = objRegex.exec(cleaned)) !== null) {
            try {
              const obj = JSON.parse(m[0]);
              objects.push(obj);
            } catch {
              // Skip malformed individual objects
            }
          }
          if (objects.length > 0) {
            parsed = objects as unknown as typeof parsed;
          } else {
            throw new Error("AI response is not valid JSON after all attempts: " + (err as Error).message);
          }
        } catch {
          throw new Error("AI response is not valid JSON after all attempts: " + (err as Error).message);
        }
      }
    }
  }

  return parsed.map((item, i) => ({
    ...terms[i],
    searchTerm: item.searchTerm ?? terms[i]?.searchTerm ?? "",
    // Relevance MUST be strictly "Relevant" or "Irrelevant" — normalize anything else
    relevance: item.relevance === "Relevant" ? "Relevant" : "Irrelevant",
    reason: item.reason ?? "",
    addLevel: item.addLevel ?? "None",
    addAsKeyword: item.addAsKeyword ?? false,
    suggestedAdGroup: item.suggestedAdGroup ?? null,
    isCompetitor: item.isCompetitor ?? false,
    matchedKeyword: item.matchedKeyword ?? null,
    outOfAreaLocation: item.outOfAreaLocation ?? null,
    relevanceScore: item.relevanceScore ?? null,
    suggestedNegativeTerm: item.suggestedNegativeTerm ?? null,
    translation: item.translation ?? null,
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

  // Post-process: correct AI out-of-area mistakes for known locations
  const targetLocations = options.targetLocations?.trim() ?? "";
  if (targetLocations) {
    const normalizedTargets = normalizeTargetLocations(targetLocations);
    for (const r of allResults) {
      const termLower = r.searchTerm.toLowerCase();
      // If the search term contains a known target location, and the AI flagged it
      // as out-of-area, correct it
      const found = normalizedTargets.find((loc) => termLower.includes(loc.toLowerCase()));
      if (found) {
        if (r.relevance === "Irrelevant" && (r.reason.toLowerCase().includes("area") || r.outOfAreaLocation)) {
          r.relevance = "Relevant";
          r.reason = "Matches target service area";
          r.addLevel = "None";
          r.outOfAreaLocation = null;
        }
      }
    }
  }

  return allResults;
}
