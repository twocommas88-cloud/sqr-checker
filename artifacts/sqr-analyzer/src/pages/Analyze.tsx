import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useCreateAnalysis, useListRules } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import TagInput from "@/components/TagInput";
import { Loader2, ChevronDown, ChevronUp, Upload } from "lucide-react";
import * as XLSX from "xlsx";

interface FormData {
  name: string;
  landingPageUrl: string;
  targetLocations: string;
  relevantBrandTerms: string;
  activeKeywords: string;
  searchTerms: string;
  ruleSetId: string;
  minConversionsForNewKeyword: number;
  customRules: string;
}

export default function Analyze() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: ruleSets } = useListRules();
  const createAnalysis = useCreateAnalysis();

  const [competitorBrands, setCompetitorBrands] = useState<string[]>([]);
  const [excludePatterns, setExcludePatterns] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [relevantBrandTerms, setRelevantBrandTerms] = useState<string[]>([]);

  const activeKeywordsFileRef = useRef<HTMLInputElement>(null);
  const searchTermsFileRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      name: "",
      landingPageUrl: "",
      targetLocations: "",
      relevantBrandTerms: "",
      activeKeywords: "",
      searchTerms: "",
      ruleSetId: "",
      minConversionsForNewKeyword: 1,
      customRules: "",
    }
  });

  const selectedRuleSetId = watch("ruleSetId");

  // Read URL query params on mount (for Redo button)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("name")) setValue("name", query.get("name") ?? "");
    if (query.get("landingPageUrl")) setValue("landingPageUrl", query.get("landingPageUrl") ?? "");
    if (query.get("targetLocations")) setValue("targetLocations", query.get("targetLocations") ?? "");
    if (query.get("relevantBrandTerms")) {
      const raw = query.get("relevantBrandTerms") ?? "";
      const terms = raw.split(",").map((s) => s.trim()).filter(Boolean);
      setRelevantBrandTerms(terms);
      setValue("relevantBrandTerms", raw);
    }
    if (query.get("activeKeywords")) setValue("activeKeywords", query.get("activeKeywords") ?? "");
    if (query.get("searchTerms")) setValue("searchTerms", query.get("searchTerms") ?? "");
    if (query.get("minConversionsForNewKeyword")) {
      setValue("minConversionsForNewKeyword", Number(query.get("minConversionsForNewKeyword")) || 1);
    }
    try {
      const cb = query.get("competitorBrands");
      if (cb) setCompetitorBrands(JSON.parse(cb));
    } catch { /* ignore */ }
    try {
      const ep = query.get("excludePatterns");
      if (ep) setExcludePatterns(JSON.parse(ep));
    } catch { /* ignore */ }
    try {
      const cr = query.get("customRules");
      if (cr) setValue("customRules", (JSON.parse(cr) as string[]).join("\n"));
    } catch { /* ignore */ }
    // If any query params exist, open Advanced Rules
    if (query.toString()) setShowAdvanced(true);
  }, [setValue]);

  function handleRuleSetChange(id: string) {
    setValue("ruleSetId", id);
    if (id) {
      const rs = ruleSets?.find((r) => String(r.id) === id);
      if (rs) {
        setCompetitorBrands(rs.competitorBrands ?? []);
        setExcludePatterns(rs.excludePatterns ?? []);
        setValue("minConversionsForNewKeyword", rs.minConversionsForNewKeyword ?? 1);
        setValue("customRules", (rs.customRules ?? []).join("\n"));
        if (rs.activeKeywords) setValue("activeKeywords", rs.activeKeywords);
        if (rs.landingPageUrl) setValue("landingPageUrl", rs.landingPageUrl);
        if (rs.targetLocations) setValue("targetLocations", rs.targetLocations);
        if (rs.relevantBrandTerms) {
          const terms = rs.relevantBrandTerms.split(",").map((s) => s.trim()).filter(Boolean);
          setRelevantBrandTerms(terms);
          setValue("relevantBrandTerms", rs.relevantBrandTerms);
        }
      }
    }
  }

  function handleFileUpload(
    file: File,
    setText: (val: string) => void
  ) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;
      try {
        let text: string;
        if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
          text = json
            .map((row) => (row as string[]).join("\t"))
            .join("\n");
        } else {
          text = String(data);
        }
        setText(text);
        toast({ title: "File loaded", description: `${file.name} — ${text.split("\n").filter(Boolean).length} rows loaded` });
      } catch (err) {
        toast({ title: "File error", description: "Could not read the file", variant: "destructive" });
      }
    };
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  function onSubmit(data: FormData) {
    const customRulesArr = data.customRules
      ? data.customRules.split("\n").map((l) => l.trim()).filter(Boolean)
      : [];

    createAnalysis.mutate({
      data: {
        name: data.name || `Analysis ${new Date().toLocaleDateString()}`,
        landingPageUrl: data.landingPageUrl || undefined,
        targetLocations: data.targetLocations || undefined,
        relevantBrandTerms: data.relevantBrandTerms || undefined,
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
              placeholder="e.g. Account Name - Date Range"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-analysis-name"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">
              Load Account Profile <span className="text-muted-foreground font-normal">(optional — pre-fills all fields)</span>
            </label>
            <select
              value={selectedRuleSetId}
              onChange={(e) => handleRuleSetChange(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="select-rule-set"
            >
              <option value="">No profile / start fresh</option>
              {ruleSets?.map((rs) => (
                <option key={rs.id} value={String(rs.id)}>{rs.name}{rs.accountName ? ` — ${rs.accountName}` : ""}</option>
              ))}
            </select>
            {selectedRuleSetId && (
              <p className="text-xs text-primary mt-1">
                ✓ Profile loaded — only paste new Search Terms below, everything else is pre-filled.
              </p>
            )}
          </div>
        </div>

        {/* Landing Page URL + Target Locations + Relevant Brand Terms */}
        <div className="bg-accent/40 border border-accent rounded-xl px-5 py-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">
              Landing Page URL <span className="text-muted-foreground font-normal">(optional — AI will scan your site for context)</span>
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              The AI reads your page to understand what you offer and judges each search term against it.
            </p>
            <input
              {...register("landingPageUrl")}
              type="url"
              placeholder="https://www.yourwebsite.com"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-landing-page-url"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground block mb-1">
              Target Locations <span className="text-muted-foreground font-normal">(optional — helps flag out-of-area searches)</span>
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Enter the cities, regions, or areas you serve. Searches mentioning locations outside this list will be marked irrelevant.
            </p>
            <input
              {...register("targetLocations")}
              placeholder="e.g. Dallas, Frisco, McKinney, Allen, Plano, DFW, Texas"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-target-locations"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground block mb-1">
              Relevant Brand Terms <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Enter your brand name(s). The AI will recognize variations, misspellings, abbreviations, and combined forms. This prevents your brand from being flagged as a competitor or irrelevant.
            </p>
            <TagInput
              value={relevantBrandTerms}
              onChange={(terms) => {
                setRelevantBrandTerms(terms);
                setValue("relevantBrandTerms", terms.join(", "), { shouldValidate: true });
              }}
              placeholder="your brand name..."
              data-testid="tag-input-relevant-brands"
            />
            {errors.relevantBrandTerms && <p className="text-xs text-destructive mt-1">Brand terms are required</p>}
          </div>
        </div>

        {/* Keywords and Terms */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Active Keywords</label>
            <p className="text-xs text-muted-foreground mb-2">
              Paste from Google Ads — full export or one keyword per line with match type and ad group.
            </p>
            <textarea
              {...register("activeKeywords", { required: true })}
              rows={12}
              placeholder={"running shoes | exact | Running Shoes\nbuy sneakers online | phrase | General\nsport footwear | broad | General"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y"
              data-testid="textarea-active-keywords"
            />
            <div className="flex items-center gap-2 mt-2">
              <input
                type="file"
                ref={activeKeywordsFileRef}
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, (val) => setValue("activeKeywords", val));
                  if (e.target) e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => activeKeywordsFileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 hover:bg-muted/40 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload CSV / XLSX
              </button>
            </div>
            {errors.activeKeywords && <p className="text-xs text-destructive mt-1">Active keywords are required</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1">Search Terms to Analyze</label>
            <p className="text-xs text-muted-foreground mb-2">
              Paste from Google Ads Search Terms report. Full export format is supported.
            </p>
            <textarea
              {...register("searchTerms", { required: true })}
              rows={12}
              placeholder={"running shoes for men\t1200\t84\t5\t42.50\nbuy nike shoes online\t340\t21\t0\t8.20\nbest running shoe brand\t220\t15\t2\t12.00"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y"
              data-testid="textarea-search-terms"
            />
            <div className="flex items-center gap-2 mt-2">
              <input
                type="file"
                ref={searchTermsFileRef}
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, (val) => setValue("searchTerms", val));
                  if (e.target) e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => searchTermsFileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 hover:bg-muted/40 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload CSV / XLSX
              </button>
            </div>
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
