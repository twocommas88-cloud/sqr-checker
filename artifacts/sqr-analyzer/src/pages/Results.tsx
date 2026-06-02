import { useState, useEffect, useMemo } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetAnalysis, getGetAnalysisQueryKey,
  useDeleteAnalysis, getListAnalysesQueryKey,
  useCreateRuleSet,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ArrowLeft, Loader2, AlertTriangle, Filter, X, Trash2, RefreshCw, Sheet, BookmarkPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Relevance = "Relevant" | "Irrelevant" | "";
type AddLevel = "Campaign" | "Ad Group" | "None" | "";

interface Filters {
  relevance: Relevance;
  addLevel: AddLevel;
  addAsKeyword: "" | "yes" | "no";
  isCompetitor: "" | "yes" | "no";
  search: string;
}

type AnalysisResult = {
  searchTerm: string;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  cost?: number | null;
  campaignName?: string | null;
  adGroupName?: string | null;
  relevance: string;
  reason: string;
  addLevel: string;
  addAsKeyword: boolean;
  suggestedAdGroup?: string | null;
  isCompetitor: boolean;
  matchedKeyword?: string | null;
  outOfAreaLocation?: string | null;
};

// ── N-gram extraction ────────────────────────────────────────────────────────

const STATUS_WORDS = new Set(["enabled", "paused", "removed", "keyword status"]);
const MATCH_TYPE_WORDS = new Set(["broad match", "phrase match", "exact match", "broad", "phrase", "exact"]);

function parseActiveKeywordPhrases(activeKeywords: string): Set<string> {
  const kwSet = new Set<string>();
  const lines = activeKeywords.split(/\r?\n/);

  let kwColIndex = 0;
  let hasTabFormat = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");

    if (parts.length >= 2) {
      hasTabFormat = true;
      const col0 = parts[0].trim().toLowerCase();

      if (col0 === "keyword status" || col0 === "status") {
        kwColIndex = parts.findIndex((p) => p.trim().toLowerCase() === "keyword");
        if (kwColIndex < 0) kwColIndex = 1;
        continue;
      }

      if (STATUS_WORDS.has(col0) || MATCH_TYPE_WORDS.has(col0)) {
        const rawKw = hasTabFormat && kwColIndex === 0 ? parts[1] : parts[kwColIndex];
        if (!rawKw) continue;
        let kw = rawKw.trim();
        kw = kw.replace(/^\[(.+)\]$/, "$1");
        kw = kw.replace(/^"(.+)"$/, "$1");
        kw = kw.replace(/\+/g, "").toLowerCase().trim();
        if (kw.length > 1) kwSet.add(kw);
        continue;
      }
    }

    if (!hasTabFormat || parts.length < 2) {
      const rawLines = trimmed.split(",");
      for (const raw of rawLines) {
        let kw = raw.trim();
        kw = kw.replace(/^\[(.+)\]$/, "$1");
        kw = kw.replace(/^"(.+)"$/, "$1");
        kw = kw.replace(/\+/g, "").toLowerCase().trim();
        if (kw.length > 1) kwSet.add(kw);
      }
    }
  }

  return kwSet;
}

function getActiveKeywordWords(activeKeywords: string): Set<string> {
  // Build a set of every individual word that appears in any active keyword
  const words = new Set<string>();
  for (const phrase of parseActiveKeywordPhrases(activeKeywords)) {
    for (const w of phrase.split(/\s+/)) {
      if (w.length > 2) words.add(w);
    }
  }
  return words;
}

function conflictsWithActiveKeywords(ngram: string, activeKwWords: Set<string>): boolean {
  // A 1-word negative "ngram" is a conflict if it is one of the individual words
  // that appears in any active keyword. E.g. if "junk" is a keyword word, don't
  // suggest "junk" as a negative term.
  return activeKwWords.has(ngram);
}

