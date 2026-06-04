import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, analyses } from "@workspace/db";
import {
  CreateAnalysisBody,
  GetAnalysisParams,
} from "@workspace/api-zod";
import { analyzeSearchQueries, type SearchTermResult } from "../lib/sqrAnalyzer";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const MAX_CONCURRENT_ANALYSES = 3;
const processingQueue: Array<{ id: number; fn: () => Promise<void> }> = [];
let activeAnalyses = 0;

async function processQueue() {
  if (activeAnalyses >= MAX_CONCURRENT_ANALYSES || processingQueue.length === 0) return;
  const item = processingQueue.shift();
  if (!item) return;
  activeAnalyses++;
  await db.update(analyses).set({ status: "processing" }).where(eq(analyses.id, item.id));
  try {
    await item.fn();
  } catch (err) {
    logger.error({ err, analysisId: item.id }, "Queued analysis failed");
  } finally {
    activeAnalyses--;
    processQueue();
  }
}

function getSessionId(req: any): string {
  return req.sessionId ?? "default";
}

function parseRow(row: typeof analyses.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as "pending" | "processing" | "completed" | "failed",
    ruleSetId: row.ruleSetId ?? null,
    activeKeywords: row.activeKeywords,
    targetLocations: row.targetLocations ?? null,
    landingPageUrl: row.landingPageUrl ?? null,
    relevantBrandTerms: row.relevantBrandTerms ?? null,
    searchTerms: row.searchTerms,
    competitorBrands: JSON.parse(row.competitorBrands) as string[],
    excludePatterns: JSON.parse(row.excludePatterns) as string[],
    customRules: JSON.parse(row.customRules) as string[],
    minConversionsForNewKeyword: row.minConversionsForNewKeyword,
    totalTerms: row.totalTerms,
    relevantCount: row.relevantCount,
    irrelevantCount: row.irrelevantCount,
    newKeywordCount: row.newKeywordCount,
    competitorCount: row.competitorCount,
    results: JSON.parse(row.results),
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseSummaryRow(row: typeof analyses.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status as "pending" | "processing" | "completed" | "failed",
    ruleSetId: row.ruleSetId ?? null,
    totalTerms: row.totalTerms,
    relevantCount: row.relevantCount,
    irrelevantCount: row.irrelevantCount,
    newKeywordCount: row.newKeywordCount,
    competitorCount: row.competitorCount,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/analyses/stats", async (req, res): Promise<void> => {
  const sessionId = getSessionId(req);
  const rows = await db.select().from(analyses).where(and(eq(analyses.status, "completed"), eq(analyses.sessionId, sessionId)));
  const totalAnalyses = rows.length;
  const totalTermsAnalyzed = rows.reduce((sum, r) => sum + r.totalTerms, 0);
  const avgRelevanceRate =
    totalTermsAnalyzed > 0
      ? rows.reduce((sum, r) => sum + r.relevantCount, 0) / totalTermsAnalyzed
      : 0;

  const competitorCounts: Record<string, number> = {};
  for (const row of rows) {
    const results = JSON.parse(row.results) as Array<{ isCompetitor: boolean; searchTerm: string }>;
    for (const r of results) {
      if (r.isCompetitor) {
        const term = r.searchTerm.toLowerCase();
        competitorCounts[term] = (competitorCounts[term] ?? 0) + 1;
      }
    }
  }
  const topCompetitors = Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term);

  res.json({ totalAnalyses, totalTermsAnalyzed, avgRelevanceRate, topCompetitors });
});

router.get("/analyses", async (req, res): Promise<void> => {
  const sessionId = getSessionId(req);
  const rows = await db.select().from(analyses).where(eq(analyses.sessionId, sessionId)).orderBy(desc(analyses.createdAt));
  res.json(rows.map(parseSummaryRow));
});

