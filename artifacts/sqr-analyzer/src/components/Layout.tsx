import { Link, useLocation } from "wouter";
import { Search, History, Settings, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "New Analysis", icon: Search },
  { path: "/history", label: "History", icon: History },
  { path: "/rules", label: "Rule Sets", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-sidebar flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sidebar-foreground font-semibold text-sm leading-tight">SQR Analyzer</div>
              <div className="text-sidebar-foreground/50 text-xs">Google Ads</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = path === "/" ? location === "/" : location.startsWith(path);
            return (
              <Link
                key={path}
                href={path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors group",
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
                {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-sidebar-border space-y-2">
          <button
            onClick={() => {
              if (confirm("Start a new session? Your current analyses and rule sets will be hidden (not deleted).")) {
                localStorage.removeItem("sqr_session_id");
                window.location.reload();
              }
            }}
            className="flex items-center gap-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            title="Start a new browser session"
          >
            <LogOut className="w-3 h-3" />
            New Session
          </button>
          <p className="text-sidebar-foreground/30 text-xs">Powered by AI</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
