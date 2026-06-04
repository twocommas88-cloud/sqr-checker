# SQR Analyzer

AI-powered Google Ads Search Query Analysis tool that analyzes search terms, flags irrelevant queries, detects competitors, and suggests new keywords.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` -- run the API server
- `pnpm run typecheck` -- full typecheck across all packages
- `pnpm run build` -- typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` -- regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` -- push DB schema changes (dev only)
- Required env: `DATABASE_URL` -- Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS + shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- AI: OpenAI GPT-4.1-mini via Replit integration
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sqr-analyzer/` -- Frontend web app
- `artifacts/api-server/` -- Express API server
- `lib/db/` -- Drizzle schema & migrations
- `lib/api-spec/` -- OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/` -- Generated React Query hooks
- `lib/api-zod/` -- Generated Zod schemas

## Architecture decisions

- **Session-based data isolation**: Each browser gets a unique `sessionId` stored in localStorage. All DB queries filter by session ID, so multiple users share the same app without seeing each other's data.
- **Analysis queue**: Max 3 concurrent AI analyses at once. Additional analyses are queued with status "queued" and processed FIFO.
- **Rule-based chat for large datasets**: The chat sends a 50-term sample to the AI and asks for "rules" (patterns), then applies those rules client-side to all results. This scales to thousands of terms.
- **Batch AI processing**: Search terms are split into 50-term batches, with up to 8 batches running in parallel.
- **Contract-first API**: OpenAPI spec generates both backend Zod schemas and frontend React Query hooks.

## Product

- Upload/paste Google Ads search terms and active keywords
- AI analyzes each term for relevance, competitor flags, and out-of-area detection
- View results with sortable/filterable table, color-coded relevance scores
- Chat with AI to modify results using natural language rules
- Save reusable "Rule Sets" (account profiles) for quick analysis setup
- Download results as CSV or copy-paste for Google Sheets

## User preferences

- Password: `SQR2026`

## Gotchas

- `pnpm --filter @workspace/db run push` must be run after any schema change
- Frontend workflow must be restarted after deleting components (Vite HMR cache issue)
- AI chat rule-based approach works best for bulk modifications (e.g., "flag all terms with 'how to' as irrelevant")
- Analysis queue status "queued" means the analysis is waiting for a processing slot

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
