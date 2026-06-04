import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Analyze from "@/pages/Analyze";
import Results from "@/pages/Results";
import History from "@/pages/History";
import Rules from "@/pages/Rules";
import NotFound from "@/pages/not-found";
import { Lock } from "lucide-react";

const CORRECT_PASSWORD = "SQR2026";
const SESSION_KEY = "sqr_authenticated";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PasswordGate({ onAuth }: { onAuth: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === CORRECT_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onAuth();
    } else {
      setError(true);
      setInput("");
    }
  }

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <div className="flex flex-col items-center mb-7">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-md">
            <Lock className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">SQR Analyzer</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your access code to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Access Code</label>
            <input
              type="password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="••••••••"
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {error && (
              <p className="text-xs text-destructive mt-1.5">Incorrect access code. Please try again.</p>
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-primary text-primary-foreground text-sm font-semibold py-2.5 rounded-md hover:opacity-90 transition-opacity"
          >
            Access App
          </button>
        </form>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Analyze} />
        <Route path="/analyze" component={Analyze} />
        <Route path="/results/:id" component={Results} />
        <Route path="/history" component={History} />
        <Route path="/rules" component={Rules} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "1"
  );

  if (!authenticated) {
    return <PasswordGate onAuth={() => setAuthenticated(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
