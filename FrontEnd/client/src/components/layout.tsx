import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { FileText, Book, Network, LogOut, Hexagon, Search, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";

export function Layout({ children, defaultSidebarOpen = true }: { children: ReactNode, defaultSidebarOpen?: boolean }) {
  const [location] = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(defaultSidebarOpen);

  // Auto-retract sidebar on certain pages
  useEffect(() => {
    if (location === "/all-documents") {
      setIsSidebarOpen(false);
    }
  }, [location]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[hsl(var(--background))] gradient-bg">
      {/* Header */}
      <header className="flex h-16 items-center justify-between bg-primary/95 backdrop-blur-md px-6 text-primary-foreground shrink-0 shadow-lg z-20 border-b border-primary/20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 -ml-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors hidden md:block"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm ml-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-hexagon h-5 w-5 text-white"
              aria-hidden="true"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <h1 className="text-xl font-heading font-medium tracking-wide truncate hidden sm:block">
            Legal Document AI
          </h1>
        </div>

        <div className="flex-1 max-w-md mx-8 hidden md:block">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/50" />
            <Input
              placeholder="Search across documents..."
              className="pl-9 bg-white/10 border-white/10 text-white placeholder:text-white/50 focus-visible:ring-white/20 rounded-full h-9"
            />
          </div>
        </div>

        <div className="flex items-center">
          <Link href="/">
            <button className="flex items-center gap-2 text-sm text-primary-foreground/80 hover:text-white transition-all hover:bg-white/10 px-3 py-1.5 rounded-full" data-testid="button-logout">
              <LogOut className="h-4 w-4" />
              <span className="font-medium hidden sm:block">Sign Out</span>
            </button>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${isSidebarOpen ? 'w-64' : 'w-[72px]'} glass-panel border-r border-white/50 shrink-0 flex flex-col z-10 my-4 ml-4 rounded-2xl shadow-sm overflow-hidden hidden md:flex transition-all duration-300 ease-in-out`}>
          <div className={`p-4 pt-6 ${!isSidebarOpen && 'px-2'}`}>
            <div className={`flex items-center justify-between mb-3 ${isSidebarOpen ? 'px-3' : 'justify-center'}`}>
              {isSidebarOpen && (
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap overflow-hidden">
                  Core Modules
                </h2>
              )}
            </div>
            <nav className="space-y-1.5">
              <Link href="/dashboard">
                <a
                  className={`flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${location === "/dashboard"
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    } ${isSidebarOpen ? 'px-3' : 'px-0 justify-center'}`}
                  data-testid="link-dashboard"
                  title="Topic & Keyword ID"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  {isSidebarOpen && <span className="truncate">Topic & Keyword ID</span>}
                </a>
              </Link>

              <Link href="/status">
                <a
                  className={`flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${location === "/status"
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    } ${isSidebarOpen ? 'px-3' : 'px-0 justify-center'}`}
                  data-testid="link-status"
                  title="Topic Dictionary"
                >
                  <Book className="h-4 w-4 shrink-0" />
                  {isSidebarOpen && <span className="truncate">Topic Dictionary</span>}
                </a>
              </Link>

              <Link href="/mindmap">
                <a
                  className={`flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${location === "/mindmap"
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    } ${isSidebarOpen ? 'px-3' : 'px-0 justify-center'}`}
                  title="Topic MindMap"
                >
                  <Network className="h-4 w-4 shrink-0" />
                  {isSidebarOpen && (
                    <span className="truncate">Topic MindMap</span>
                  )}
                </a>
              </Link>
            </nav>
          </div>

          <div className={`mt-auto border-t border-border/50 py-4 ${isSidebarOpen ? 'px-4' : 'px-0'}`}>
            <div className={`flex items-center gap-3 ${isSidebarOpen ? 'px-3 py-2' : 'justify-center'}`}>
              <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center text-white font-heading font-medium text-sm shadow-sm">
                AD
              </div>
              {isSidebarOpen && (
                <div className="flex flex-col truncate">
                  <span className="text-sm font-medium leading-none truncate">Admin User</span>
                  <span className="text-xs text-muted-foreground mt-1 truncate"></span>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 pt-4 pb-4 w-full">
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}