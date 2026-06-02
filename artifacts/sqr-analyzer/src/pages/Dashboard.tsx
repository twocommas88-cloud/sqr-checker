import { useGetAnalysisStats } from "@workspace/api-client-react";
import { BarChart3, Search, TrendingUp, AlertTriangle } from "lucide-react";

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

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-7 border-b border-border bg-card/50">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Search query analysis overview</p>
      </div>

      <div className="px-8 py-6">
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
      </div>
    </div>
  );
}
