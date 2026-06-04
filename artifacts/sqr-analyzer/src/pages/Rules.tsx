import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useListRules, useCreateRuleSet, useUpdateRuleSet, useDeleteRuleSet,
  getListRulesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import TagInput from "@/components/TagInput";
import { Plus, Edit2, Trash2, Loader2, X, Settings } from "lucide-react";

interface FormData {
  name: string;
  accountName: string;
  landingPageUrl: string;
  targetLocations: string;
  activeKeywords: string;
  minConversionsForNewKeyword: number;
  customRules: string;
}

interface RuleSetForm {
  id?: number;
  name: string;
  accountName: string;
  landingPageUrl: string;
  targetLocations: string;
  relevantBrandTerms: string[];
  activeKeywords: string;
  competitorBrands: string[];
  excludePatterns: string[];
  minConversionsForNewKeyword: number;
  customRules: string;
}

function RuleSetFormPanel({
  initial,
  onClose,
}: {
  initial?: RuleSetForm;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createRuleSet = useCreateRuleSet();
  const updateRuleSet = useUpdateRuleSet();

  const [competitorBrands, setCompetitorBrands] = useState<string[]>(initial?.competitorBrands ?? []);
  const [excludePatterns, setExcludePatterns] = useState<string[]>(initial?.excludePatterns ?? []);
  const [relevantBrandTerms, setRelevantBrandTerms] = useState<string[]>(initial?.relevantBrandTerms ?? []);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      name: initial?.name ?? "",
      accountName: initial?.accountName ?? "",
      landingPageUrl: initial?.landingPageUrl ?? "",
      targetLocations: initial?.targetLocations ?? "",
      activeKeywords: initial?.activeKeywords ?? "",
      minConversionsForNewKeyword: initial?.minConversionsForNewKeyword ?? 1,
      customRules: initial?.customRules ?? "",
    }
  });

  function onSubmit(data: FormData) {
    const customRulesArr = data.customRules
      ? data.customRules.split("\n").map((l) => l.trim()).filter(Boolean)
      : [];

    const payload = {
      name: data.name,
      accountName: data.accountName || undefined,
      landingPageUrl: data.landingPageUrl || undefined,
      targetLocations: data.targetLocations || undefined,
      relevantBrandTerms: relevantBrandTerms.length > 0 ? relevantBrandTerms.join(", ") : undefined,
      activeKeywords: data.activeKeywords || undefined,
      competitorBrands,
      excludePatterns,
      customRules: customRulesArr,
      minConversionsForNewKeyword: Number(data.minConversionsForNewKeyword) || 1,
    };

    if (initial?.id) {
      updateRuleSet.mutate({ id: initial.id, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
          toast({ title: "Rule set updated" });
          onClose();
        },
        onError: () => toast({ title: "Error", description: "Failed to update rule set", variant: "destructive" }),
      });
    } else {
      createRuleSet.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
          toast({ title: "Rule set created" });
          onClose();
        },
        onError: () => toast({ title: "Error", description: "Failed to create rule set", variant: "destructive" }),
      });
    }
  }

  const isPending = createRuleSet.isPending || updateRuleSet.isPending;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground text-sm">{initial?.id ? "Edit Rule Set" : "New Rule Set"}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-close-form">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Rule Set Name *</label>
            <input
              {...register("name", { required: true })}
              placeholder="e.g. E-commerce Brand Rules"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-ruleset-name"
            />
            {errors.name && <p className="text-xs text-destructive mt-1">Name is required</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Account Name</label>
            <input
              {...register("accountName")}
              placeholder="e.g. Nike US Brand"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-account-name"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Landing Page URL</label>
            <input
              {...register("landingPageUrl")}
              placeholder="https://www.yourwebsite.com"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-ruleset-landing-page"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Target Locations</label>
            <input
              {...register("targetLocations")}
              placeholder="e.g. Dallas, Frisco, McKinney, Allen, Plano, DFW, Texas"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-ruleset-target-locations"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Relevant Brand Terms</label>
            <p className="text-xs text-muted-foreground mb-2">Enter your brand name(s). The AI will recognize variations, misspellings, abbreviations, and combined forms.</p>
            <TagInput value={relevantBrandTerms} onChange={setRelevantBrandTerms} placeholder="your brand name..." />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Active Keywords</label>
            <p className="text-xs text-muted-foreground mb-2">Paste from Google Ads — full export or one keyword per line with match type and ad group.</p>
            <textarea
              {...register("activeKeywords")}
              rows={4}
              placeholder="running shoes | exact | Running Shoes\nbuy sneakers online | phrase | General"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-none"
              data-testid="textarea-ruleset-active-keywords"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Competitor Brands</label>
            <p className="text-xs text-muted-foreground mb-2">Press Enter or comma to add.</p>
            <TagInput value={competitorBrands} onChange={setCompetitorBrands} placeholder="adidas, puma, reebok..." />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Exclude Patterns</label>
            <p className="text-xs text-muted-foreground mb-2">Terms containing these will be marked irrelevant.</p>
            <TagInput value={excludePatterns} onChange={setExcludePatterns} placeholder="free, diy, wholesale..." />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Min Conversions for New Keyword</label>
            <input
              type="number"
              min={0}
              {...register("minConversionsForNewKeyword")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-min-conv-ruleset"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Custom Rules</label>
            <textarea
              {...register("customRules")}
              rows={3}
              placeholder={"Exclude informational queries\nFlag review terms as irrelevant"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
              data-testid="textarea-custom-rules-form"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-5 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
            data-testid="button-save-ruleset"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {initial?.id ? "Save Changes" : "Create Rule Set"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2" data-testid="button-cancel-form">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Rules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: ruleSets, isLoading } = useListRules();
  const deleteRuleSet = useDeleteRuleSet();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RuleSetForm | null>(null);

  function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteRuleSet.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
        toast({ title: "Rule set deleted" });
      },
      onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
    });
  }

  function handleEdit(rs: NonNullable<typeof ruleSets>[number]) {
    setEditing({
      id: rs.id,
      name: rs.name,
      accountName: rs.accountName ?? "",
      landingPageUrl: rs.landingPageUrl ?? "",
      targetLocations: rs.targetLocations ?? "",
      relevantBrandTerms: rs.relevantBrandTerms ? rs.relevantBrandTerms.split(",").map((s) => s.trim()).filter(Boolean) : [],
      activeKeywords: rs.activeKeywords ?? "",
      competitorBrands: rs.competitorBrands ?? [],
      excludePatterns: rs.excludePatterns ?? [],
      minConversionsForNewKeyword: rs.minConversionsForNewKeyword ?? 1,
      customRules: (rs.customRules ?? []).join("\n"),
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-7 border-b border-border bg-card/50 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rule Sets</h1>
          <p className="text-muted-foreground text-sm mt-1">Configure reusable analysis rules per account</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
          data-testid="button-new-ruleset"
        >
          <Plus className="w-4 h-4" />
          New Rule Set
        </button>
      </div>

      <div className="px-8 py-6 space-y-4">
        {showForm && (
          <RuleSetFormPanel initial={editing ?? undefined} onClose={closeForm} />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !ruleSets || ruleSets.length === 0 ? (
          !showForm && (
            <div className="flex flex-col items-center justify-center py-20">
              <Settings className="w-10 h-10 text-muted-foreground/30 mb-4" />
              <p className="font-medium text-foreground">No rule sets yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-5">Create reusable rules for different accounts</p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 rounded-md hover:opacity-90 transition-opacity"
                data-testid="button-create-first-ruleset"
              >
                Create Rule Set
              </button>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {ruleSets.map((rs) => (
              <div key={rs.id} className="bg-card border border-card-border rounded-xl p-5" data-testid={`ruleset-${rs.id}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-foreground">{rs.name}</div>
                    {rs.accountName && <div className="text-sm text-muted-foreground mt-0.5">{rs.accountName}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(rs)}
                      className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
                      data-testid={`button-edit-${rs.id}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rs.id, rs.name)}
                      className="p-2 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10 transition-colors"
                      data-testid={`button-delete-${rs.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {rs.landingPageUrl && (
                    <div>
                      <span className="font-medium text-foreground">Landing Page: </span>
                      {rs.landingPageUrl}
                    </div>
                  )}
                  {rs.targetLocations && (
                    <div>
                      <span className="font-medium text-foreground">Locations: </span>
                      {rs.targetLocations}
                    </div>
                  )}
                  {rs.relevantBrandTerms && (
                    <div>
                      <span className="font-medium text-foreground">Brand Terms: </span>
                      {rs.relevantBrandTerms}
                    </div>
                  )}
                  {rs.activeKeywords && (
                    <div>
                      <span className="font-medium text-foreground">Active Keywords: </span>
                      {rs.activeKeywords.split("\n").length} lines
                    </div>
                  )}
                  {rs.competitorBrands && rs.competitorBrands.length > 0 && (
                    <div>
                      <span className="font-medium text-foreground">Competitors: </span>
                      {rs.competitorBrands.join(", ")}
                    </div>
                  )}
                  {rs.excludePatterns && rs.excludePatterns.length > 0 && (
                    <div>
                      <span className="font-medium text-foreground">Exclude: </span>
                      {rs.excludePatterns.join(", ")}
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-foreground">Min conversions: </span>
                    {rs.minConversionsForNewKeyword}
                  </div>
                  <div className="text-muted-foreground/50">Updated {new Date(rs.updatedAt).toLocaleDateString()}</div>
                </div>
                {rs.customRules && rs.customRules.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Custom rules: </span>
                    {rs.customRules.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
