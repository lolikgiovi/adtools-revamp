import { Suspense, lazy } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon } from "@hugeicons/core-free-icons";
import { buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { categories, toolById, tools } from "./routes";
import { isDesktop } from "@/platform/runtime";
import { hasRegistration } from "@/platform/registration";

const UUIDGeneratorPage = lazy(() => import("@/tools/uuid-generator/UUIDGeneratorPage"));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function HomePage() {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">AD Tools</h1>
      <p className="text-muted-foreground">Choose a tool from the navigation. UUID Generator is available in the React foundation.</p>
    </div>
  );
}

function PendingPage() {
  const { pathname } = useLocation();
  const id = pathname.slice(1);
  const tool = toolById.get(id);
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">{tool?.name ?? "Page unavailable"}</h1>
      <p className="text-muted-foreground">
        {tool ? "This tool is waiting for its React migration." : "This route is not part of AD Tools."}
      </p>
    </div>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const active = toolById.get(pathname.slice(1));
  const desktop = isDesktop();
  const registered = hasRegistration();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-4 md:block" aria-label="Main navigation">
        <NavLink to="/" className="mb-6 flex items-center gap-2 font-semibold text-sidebar-foreground">
          <HugeiconsIcon icon={Home01Icon} strokeWidth={2} aria-hidden="true" /> AD Tools
        </NavLink>
        <nav className="flex flex-col gap-4" aria-label="Tools">
          {categories
            .filter((category) => !category.requiresTauri || desktop)
            .map((category) => (
              <div key={category.id} className="flex flex-col gap-1">
                <h2 className="px-2 text-xs font-medium uppercase text-muted-foreground">{category.name}</h2>
                {tools
                  .filter((tool) => tool.category === category.id && (!tool.requiresTauri || desktop))
                  .map((tool) => (
                    <NavLink
                      key={tool.id}
                      to={`/${tool.id}`}
                      className={({ isActive }) =>
                        `rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent ${isActive ? "bg-sidebar-accent font-medium" : "text-sidebar-foreground"}`
                      }
                    >
                      {tool.name}
                    </NavLink>
                  ))}
              </div>
            ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:px-6">
          <NavLink to="/" className="font-medium">
            AD Tools
          </NavLink>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{active?.name ?? "Home"}</span>
          <NavLink to="/uuid-generator" className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto md:hidden`}>
            UUID Generator
          </NavLink>
        </header>
        <main className="p-4 md:p-6">
          {registered ? (
            <Suspense fallback={<p role="status">Loading tool…</p>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/uuid-generator" element={<UUIDGeneratorPage />} />
                <Route path="*" element={<PendingPage />} />
              </Routes>
            </Suspense>
          ) : (
            <div role="alert" className="max-w-xl rounded-md border p-4">
              Registration is required. The registration page is awaiting its React migration.
            </div>
          )}
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </QueryClientProvider>
  );
}
