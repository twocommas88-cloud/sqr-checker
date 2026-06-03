import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ruleSets = pgTable("rule_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  accountName: text("account_name"),
  competitorBrands: text("competitor_brands").notNull().default("[]"),
  excludePatterns: text("exclude_patterns").notNull().default("[]"),
  customRules: text("custom_rules").notNull().default("[]"),
  minConversionsForNewKeyword: integer("min_conversions_for_new_keyword").notNull().default(1),
  activeKeywords: text("active_keywords"),
  landingPageUrl: text("landing_page_url"),
  targetLocations: text("target_locations"),
  relevantBrandTerms: text("relevant_brand_terms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRuleSetSchema = createInsertSchema(ruleSets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRuleSet = z.infer<typeof insertRuleSetSchema>;
export type RuleSet = typeof ruleSets.$inferSelect;
