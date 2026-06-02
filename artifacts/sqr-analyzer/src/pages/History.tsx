import { Link } from "wouter";
import { useListAnalyses } from "@workspace/api-client-react";
import { ArrowRight, Clock, Search, Loader2 } from "lucide-react";

export default function History() {
  const { data: analyses, isLoading } = useListAnalyses();

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-7 border-b border-border bg-card/50 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analysis History</h1>
          <p className="text-muted-foreground text-sm mt-1">{analyses?.length ?? 0} analyses run</p>
        </div>
        <Link
          href="/analyze"
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
          data-testid="button-new-analysis"
        >
          New Analysis
        </Link>
      </div>

      <div className="px-8 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !analyses || analyses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="w-10 h-10 text-muted-foreground/30 mb-4" />
            <p className="font-medium text-foreground">No analyses yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Run your first analysis to see it here</p>
            <Link
              href="/analyze"
              className="bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 rounded-md hover:opacity-90 transition-opacity"
              data-testid="button-start-first"
            >
              Start Analysis
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Terms</th>
                  <th className="text-right px-4 py-3">Relevant</th>
                  <th className="text-right px-4 py-3">Irrelevant</th>
                  <th className="text-right px-4 py-3">New KWs</th>
                  <th className="text-right px-4 py-3">Competitors</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analyses.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-history-${a.id}`}>
                    <td className="px-5 py-3 font-medium text-foreground">{a.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{a.totalTerms}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 font-medium">{a.relevantCount}</td>
                    <td className="px-4 py-3 text-right text-red-500 font-medium">{a.irrelevantCount}</td>
                    <td className="px-4 py-3 text-right text-primary font-medium">{a.newKeywordCount ?? 0}</td>
                    <td className="px-4 py-3 text-right text-amber-600 font-medium">{a.competitorCount ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        a.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        a.status === "processing" ? "bg-amber-100 text-amber-700" :
                        a.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/results/${a.id}`}
                        className="text-primary hover:underline flex items-center gap-1 text-xs font-medium"
                        data-testid={`link-results-${a.id}`}
                      >
                        View <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
