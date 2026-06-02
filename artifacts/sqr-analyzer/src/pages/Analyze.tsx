import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useCreateAnalysis, useListRules } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import TagInput from "@/components/TagInput";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface FormData {
  name: string;
  activeKeywords: string;
  searchTerms: string;
  ruleSetId: string;
  minConversionsForNewKeyword: number;
  customRules: string;
}

export default function Analyze() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: ruleSets } = useListRules();
  const createAnalysis = useCreateAnalysis();

  const [competitorBrands, setCompetitorBrands] = useState<string[]>([]);
  const [excludePatterns, setExcludePatterns] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      name: "",
      activeKeywords: "",
      searchTerms: "",
      ruleSetId: "",
      minConversionsForNewKeyword: 1,
      customRules: "",
    }
  });

  const selectedRuleSetId = watch("ruleSetId");

  function handleRuleSetChange(id: string) {
    setValue("ruleSetId", id);
    if (id) {
      const rs = ruleSets?.find((r) => String(r.id) === id);
      if (rs) {
        setCompetitorBrands(rs.competitorBrands ?? []);
        setExcludePatterns(rs.excludePatterns ?? []);
        setValue("minConversionsForNewKeyword", rs.minConversionsForNewKeyword ?? 1);
        setValue("customRules", (rs.customRules ?? []).join("\n"));
      }
    }
  }

  function onSubmit(data: FormData) {
    const customRulesArr = data.customRules
      ? data.customRules.split("\n").map((l) => l.trim()).filter(Boolean)
      : [];

    createAnalysis.mutate({
      data: {
        name: data.name || `Analysis ${new Date().toLocaleDateString()}`,
        activeKeywords: data.activeKeywords,
        searchTerms: data.searchTerms,
        ruleSetId: data.ruleSetId ? parseInt(data.ruleSetId) : null,
        competitorBrands,
        excludePatterns,
        customRules: customRulesArr,
        minConversionsForNewKeyword: Number(data.minConversionsForNewKeyword) || 1,
      }
    }, {
      onSuccess: (analysis) => {
        toast({ title: "Analysis started", description: "Processing your search terms..." });
        setLocation(`/results/${analysis.id}`);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to start analysis", variant: "destructive" });
      }
    });
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-7 border-b border-border bg-card/50">
        <h1 className="text-2xl font-bold text-foreground">New Analysis</h1>
        <p className="text-muted-foreground text-sm mt-1">Paste your active keywords and search terms to analyze</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="px-8 py-6 max-w-5xl space-y-6">
        {/* Name + Rule Set row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Analysis Name</label>
            <input
              {...register("name")}
              placeholder="e.g. Brand Campaign Q2 2025"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-analysis-name"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Load Rule Set (optional)</label>
            <select
              value={selectedRuleSetId}
              onChange={(e) => handleRuleSetChange(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="select-rule-set"
            >
              <option value="">Custom / Ad-hoc rules</option>
              {ruleSets?.map((rs) => (
                <option key={rs.id} value={String(rs.id)}>{rs.name}{rs.accountName ? ` — ${rs.accountName}` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Keywords and Terms */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Active Keywords</label>
            <p className="text-xs text-muted-foreground mb-2">
              One keyword per line. Format: <code className="bg-muted px-1 rounded text-xs">keyword | match type | Ad Group Name</code>
            </p>
            <textarea
              {...register("activeKeywords", { required: true })}
              rows={10}
              placeholder={"running shoes | exact | Running Shoes\nbuy sneakers online | phrase | General\nsport footwear | broad | General"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y"
              data-testid="textarea-active-keywords"
            />
            {errors.activeKeywords && <p className="text-xs text-destructive mt-1">Active keywords are required</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Search Terms to Analyze</label>
            <p className="text-xs text-muted-foreground mb-2">
              Paste from Google Ads report. Columns: <code className="bg-muted px-1 rounded text-xs">term, impressions, clicks, conversions, cost</code>
            </p>
            <textarea
              {...register("searchTerms", { required: true })}
              rows={10}
              placeholder={"running shoes for men\t1200\t84\t5\t42.50\nbuy nike shoes online\t340\t21\t0\t8.20\nbest running shoe brand\t220\t15\t2\t12.00"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y"
              data-testid="textarea-search-terms"
            />
            {errors.searchTerms && <p className="text-xs text-destructive mt-1">Search terms are required</p>}
          </div>
        </div>

        {/* Rules section */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
            data-testid="button-toggle-rules"
          >
            <span>Analysis Rules</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          {showAdvanced && (
            <div className="px-5 pb-5 border-t border-border space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Competitor Brands</label>
                  <p className="text-xs text-muted-foreground mb-2">Press Enter or comma to add. These terms will be flagged as negatives.</p>
                  <TagInput
                    value={competitorBrands}
                    onChange={setCompetitorBrands}
                    placeholder="nike, adidas, puma..."
                    data-testid="tag-input-competitors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Exclude Patterns</label>
                  <p className="text-xs text-muted-foreground mb-2">Terms containing these patterns will be marked irrelevant.</p>
                  <TagInput
                    value={excludePatterns}
                    onChange={setExcludePatterns}
                    placeholder="free, cheap, DIY..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Min Conversions for New Keyword</label>
                  <p className="text-xs text-muted-foreground mb-2">Terms need at least this many conversions to be suggested as new keywords.</p>
                  <input
                    type="number"
                    min={0}
                    {...register("minConversionsForNewKeyword")}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    data-testid="input-min-conversions"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Custom Rules</label>
                  <p className="text-xs text-muted-foreground mb-2">One rule per line. E.g. "Exclude informational queries without purchase intent"</p>
                  <textarea
                    {...register("customRules")}
                    rows={4}
                    placeholder={"Exclude terms with 'how to'\nFlag 'review' terms as irrelevant"}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
                    data-testid="textarea-custom-rules"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={createAnalysis.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground font-medium text-sm px-6 py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          data-testid="button-run-analysis"
        >
          {createAnalysis.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {createAnalysis.isPending ? "Submitting..." : "Run Analysis"}
        </button>
      </form>
    </div>
  );
}
