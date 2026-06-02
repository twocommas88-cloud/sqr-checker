import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  ruleSetId: integer("rule_set_id"),
  activeKeywords: text("active_keywords").notNull(),
  searchTerms: text("search_terms").notNull(),
  competitorBrands: text("competitor_brands").notNull().default("[]"),
  excludePatterns: text("exclude_patterns").notNull().default("[]"),
  customRules: text("custom_rules").notNull().default("[]"),
  landingPageUrl: text("landing_page_url"),
  targetLocations: text("target_locations"),
  minConversionsForNewKeyword: integer("min_conversions_for_new_keyword").notNull().default(1),
  totalTerms: integer("total_terms").notNull().default(0),
  relevantCount: integer("relevant_count").notNull().default(0),
  irrelevantCount: integer("irrelevant_count").notNull().default(0),
  newKeywordCount: integer("new_keyword_count").notNull().default(0),
  competitorCount: integer("competitor_count").notNull().default(0),
  results: text("results").notNull().default("[]"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({ id: true, createdAt: true });
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;
