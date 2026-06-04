import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ruleSets } from "@workspace/db";
import {
  CreateRuleSetBody,
  UpdateRuleSetBody,
  UpdateRuleSetParams,
  GetRuleSetParams,
  DeleteRuleSetParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeRuleSet(r: typeof ruleSets.$inferSelect) {
  return {
    ...r,
    competitorBrands: JSON.parse(r.competitorBrands) as string[],
    excludePatterns: JSON.parse(r.excludePatterns) as string[],
    customRules: JSON.parse(r.customRules) as string[],
    activeKeywords: r.activeKeywords ?? null,
    landingPageUrl: r.landingPageUrl ?? null,
    targetLocations: r.targetLocations ?? null,
    relevantBrandTerms: r.relevantBrandTerms ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/rules", async (req, res): Promise<void> => {
  const rows = await db.select().from(ruleSets).orderBy(ruleSets.createdAt);
  res.json(rows.map(serializeRuleSet));
});

router.post("/rules", async (req, res): Promise<void> => {
  const parsed = CreateRuleSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { competitorBrands, excludePatterns, customRules, ...rest } = parsed.data;
  const [row] = await db
    .insert(ruleSets)
    .values({
      ...rest,
      competitorBrands: JSON.stringify(competitorBrands ?? []),
      excludePatterns: JSON.stringify(excludePatterns ?? []),
      customRules: JSON.stringify(customRules ?? []),
      minConversionsForNewKeyword: rest.minConversionsForNewKeyword ?? 1,
      activeKeywords: rest.activeKeywords ?? null,
      landingPageUrl: rest.landingPageUrl ?? null,
      targetLocations: rest.targetLocations ?? null,
      relevantBrandTerms: rest.relevantBrandTerms ?? null,
    })
    .returning();
  res.status(201).json(serializeRuleSet(row));
});

router.get("/rules/:id", async (req, res): Promise<void> => {
  const params = GetRuleSetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(ruleSets).where(eq(ruleSets.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Rule set not found" });
    return;
  }
  res.json(serializeRuleSet(row));
});

router.put("/rules/:id", async (req, res): Promise<void> => {
  const params = UpdateRuleSetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRuleSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { competitorBrands, excludePatterns, customRules, ...rest } = parsed.data;
  const [row] = await db
    .update(ruleSets)
    .set({
      ...rest,
      ...(competitorBrands !== undefined && { competitorBrands: JSON.stringify(competitorBrands) }),
      ...(excludePatterns !== undefined && { excludePatterns: JSON.stringify(excludePatterns) }),
      ...(customRules !== undefined && { customRules: JSON.stringify(customRules) }),
      ...(rest.landingPageUrl !== undefined && { landingPageUrl: rest.landingPageUrl }),
      ...(rest.targetLocations !== undefined && { targetLocations: rest.targetLocations }),
      ...(rest.relevantBrandTerms !== undefined && { relevantBrandTerms: rest.relevantBrandTerms }),
      ...(rest.activeKeywords !== undefined && { activeKeywords: rest.activeKeywords }),
      updatedAt: new Date(),
    })
    .where(eq(ruleSets.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Rule set not found" });
    return;
  }
  res.json(serializeRuleSet(row));
});

router.delete("/rules/:id", async (req, res): Promise<void> => {
  const params = DeleteRuleSetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(ruleSets).where(eq(ruleSets.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Rule set not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
