import { Link } from "wouter";
import { useGetAnalysisStats, useListAnalyses } from "@workspace/api-client-react";
import { BarChart3, Search, TrendingUp, AlertTriangle, Clock, ArrowRight } from "lucide-react";

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex items-start gap-4" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetAnalysisStats();
  const { data: analyses, isLoading: listLoading } = useListAnalyses();

  const recent = analyses?.slice(0, 5) ?? [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-7 border-b border-border bg-card/50">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Search query analysis overview</p>
      </div>

      <div className="px-8 py-6 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Analyses"
            value={statsLoading ? "—" : (stats?.totalAnalyses ?? 0)}
            icon={BarChart3}
            color="bg-primary/10 text-primary"
          />
          <StatCard
            label="Terms Analyzed"
            value={statsLoading ? "—" : (stats?.totalTermsAnalyzed ?? 0).toLocaleString()}
            icon={Search}
            color="bg-emerald-100 text-emerald-600"
          />
          <StatCard
            label="Avg Relevance Rate"
            value={statsLoading ? "—" : `${Math.round((stats?.avgRelevanceRate ?? 0) * 100)}%`}
            icon={TrendingUp}
            color="bg-amber-100 text-amber-600"
          />
          <StatCard
            label="Competitor Brands"
            value={statsLoading ? "—" : (stats?.topCompetitors?.length ?? 0)}
            icon={AlertTriangle}
            color="bg-red-100 text-red-600"
          />
        </div>

        {/* Top competitors */}
        {!statsLoading && stats?.topCompetitors && stats.topCompetitors.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Top Competitor Terms Found</h2>
            <div className="flex flex-wrap gap-2">
              {stats.topCompetitors.map((term) => (
                <span key={term} className="inline-flex items-center px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-medium" data-testid={`competitor-${term}`}>
                  {term}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recent analyses */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Analyses</h2>
            <Link
              href="/history"
              className="text-xs text-primary hover:underline flex items-center gap-1"
              data-testid="link-view-all"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {listLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : recent.length === 0 ? (
            <div className="p-10 text-center">
              <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground font-medium">No analyses yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1 mb-4">Run your first search query analysis to get started</p>
              <Link
                href="/analyze"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
                data-testid="button-start-analysis"
              >
                Start Analysis
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((a) => (
                <Link
                  key={a.id}
                  href={`/results/${a.id}`}
                  className="flex items-center px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                  data-testid={`row-analysis-${a.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(a.createdAt).toLocaleDateString()}
                      <span className="mx-1">·</span>
                      {a.totalTerms} terms
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                    <span className="text-xs text-emerald-600 font-medium">{a.relevantCount} relevant</span>
                    <span className="text-xs text-red-500 font-medium">{a.irrelevantCount} irrelevant</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        a.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        a.status === "processing" ? "bg-amber-100 text-amber-700" :
                        a.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-muted text-muted-foreground"
                      }`}
                      data-testid={`status-${a.id}`}
                    >
                      {a.status}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
