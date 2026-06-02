import { useState, useEffect, useMemo } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetAnalysis, getGetAnalysisQueryKey,
  useDeleteAnalysis, getListAnalysesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ArrowLeft, Loader2, AlertTriangle, Filter, X, Trash2 } from "lucide-react";
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
  relevance: string;
  reason: string;
  addLevel: string;
  addAsKeyword: boolean;
  suggestedAdGroup?: string | null;
  isCompetitor: boolean;
  matchedKeyword?: string | null;
};

// ── N-gram extraction ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","as",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","can","not","no","nor","so","yet",
  "if","when","where","how","what","who","which","that","this","these","those",
  "it","its","i","me","my","we","our","you","your","he","she","they","their",
  "from","about","into","through","after","before","up","down","out","off","over",
  "under","get","got","go","gone","come","came","make","made","take","took",
  "near","me","my","&","vs","vs.","vs","–","—",
]);

function extractNgrams(irrelevantTerms: string[]): string[] {
  const freq: Record<string, number> = {};

  for (const term of irrelevantTerms) {
    const words = term
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    // 1-grams, 2-grams, 3-grams
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(" ");
        if (ngram.trim()) {
          freq[ngram] = (freq[ngram] ?? 0) + 1;
        }
      }
    }
  }

  // Sort by frequency desc, then alphabetically; return phrases with freq >= 1
  return Object.entries(freq)
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ngram]) => ngram);
}

// ── CSV download ─────────────────────────────────────────────────────────────

function downloadCSV(results: AnalysisResult[], name: string) {
  const headers = ["Search Term","Impressions","Clicks","Conversions","Cost","Relevance","Reason","Add Level","Add as Keyword","Suggested Ad Group","Is Competitor","Matched Keyword"];
  const rows = results.map((r) => [
    `"${r.searchTerm.replace(/"/g, '""')}"`,
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

  // Poll while processing
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
    () => extractNgrams(irrelevantNonCompetitor.map((r) => r.searchTerm)),
    [irrelevantNonCompetitor.length]
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
            onClick={handleDelete}
            disabled={deleteAnalysis.isPending}
            className="flex items-center gap-1.5 border border-destructive/40 text-destructive text-sm font-medium px-3 py-2 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-50"
            data-testid="button-delete"
          >
            {deleteAnalysis.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
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
            {/* Competitor negatives panel — Exact match format [term] */}
            {competitors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Competitor Terms — Add as Exact Match Negatives ({competitors.length})
                </p>
                <p className="text-xs text-red-600/70 mb-2">Exact match format: add these as negative exact match keywords</p>
                <div className="flex flex-wrap gap-1.5">
                  {competitors.map((r, i) => (
                    <code key={i} className="text-xs bg-white border border-red-200 text-red-700 px-2 py-0.5 rounded font-mono" data-testid={`competitor-term-${i}`}>
                      [{r.searchTerm}]
                    </code>
                  ))}
                </div>
              </div>
            )}

            {/* N-gram negative suggestions — Phrase match format "term" */}
            {ngrams.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Suggested Negative N-Grams — Add as Phrase Match ({ngrams.length})
                </p>
                <p className="text-xs text-amber-700/70 mb-2">
                  Phrase match format: extracted from irrelevant search terms. Review and add the ones that make sense for your campaigns.
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {ngrams.map((ng, i) => (
                    <code key={i} className="text-xs bg-white border border-amber-200 text-amber-800 px-2 py-0.5 rounded font-mono" data-testid={`ngram-${i}`}>
                      "{ng}"
                    </code>
                  ))}
                </div>
              </div>
            )}
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
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 w-[200px]">Search Term</th>
                    <th className="text-right px-3 py-3 w-[80px]">Impr.</th>
                    <th className="text-right px-3 py-3 w-[65px]">Clicks</th>
                    <th className="text-right px-3 py-3 w-[70px]">Conv.</th>
                    <th className="text-right px-3 py-3 w-[70px]">Cost</th>
                    <th className="text-left px-3 py-3 w-[100px]">Relevance</th>
                    <th className="text-left px-3 py-3">Reason</th>
                    <th className="text-left px-3 py-3 w-[100px]">Add Level</th>
                    <th className="text-left px-3 py-3 w-[75px]">New KW?</th>
                    <th className="text-left px-3 py-3 w-[130px]">Ad Group</th>
                    <th className="text-left px-3 py-3 w-[85px]">Competitor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground text-sm">No results match your filters</td></tr>
                  ) : filtered.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors" data-testid={`row-result-${i}`}>
                      <td className="px-4 py-2.5 font-medium text-foreground max-w-[200px]">
                        <span className="truncate block" title={r.searchTerm}>{r.searchTerm}</span>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