router.post("/analyses", async (req, res): Promise<void> => {
  const parsed = CreateAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const name = data.name ?? `Analysis ${new Date().toLocaleDateString()}`;

  const sessionId = getSessionId(req);
  const [row] = await db
    .insert(analyses)
    .values({
      sessionId,
      name,
      status: "queued",
      ruleSetId: data.ruleSetId ?? null,
      activeKeywords: data.activeKeywords,
      searchTerms: data.searchTerms,
      landingPageUrl: data.landingPageUrl ?? null,
      targetLocations: data.targetLocations ?? null,
      relevantBrandTerms: data.relevantBrandTerms ?? null,
      competitorBrands: JSON.stringify(data.competitorBrands ?? []),
      excludePatterns: JSON.stringify(data.excludePatterns ?? []),
      customRules: JSON.stringify(data.customRules ?? []),
      minConversionsForNewKeyword: data.minConversionsForNewKeyword ?? 1,
    })
    .returning();

  res.status(201).json(parseRow(row));

  processingQueue.push({
    id: row.id,
    fn: async () => {
      try {
        const results = await analyzeSearchQueries({
          activeKeywords: data.activeKeywords,
          searchTerms: data.searchTerms,
          accountName: data.name ?? undefined,
          targetLocations: data.targetLocations ?? null,
          landingPageUrl: data.landingPageUrl ?? null,
          relevantBrandTerms: data.relevantBrandTerms ?? null,
          competitorBrands: data.competitorBrands ?? [],
          excludePatterns: data.excludePatterns ?? [],
          customRules: data.customRules ?? [],
          minConversionsForNewKeyword: data.minConversionsForNewKeyword ?? 1,
        });

        const relevantCount = results.filter((r) => r.relevance === "Relevant").length;
        const irrelevantCount = results.filter((r) => r.relevance === "Irrelevant").length;
        const newKeywordCount = results.filter((r) => r.addAsKeyword).length;
        const competitorCount = results.filter((r) => r.isCompetitor).length;

        await db
          .update(analyses)
          .set({
            status: "completed",
            totalTerms: results.length,
            relevantCount,
            irrelevantCount,
            newKeywordCount,
            competitorCount,
            results: JSON.stringify(results),
          })
          .where(eq(analyses.id, row.id));
      } catch (err) {
        logger.error({ err, analysisId: row.id }, "Analysis failed");
        await db
          .update(analyses)
          .set({
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          })
          .where(eq(analyses.id, row.id));
      }
    },
  });
  processQueue();
});

router.delete("/analyses/:id", async (req, res): Promise<void> => {
  const parsed = GetAnalysisParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sessionId = getSessionId(req);
  const [row] = await db.select().from(analyses).where(and(eq(analyses.id, parsed.data.id), eq(analyses.sessionId, sessionId)));
  if (!row) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  await db.delete(analyses).where(and(eq(analyses.id, parsed.data.id), eq(analyses.sessionId, sessionId)));
  res.status(204).end();
});

router.get("/analyses/:id", async (req, res): Promise<void> => {
  const params = GetAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const sessionId = getSessionId(req);
  const [row] = await db.select().from(analyses).where(and(eq(analyses.id, params.data.id), eq(analyses.sessionId, sessionId)));
  if (!row) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  res.json(parseRow(row));
});

