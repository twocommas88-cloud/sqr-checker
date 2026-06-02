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
  competitorBrands?: string[];
  excludePatterns?: string[];
  customRules?: string[];
  minConversionsForNewKeyword?: number;
}

function parseSearchTerms(raw: string): SearchTermData[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    // Try tab-separated first, then comma-separated
    const parts = line.includes("\t") ? line.split("\t") : line.split(",");
    const searchTerm = parts[0]?.trim() ?? line.trim();
    const impressions = parts[1] ? parseFloat(parts[1].trim()) : null;
    const clicks = parts[2] ? parseFloat(parts[2].trim()) : null;
    const conversions = parts[3] ? parseFloat(parts[3].trim()) : null;
    const cost = parts[4] ? parseFloat(parts[4].trim()) : null;
    return {
      searchTerm,
      impressions: isNaN(impressions!) ? null : impressions,
      clicks: isNaN(clicks!) ? null : clicks,
      conversions: isNaN(conversions!) ? null : conversions,
      cost: isNaN(cost!) ? null : cost,
    };
  });
}

const BATCH_SIZE = 30;

async function analyzeTermsBatch(
  terms: SearchTermData[],
  activeKeywords: string,
  options: AnalysisOptions
): Promise<SearchTermResult[]> {
  const competitorList = options.competitorBrands?.length
    ? `Competitor brands to flag as negative: ${options.competitorBrands.join(", ")}`
    : "No specific competitor brands provided.";

  const excludeList = options.excludePatterns?.length
    ? `Exclude patterns (mark irrelevant): ${options.excludePatterns.join(", ")}`
    : "";

  const customRulesList = options.customRules?.length
    ? `Custom rules:\n${options.customRules.map((r) => `- ${r}`).join("\n")}`
    : "";

  const minConversions = options.minConversionsForNewKeyword ?? 1;

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

Active Keywords in this account (with match type and ad group where provided):
${activeKeywords || "Not provided"}

${competitorList}
${excludeList}
${customRulesList}

Rules for analysis:
1. RELEVANCE: A search term is "Relevant" if it matches the intent of the active keywords and would convert for this business. Mark "Irrelevant" if it's off-topic, too broad, navigational to a different site, or matches a competitor brand.
2. COMPETITOR: Flag as competitor (isCompetitor: true) if the term contains a competitor brand name. These should be added to negative keyword lists.
3. ADD LEVEL:
   - "Campaign": Add as negative at campaign level if it's broadly irrelevant to all ad groups
   - "Ad Group": Add as negative at ad group level if it's only irrelevant to a specific ad group
   - "None": If the term is relevant, no negative needed
4. ADD AS KEYWORD: Set addAsKeyword: true ONLY if: term is relevant AND has >= ${minConversions} conversions AND is not already covered by an exact-match active keyword.
5. SUGGESTED AD GROUP: If addAsKeyword is true, suggest which ad group this new keyword belongs in based on the active keywords list. If the term could also apply to a campaign-level negative strategy, note that.
6. MATCH TYPE RECOMMENDATION: Consider whether the new keyword should be exact, phrase, or broad match based on specificity.
7. REASON: Be specific and actionable. Reference the matched keyword if relevant.

Search terms to analyze:
${termsJson}

Return a JSON array (no markdown, no explanation, just valid JSON array) with exactly one object per search term in this format:
[
  {
    "searchTerm": "exact term from input",
    "relevance": "Relevant" or "Irrelevant",
    "reason": "specific reason",
    "addLevel": "Campaign" or "Ad Group" or "None",
    "addAsKeyword": true or false,
    "suggestedAdGroup": "Ad Group Name" or null,
    "isCompetitor": true or false,
    "matchedKeyword": "the active keyword it matched" or null
  }
]`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.1",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "[]";
  
  // Extract JSON array from response
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("Could not parse AI response as JSON array");
  }
  
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

export async function analyzeSearchQueries(options: AnalysisOptions): Promise<SearchTermResult[]> {
  const terms = parseSearchTerms(options.searchTerms);
  const results: SearchTermResult[] = [];

  for (let i = 0; i < terms.length; i += BATCH_SIZE) {
    const batch = terms.slice(i, i + BATCH_SIZE);
    const batchResults = await analyzeTermsBatch(batch, options.activeKeywords, options);
    results.push(...batchResults);
  }

  return results;
}