function extractNgrams(irrelevantTerms: string[], activeKeywords: string): string[] {
  const activeKwWords = getActiveKeywordWords(activeKeywords);
  const freq: Record<string, number> = {};

  for (const term of irrelevantTerms) {
    const words = term
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Unigrams only (1-word negative terms)
    for (const word of words) {
      freq[word] = (freq[word] ?? 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([ngram, count]) => {
      if (count < 3) return false; // must appear in 3+ irrelevant terms
      if (conflictsWithActiveKeywords(ngram, activeKwWords)) return false;
      return true;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ngram]) => ngram);
}

function findMatchingNgram(term: string, ngrams: string[]): string | null {
  const termLower = term.toLowerCase();
  for (const ng of ngrams) {
    if (termLower.includes(ng)) return ng;
  }
  return null;
}

// ── CSV download ─────────────────────────────────────────────────────────────

function downloadCSV(results: AnalysisResult[], name: string) {
  const headers = ["Search Term","Campaign Name","Ad Group Name","Impressions","Clicks","Conversions","Cost","Relevance","Reason","Add Level","Add as Keyword","Suggested Ad Group","Is Competitor","Matched Keyword","Out-of-Area Location"];
  const rows = results.map((r) => [
    `"${r.searchTerm.replace(/"/g, '""')}"`,
    r.campaignName ? `"${r.campaignName.replace(/"/g, '""')}"` : "",
    r.adGroupName ? `"${r.adGroupName.replace(/"/g, '""')}"` : "",
    r.impressions ?? "",
    r.clicks ?? "",
    r.conversions ?? "",
    r.cost ?? "",
    r.relevance,
    `"${r.reason.replace(/"/g, '""')}"`,
    r.addLevel,
    r.addAsKeyword ? "Yes" : "No",
    r.suggestedAdGroup ? `"${r.suggestedAdGroup.replace(/"/g, '""')}"` : "",
    r.isCompetitor ? "Yes" : "No",
    r.matchedKeyword ? `"${r.matchedKeyword.replace(/"/g, '""')}"` : "",
    r.outOfAreaLocation ? `"${r.outOfAreaLocation.replace(/"/g, '""')}"` : "",
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\s+/g, "_")}_sqr_analysis.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyForSheets(results: AnalysisResult[], name: string): Promise<void> {
  const headers = ["Search Term","Impressions","Clicks","Conversions","Cost","Relevance","Reason","Add Level","Add as Keyword","Suggested Ad Group","Is Competitor","Matched Keyword","Out-of-Area Location"];
  const rows = results.map((r) => [
    r.searchTerm,
    r.impressions ?? "",
    r.clicks ?? "",
    r.conversions ?? "",
    r.cost ?? "",
    r.relevance,
    r.reason,
    r.addLevel,
    r.addAsKeyword ? "Yes" : "No",
    r.suggestedAdGroup ?? "",
    r.isCompetitor ? "Yes" : "No",
    r.matchedKeyword ?? "",
    r.outOfAreaLocation ?? "",
  ].join("\t"));
  const tsv = [headers.join("\t"), ...rows].join("\n");
  await navigator.clipboard.writeText(tsv);
  void name;
}

// ── Save Profile Modal ────────────────────────────────────────────────────────

interface SaveProfileModalProps {
  defaultName: string;
  analysis: {
    activeKeywords: string;
    landingPageUrl?: string | null;
    targetLocations?: string | null;
    competitorBrands?: string[];
    excludePatterns?: string[];
    customRules?: string[];
    minConversionsForNewKeyword?: number;
  };
  onClose: () => void;
  onSave: (name: string) => void;
  isSaving: boolean;
}

function SaveProfileModal({ defaultName, onClose, onSave, isSaving }: SaveProfileModalProps) {
  const [name, setName] = useState(defaultName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-card-border rounded-xl shadow-xl p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground mb-1">Save as Account Profile</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Saves all settings from this analysis (keywords, locations, rules) as a reusable profile. Next time, just load the profile and paste new search terms.
        </p>
        <label className="text-sm font-medium text-foreground block mb-1.5">Profile Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Genie Junk Removal"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring mb-4"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(name.trim())}
            disabled={!name.trim() || isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Results() {
  const [, params] = useRoute("/results/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id ?? "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: analysis, isLoading } = useGetAnalysis(id, {
    query: { enabled: !!id, queryKey: getGetAnalysisQueryKey(id) }
  });

  const deleteAnalysis = useDeleteAnalysis();
  const createRuleSet = useCreateRuleSet();

  const [showSaveProfile, setShowSaveProfile] = useState(false);

  useEffect(() => {
    if (!analysis || analysis.status === "completed" || analysis.status === "failed") return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
    }, 2000);
    return () => clearInterval(interval);
  }, [analysis?.status, id, queryClient]);

  const [filters, setFilters] = useState<Filters>({
    relevance: "", addLevel: "", addAsKeyword: "", isCompetitor: "", search: "",
  });

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function clearFilters() {
    setFilters({ relevance: "", addLevel: "", addAsKeyword: "", isCompetitor: "", search: "" });
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
  }

  async function handleCopyForSheets() {
    if (!analysis) return;
    try {
      await copyForSheets(results, analysis.name);
      toast({ title: "Copied!", description: "Paste directly into Google Sheets (Ctrl+V / Cmd+V)" });
    } catch {
      toast({ title: "Copy failed", description: "Please try downloading the CSV instead", variant: "destructive" });
    }
  }

  function handleSaveProfile(name: string) {
    if (!analysis) return;
    createRuleSet.mutate({
      data: {
        name,
        activeKeywords: analysis.activeKeywords ?? undefined,
        landingPageUrl: analysis.landingPageUrl ?? undefined,
        targetLocations: analysis.targetLocations ?? undefined,
        competitorBrands: (analysis.competitorBrands as string[] | undefined) ?? [],
        excludePatterns: (analysis.excludePatterns as string[] | undefined) ?? [],
        customRules: (analysis.customRules as string[] | undefined) ?? [],
        minConversionsForNewKeyword: (analysis.minConversionsForNewKeyword as number | undefined) ?? 1,
      }
    }, {
      onSuccess: () => {
        setShowSaveProfile(false);
        toast({ title: "Profile saved!", description: `"${name}" is now available in the Account Profile dropdown.` });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Could not save profile", variant: "destructive" });
      }
    });
  }

  const hasFilters = Object.values(filters).some(Boolean);
  const results = (analysis?.results ?? []) as AnalysisResult[];

  const filtered = results.filter((r) => {
    if (filters.relevance && r.relevance !== filters.relevance) return false;
    if (filters.addLevel && r.addLevel !== filters.addLevel) return false;
    if (filters.addAsKeyword === "yes" && !r.addAsKeyword) return false;
    if (filters.addAsKeyword === "no" && r.addAsKeyword) return false;
    if (filters.isCompetitor === "yes" && !r.isCompetitor) return false;
    if (filters.isCompetitor === "no" && r.isCompetitor) return false;
    if (filters.search && !r.searchTerm.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });

  const competitors = results.filter((r) => r.isCompetitor);
  const irrelevantNonCompetitor = results.filter((r) => r.relevance === "Irrelevant" && !r.isCompetitor);

  const ngrams = useMemo(
    () => extractNgrams(
      irrelevantNonCompetitor.map((r) => r.searchTerm),
      analysis?.activeKeywords ?? ""
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [irrelevantNonCompetitor.length, analysis?.activeKeywords]
  );

  function handleDelete() {
    if (!confirm("Delete this analysis? This cannot be undone.")) return;
    deleteAnalysis.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey() });
        toast({ title: "Analysis deleted" });
        setLocation("/history");
      },
      onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
    });
  }

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (!analysis) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-muted-foreground">Analysis not found.</p></div>;
  }

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {showSaveProfile && (
        <SaveProfileModal
          defaultName={analysis.name}
          analysis={analysis as Parameters<typeof SaveProfileModal>[0]["analysis"]}
          onClose={() => setShowSaveProfile(false)}
          onSave={handleSaveProfile}
          isSaving={createRuleSet.isPending}
        />
      )}

      {/* Header */}
      <div className="px-8 py-5 border-b border-border bg-card/50 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/history" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{analysis.name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{new Date(analysis.createdAt).toLocaleString()}</p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            analysis.status === "completed" ? "bg-emerald-100 text-emerald-700" :
            analysis.status === "processing" ? "bg-amber-100 text-amber-700" :
            analysis.status === "failed" ? "bg-red-100 text-red-700" :
            "bg-muted text-muted-foreground"
          }`} data-testid="status-badge">
            {analysis.status === "processing" && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
            {analysis.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 border border-border text-muted-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/40 hover:text-foreground transition-colors"
            title="Refresh results"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSaveProfile(true)}
            disabled={analysis.status !== "completed"}
            className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Save as account profile"
            data-testid="button-save-profile"
          >
            <BookmarkPlus className="w-4 h-4" />
            Save as Profile
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteAnalysis.isPending}
            className="flex items-center gap-1.5 border border-destructive/40 text-destructive text-sm font-medium px-3 py-2 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-50"
            data-testid="button-delete"
          >
            {deleteAnalysis.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
          <button
            onClick={handleCopyForSheets}
            disabled={analysis.status !== "completed"}
            className="flex items-center gap-2 border border-emerald-500 text-emerald-700 bg-emerald-50 text-sm font-medium px-4 py-2 rounded-md hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-copy-sheets"
          >
            <Sheet className="w-4 h-4" />
            Copy for Sheets
          </button>
          <button
            onClick={() => downloadCSV(results, analysis.name)}
            disabled={analysis.status !== "completed"}
            className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-download-csv"
          >
            <Download className="w-4 h-4" />
            Download CSV
          </button>
        </div>
      </div>

      {analysis.status === "processing" || analysis.status === "pending" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <div className="text-center">
            <p className="font-medium text-foreground">Analyzing search terms...</p>
            <p className="text-sm text-muted-foreground mt-1">The AI is reviewing your terms. You can delete this if you want to cancel.</p>
          </div>
        </div>
      ) : analysis.status === "failed" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="font-medium text-foreground">Analysis failed</p>
          <p className="text-sm text-muted-foreground">{analysis.errorMessage ?? "Unknown error occurred"}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Stats bar */}
          <div className="px-8 py-3 border-b border-border bg-muted/30 flex items-center gap-6 text-sm flex-shrink-0">
            <span className="text-muted-foreground">{analysis.totalTerms} terms</span>
            <span className="text-emerald-600 font-medium">{analysis.relevantCount} relevant</span>
            <span className="text-red-500 font-medium">{analysis.irrelevantCount} irrelevant</span>
            <span className="text-primary font-medium">{analysis.newKeywordCount} new keywords</span>
            <span className="text-amber-600 font-medium">{analysis.competitorCount} competitors</span>
          </div>

          <div className="px-8 mt-4 space-y-3 flex-shrink-0">
            {/* Competitor negatives panel — Exact Match */}
            {competitors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Competitor Terms — Exact Match Negatives ({competitors.length})
                </p>
                <p className="text-xs text-red-600/70 mb-2">Add as negative exact match keywords to block competitor navigational searches.</p>
                <div className="flex flex-wrap gap-1.5">
                  {competitors.map((r, i) => (
                    <code key={i} className="text-xs bg-white border border-red-200 text-red-700 px-2 py-0.5 rounded font-mono" data-testid={`competitor-term-${i}`}>
                      [{r.searchTerm}]
                    </code>
                  ))}
                </div>
              </div>
            )}

            {/* 1-word N-gram negatives — Phrase + Exact */}
            {ngrams.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Suggested 1-Word Negative Terms ({ngrams.length})
                </p>
                <div>
                  <p className="text-xs font-medium text-amber-700 mb-1.5">Phrase Match — blocks queries <em>containing</em> this word</p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {ngrams.map((ng, i) => (
                      <code key={i} className="text-xs bg-white border border-amber-200 text-amber-800 px-2 py-0.5 rounded font-mono" data-testid={`ngram-phrase-${i}`}>
                        "{ng}"
                      </code>
                    ))}
                  </div>
                </div>
                <div className="border-t border-amber-200 pt-3">
                  <p className="text-xs font-medium text-amber-700 mb-1.5">Exact Match — blocks only this exact 1-word query</p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {ngrams.map((ng, i) => (
                      <code key={i} className="text-xs bg-white border border-amber-200 text-amber-800 px-2 py-0.5 rounded font-mono" data-testid={`ngram-exact-${i}`}>
                        [{ng}]
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* All irrelevant terms — Exact Match summary */}
            {irrelevantNonCompetitor.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-orange-800 mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Irrelevant Terms — Exact Match Negatives ({irrelevantNonCompetitor.length})
                </p>
                <p className="text-xs text-orange-700/70 mb-2">
                  Every search term flagged Irrelevant (excluding competitors). Add as exact match negatives to block each specific query.
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {irrelevantNonCompetitor.map((r, i) => (
                    <code key={i} className="text-xs bg-white border border-orange-200 text-orange-800 px-2 py-0.5 rounded font-mono" data-testid={`irrelevant-exact-${i}`}>
                      [{r.searchTerm}]
                    </code>
                  ))}
                </div>
              </div>
            )}

            {/* Out-of-area locations — list unique area names */}
            {(() => {
              const ooa = results.filter((r) => r.outOfAreaLocation || (r.relevance === "Irrelevant" && r.reason?.toLowerCase().includes("outside target service area")));
              const uniqueLocations = Array.from(new Set(ooa.map((r) => r.outOfAreaLocation ?? "").filter(Boolean)));
              return ooa.length > 0 ? (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-purple-800 mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Out-of-Area Locations ({uniqueLocations.length})
                  </p>
                  <p className="text-xs text-purple-700/70 mb-2">
                    Location names found in search terms that are outside your target service area. Add as phrase match negatives to stop paying for out-of-area clicks.
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {uniqueLocations.map((loc, i) => (
                      <code key={i} className="text-xs bg-white border border-purple-200 text-purple-800 px-2 py-0.5 rounded font-mono" data-testid={`ooa-loc-${i}`}>
                        "{loc}"
                      </code>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {/* Filters */}
          <div className="px-8 py-3 flex items-center gap-3 flex-wrap flex-shrink-0 mt-3">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              type="search"
              placeholder="Search terms..."
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-card outline-none focus:ring-2 focus:ring-ring w-48"
              data-testid="input-filter-search"
            />
            <select value={filters.relevance} onChange={(e) => setFilter("relevance", e.target.value as Relevance)} className="border border-input rounded-md px-3 py-1.5 text-sm bg-card outline-none" data-testid="select-filter-relevance">
              <option value="">All relevance</option>
              <option value="Relevant">Relevant</option>
              <option value="Irrelevant">Irrelevant</option>
            </select>
            <select value={filters.addLevel} onChange={(e) => setFilter("addLevel", e.target.value as AddLevel)} className="border border-input rounded-md px-3 py-1.5 text-sm bg-card outline-none" data-testid="select-filter-add-level">
              <option value="">All levels</option>
              <option value="Campaign">Campaign</option>
              <option value="Ad Group">Ad Group</option>
              <option value="None">None</option>
            </select>
            <select value={filters.addAsKeyword} onChange={(e) => setFilter("addAsKeyword", e.target.value as "" | "yes" | "no")} className="border border-input rounded-md px-3 py-1.5 text-sm bg-card outline-none" data-testid="select-filter-keyword">
              <option value="">Add as keyword?</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <select value={filters.isCompetitor} onChange={(e) => setFilter("isCompetitor", e.target.value as "" | "yes" | "no")} className="border border-input rounded-md px-3 py-1.5 text-sm bg-card outline-none" data-testid="select-filter-competitor">
              <option value="">Competitors?</option>
              <option value="yes">Competitors only</option>
              <option value="no">Non-competitors</option>
            </select>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-clear-filters">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {results.length}</span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto px-8 pb-8">
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm min-w-[1300px]">
                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 w-[300px] min-w-[260px]">Search Term</th>
                    <th className="text-right px-3 py-3 w-[80px]">Impr.</th>
                    <th className="text-right px-3 py-3 w-[65px]">Clicks</th>
                    <th className="text-right px-3 py-3 w-[70px]">Conv.</th>
                    <th className="text-right px-3 py-3 w-[70px]">Cost</th>
                    <th className="text-left px-3 py-3 w-[100px]">Relevance</th>
                    <th className="text-left px-3 py-3">Reason</th>
                    <th className="text-left px-3 py-3 w-[100px]">Add Level</th>
                    <th className="text-left px-3 py-3 w-[75px]">New KW?</th>
                    <th className="text-left px-3 py-3 w-[120px]">Ad Group</th>
                    <th className="text-left px-3 py-3 w-[75px]">Comp.</th>
                    <th className="text-left px-3 py-3 w-[110px]">Neg. N-gram</th>
                    <th className="text-left px-3 py-3 w-[110px]">Out-of-Area</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={13} className="px-4 py-10 text-center text-muted-foreground text-sm">No results match your filters</td></tr>
                  ) : filtered.map((r, i) => {
                    const matchedNgram = r.relevance === "Irrelevant" ? findMatchingNgram(r.searchTerm, ngrams) : null;
                    return (
                      <tr key={i} className="hover:bg-muted/20 transition-colors" data-testid={`row-result-${i}`}>
                        <td className="px-4 py-2.5 font-medium text-foreground w-[300px] min-w-[260px]">
                          <span className="break-words block" title={r.searchTerm}>{r.searchTerm}</span>
                          {r.matchedKeyword && (
                            <span className="text-xs text-muted-foreground truncate block" title={r.matchedKeyword}>→ {r.matchedKeyword}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.impressions?.toLocaleString() ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.clicks?.toLocaleString() ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.conversions ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.cost != null ? `$${r.cost.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.relevance === "Relevant" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          }`} data-testid={`relevance-${i}`}>
                            {r.relevance}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[200px]">
                          <span title={r.reason}>{r.reason}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.addLevel !== "None" ? (
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              r.addLevel === "Campaign" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"
                            }`} data-testid={`add-level-${i}`}>
                              {r.addLevel}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-medium ${r.addAsKeyword ? "text-primary" : "text-muted-foreground"}`} data-testid={`add-keyword-${i}`}>
                            {r.addAsKeyword ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground" data-testid={`ad-group-${i}`}>
                          {r.suggestedAdGroup ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.isCompetitor ? (
                            <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded" data-testid={`is-competitor-${i}`}>Yes</span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {matchedNgram ? (
                            <code className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-mono" title={`Neg. n-gram: "${matchedNgram}"`}>
                              "{matchedNgram}"
                            </code>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.outOfAreaLocation ? (
                            <span className="text-xs bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded font-medium" title={`Out of area: ${r.outOfAreaLocation}`}>
                              {r.outOfAreaLocation}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
