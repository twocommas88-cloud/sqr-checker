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

router.get("/rules", async (req, res): Promise<void> => {
  const rows = await db.select().from(ruleSets).orderBy(ruleSets.createdAt);
  const result = rows.map((r) => ({
    ...r,
    competitorBrands: JSON.parse(r.competitorBrands) as string[],
    excludePatterns: JSON.parse(r.excludePatterns) as string[],
    customRules: JSON.parse(r.customRules) as string[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  res.json(result);
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
    })
    .returning();
  res.status(201).json({
    ...row,
    competitorBrands: JSON.parse(row.competitorBrands) as string[],
    excludePatterns: JSON.parse(row.excludePatterns) as string[],
    customRules: JSON.parse(row.customRules) as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
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
  res.json({
    ...row,
    competitorBrands: JSON.parse(row.competitorBrands) as string[],
    excludePatterns: JSON.parse(row.excludePatterns) as string[],
    customRules: JSON.parse(row.customRules) as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
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
      updatedAt: new Date(),
    })
    .where(eq(ruleSets.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Rule set not found" });
    return;
  }
  res.json({
    ...row,
    competitorBrands: JSON.parse(row.competitorBrands) as string[],
    excludePatterns: JSON.parse(row.excludePatterns) as string[],
    customRules: JSON.parse(row.customRules) as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
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
