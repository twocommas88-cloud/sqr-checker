import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, analyses } from "@workspace/db";
import {
  CreateAnalysisBody,
  GetAnalysisParams,
} from "@workspace/api-zod";
import { analyzeSearchQueries, type SearchTermResult } from "../lib/sqrAnalyzer";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

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
  const rows = await db.select().from(analyses).where(eq(analyses.status, "completed"));
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
  const rows = await db.select().from(analyses).orderBy(desc(analyses.createdAt));
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

  const [row] = await db
    .insert(analyses)
    .values({
      name,
      status: "processing",
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

  (async () => {
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
  })();
});

router.delete("/analyses/:id", async (req, res): Promise<void> => {
  const parsed = GetAnalysisParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(analyses).where(eq(analyses.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  await db.delete(analyses).where(eq(analyses.id, parsed.data.id));
  res.status(204).end();
});

router.get("/analyses/:id", async (req, res): Promise<void> => {
  const params = GetAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(analyses).where(eq(analyses.id, params.data.id));
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

  const [row] = await db.select().from(analyses).where(eq(analyses.id, params.data.id));
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

  const prompt = `You are a Google Ads search query analysis expert. Here are the current analysis results:

${JSON.stringify(existingResults.slice(0, 50), null, 2)}

The user wants to modify these results with the following instruction:
"""${message}"""
${additionalContext ? `\nAdditional context: ${additionalContext}\n` : ""}

Please return the COMPLETE updated results array (all terms, not just the changed ones) as a valid JSON array in the same format. Only modify the fields that the user's request affects. Keep all other fields unchanged.

Rules:
- relevance must be exactly "Relevant" or "Irrelevant"
- addLevel must be "Campaign", "Ad Group", or "None"
- addAsKeyword must be true only when the term has conversions > 0
- isCompetitor must be true only for competitor brand terms
- Keep all campaignName, adGroupName, impressions, clicks, conversions, cost, searchTerm unchanged unless the user specifically asks to modify them.

Return ONLY the JSON array, no markdown, no explanation.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "[]";
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) {
    res.status(500).json({ error: "Could not parse AI response" });
    return;
  }

  const parsed = JSON.parse(match[0]) as SearchTermResult[];

  const relevantCount = parsed.filter((r) => r.relevance === "Relevant").length;
  const irrelevantCount = parsed.filter((r) => r.relevance === "Irrelevant").length;
  const newKeywordCount = parsed.filter((r) => r.addAsKeyword).length;
  const competitorCount = parsed.filter((r) => r.isCompetitor).length;

  await db
    .update(analyses)
    .set({
      results: JSON.stringify(parsed),
      relevantCount,
      irrelevantCount,
      newKeywordCount,
      competitorCount,
    })
    .where(eq(analyses.id, row.id));

  const [updatedRow] = await db.select().from(analyses).where(eq(analyses.id, row.id));
  res.json(parseRow(updatedRow));
});

export default router;
