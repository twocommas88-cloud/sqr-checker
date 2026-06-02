import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, analyses } from "@workspace/db";
import {
  CreateAnalysisBody,
  GetAnalysisParams,
} from "@workspace/api-zod";
import { analyzeSearchQueries } from "../lib/sqrAnalyzer";
import { logger } from "../lib/logger";

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

export default router;