router.post("/analyses/:id/chat", async (req, res): Promise<void> => {
  const params = GetAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessionId = getSessionId(req);
  const [row] = await db.select().from(analyses).where(and(eq(analyses.id, params.data.id), eq(analyses.sessionId, sessionId)));
  if (!row) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const { message, additionalContext } = req.body as { message: string; additionalContext?: string };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const existingResults = JSON.parse(row.results) as SearchTermResult[];

  // For large result sets, use rule-based approach: send a sample + ask for a rule
  const SAMPLE_SIZE = 50;
  const sample = existingResults.slice(0, SAMPLE_SIZE);
  const isLarge = existingResults.length > SAMPLE_SIZE;

  const rulePrompt = `You are a Google Ads search query analysis expert. Here is a sample of ${sample.length} search terms from an analysis of ${existingResults.length} total terms:

${JSON.stringify(sample, null, 2)}

The user wants to modify ALL ${existingResults.length} results with the following instruction:
"""${message}"""
${additionalContext ? `\nAdditional context: ${additionalContext}\n` : ""}

Please return a JSON object with two fields:
1. "explanation": A brief explanation of what changes will be made (1-2 sentences)
2. "rules": An array of rule objects. Each rule must have:
   - "field": Which field to modify ("relevance", "addLevel", "isCompetitor", "addAsKeyword")
   - "value": The new value to set
   - "match": One of:
     - { "type": "contains", "terms": ["word1", "word2"] } — applies to terms containing ANY of these words
     - { "type": "exact", "terms": ["exact term"] } — applies to exact matches
     - { "type": "all" } — applies to ALL terms

Example rules:
[
  {
    "field": "relevance",
    "value": "Irrelevant",
    "match": { "type": "contains", "terms": ["how to", "diy"] }
  },
  {
    "field": "isCompetitor",
    "value": true,
    "match": { "type": "contains", "terms": ["nike", "adidas"] }
  }
]

Return ONLY the JSON object, no markdown, no explanation outside the JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: rulePrompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  // Robust JSON extraction for the rule response
  let jsonText: string | null = null;
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = content.slice(firstBrace, lastBrace + 1);
  }
  if (!jsonText && content.trim().startsWith("{") && content.trim().endsWith("}")) {
    jsonText = content.trim();
  }
  if (!jsonText) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) jsonText = match[0];
  }
  if (!jsonText) {
    res.status(500).json({ error: "Could not parse AI response" });
    return;
  }

  let parsedResponse: {
    explanation?: string;
    rules?: Array<{
      field: string;
      value: string | boolean | number;
      match: { type: "contains" | "exact" | "all"; terms?: string[] };
    }>;
  };

  try {
    parsedResponse = JSON.parse(jsonText);
  } catch (err) {
    const cleaned = jsonText
      .replace(/,(\s*[\}\]])/g, "$1")
      .replace(/\n/g, " ")
      .replace(/\t/g, " ");
    try {
      parsedResponse = JSON.parse(cleaned);
    } catch {
      res.status(500).json({ error: "AI response is not valid JSON" });
      return;
    }
  }

  // Apply rules to ALL results
  const updatedResults = existingResults.map((r) => {
    const updated = { ...r };
    for (const rule of parsedResponse.rules ?? []) {
      const termLower = r.searchTerm.toLowerCase();
      let applies = false;
      if (rule.match.type === "all") {
        applies = true;
      } else if (rule.match.type === "contains") {
        applies = (rule.match.terms ?? []).some((t) => termLower.includes(t.toLowerCase()));
      } else if (rule.match.type === "exact") {
        applies = (rule.match.terms ?? []).some((t) => termLower === t.toLowerCase());
      }
      if (applies) {
        if (rule.field === "relevance" && (rule.value === "Relevant" || rule.value === "Irrelevant")) {
          updated.relevance = rule.value;
        } else if (rule.field === "addLevel" && (rule.value === "Campaign" || rule.value === "Ad Group" || rule.value === "None")) {
          updated.addLevel = rule.value;
        } else if (rule.field === "isCompetitor" && typeof rule.value === "boolean") {
          updated.isCompetitor = rule.value;
        } else if (rule.field === "addAsKeyword" && typeof rule.value === "boolean") {
          updated.addAsKeyword = rule.value;
        }
      }
    }
    return updated;
  });

  const relevantCount = updatedResults.filter((r) => r.relevance === "Relevant").length;
  const irrelevantCount = updatedResults.filter((r) => r.relevance === "Irrelevant").length;
  const newKeywordCount = updatedResults.filter((r) => r.addAsKeyword).length;
  const competitorCount = updatedResults.filter((r) => r.isCompetitor).length;

  await db
    .update(analyses)
    .set({
      results: JSON.stringify(updatedResults),
      relevantCount,
      irrelevantCount,
      newKeywordCount,
      competitorCount,
    })
    .where(eq(analyses.id, row.id));

  const [updatedRow] = await db.select().from(analyses).where(eq(analyses.id, row.id));
  res.json({ ...parseRow(updatedRow), explanation: parsedResponse.explanation });
});

export default router;
