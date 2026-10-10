import { Suspense, lazy, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  BinaryCodeIcon,
  BracketsIcon,
  CodeXmlIcon,
  Database01Icon,
  DatabaseSearchIcon,
  FileCodeIcon,
  FileSpreadsheetIcon,
  FingerPrintIcon,
  GitCompareIcon,
  GitMergeIcon,
  GlobalSearchIcon,
  Home01Icon,
  ImageDoneIcon,
  ListViewIcon,
  NetworkIcon,
  ParenthesesIcon,
  PlayCircleIcon,
  QrCodeIcon,
  Queue01Icon,
  TextNumberSignIcon,
  ToolboxIcon,
} from "@hugeicons/core-free-icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { categories, toolById, tools } from "./routes";
import { isDesktop } from "@/platform/runtime";
import { hasRegistration } from "@/platform/registration";

const UUIDGeneratorPage = lazy(() => import("@/tools/uuid-generator/UUIDGeneratorPage"));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const TOOL_ICONS = {
  uuid: FingerPrintIcon,
  json: BracketsIcon,
  base64: BinaryCodeIcon,
  "char-counter": TextNumberSignIcon,
  tlv: ListViewIcon,
  qr: QrCodeIcon,
  database: Database01Icon,
  querify: FileSpreadsheetIcon,
  "database-compare": GitCompareIcon,
  "jenkins-query": PlayCircleIcon,
  "jenkins-batch": Queue01Icon,
  "redis-cache": DatabaseSearchIcon,
  kafka: NetworkIcon,
  html: CodeXmlIcon,
  "splunk-template": FileCodeIcon,
  "sql-in": ParenthesesIcon,
  "merge-sql": GitMergeIcon,
  "image-check": ImageDoneIcon,
  language: GlobalSearchIcon,
} as const;

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

function AppNavigation({ desktop }: { desktop: boolean }) {
  const { setOpenMobile, state } = useSidebar();
  const { pathname } = useLocation();
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  return (
    <Sidebar collapsible="icon" aria-label="Main navigation">
      <SidebarHeader className="flex-row items-center justify-between">
        <SidebarMenu className="min-w-0 flex-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<NavLink to="/" onClick={() => setOpenMobile(false)} />}
              isActive={pathname === "/" || pathname === "/home"}
              tooltip="AD Tools"
            >
              <HugeiconsIcon icon={Home01Icon} strokeWidth={2} aria-hidden="true" />
              <span className="font-semibold">AD Tools</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarTrigger className="md:hidden" />
      </SidebarHeader>
      <SidebarContent>
        {categories
          .filter((category) => !category.requiresTauri || desktop)
          .map((category) => {
            const categoryTools = tools.filter((tool) => tool.category === category.id && (!tool.requiresTauri || desktop));
            if (categoryTools.length === 0) return null;

            return (
              <Collapsible
                key={category.id}
                open={state === "collapsed" || openCategories[category.id] !== false}
                onOpenChange={(open) => setOpenCategories((current) => ({ ...current, [category.id]: open }))}
                className="group/collapsible"
              >
                <SidebarGroup>
                  <SidebarGroupLabel
                    render={<CollapsibleTrigger />}
                    className="w-full cursor-pointer hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
                  >
                    {category.name}
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="ml-auto transition-transform group-data-closed/collapsible:-rotate-90"
                    />
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {categoryTools.map((tool) => (
                          <SidebarMenuItem key={tool.id}>
                            <SidebarMenuButton
                              render={<NavLink to={`/${tool.id}`} onClick={() => setOpenMobile(false)} />}
                              isActive={pathname === `/${tool.id}`}
                              tooltip={tool.name}
                            >
                              <HugeiconsIcon
                                icon={TOOL_ICONS[tool.icon as keyof typeof TOOL_ICONS] ?? ToolboxIcon}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                              <span>{tool.name}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            );
          })}
      </SidebarContent>
    </Sidebar>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const active = toolById.get(pathname.slice(1));
  const desktop = isDesktop();
  const registered = hasRegistration();

  return (
    <SidebarProvider className="bg-background text-foreground">
      <AppNavigation desktop={desktop} />
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:px-6">
          <SidebarTrigger />
          <NavLink to="/" className="font-medium">
            AD Tools
          </NavLink>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{active?.name ?? "Home"}</span>
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
    </SidebarProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <TooltipProvider>
          <AppShell />
        </TooltipProvider>
      </HashRouter>
    </QueryClientProvider>
  );
}
