import { Suspense, lazy, useEffect, useState } from "react";
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
  PinIcon,
  PinOffIcon,
  PlayCircleIcon,
  QrCodeIcon,
  Queue01Icon,
  TextNumberSignIcon,
  ToolboxIcon,
} from "@hugeicons/core-free-icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
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
import { toast, Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { categories, toolById, tools } from "./routes";
import { isDesktop } from "@/platform/runtime";
import { hasRegistration } from "@/platform/registration";
import { UsageTracker } from "../../core/UsageTracker.js";

const UUIDGeneratorPage = lazy(() => import("@/tools/uuid-generator/UUIDGeneratorPage"));
const JSONToolsPage = lazy(() => import("@/tools/json-tools/JSONToolsPage"));
const Base64ToolsPage = lazy(() => import("@/tools/base64-tools/Base64ToolsPage"));
const CharCounterPage = lazy(() => import("@/tools/char-counter/CharCounterPage"));
const TLVViewerPage = lazy(() => import("@/tools/tlv-viewer/TLVViewerPage"));
const QRToolsPage = lazy(() => import("@/tools/qr-tools/QRToolsPage"));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const PINNED_TOOLS_STORAGE_KEY = "sidebar.pinnedTools.v1";
const PIN_EDUCATION_STORAGE_KEY = "sidebar.pinEducationShown.v1";
const MAX_PIN_EDUCATION_SHOWN = 1;
const SIDEBAR_LABEL_CLASS_NAME = [
  "min-w-0 max-w-[12rem] truncate whitespace-nowrap",
  "transition-[max-width,opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
  "group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:-translate-x-1",
  "group-data-[collapsible=icon]:opacity-0",
].join(" ");
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

function loadPinnedToolIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_TOOLS_STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((toolId) => String(toolId || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function HomePage() {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">AD Tools</h1>
      <p className="text-muted-foreground">Choose a tool from the navigation.</p>
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
  const { isMobile, setOpenMobile, state } = useSidebar();
  const { pathname } = useLocation();
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [pinnedToolIds, setPinnedToolIds] = useState(loadPinnedToolIds);

  useEffect(() => {
    if (isMobile) return;

    try {
      const count = Number.parseInt(window.localStorage.getItem(PIN_EDUCATION_STORAGE_KEY) || "0", 10);
      if (Number.isFinite(count) && count >= MAX_PIN_EDUCATION_SHOWN) return;
      window.localStorage.setItem(PIN_EDUCATION_STORAGE_KEY, String(MAX_PIN_EDUCATION_SHOWN));
      toast.add({
        title: "Pin your favorite tools",
        description: "Right-click a tool to pin or unpin it.",
        type: "info",
      });
    } catch {
      // Pinning remains available when local storage is disabled.
    }
  }, [isMobile]);

  const togglePinnedTool = (toolId: string) => {
    const isPinned = pinnedToolIds.includes(toolId);
    const nextPinnedToolIds = isPinned ? pinnedToolIds.filter((id) => id !== toolId) : [...pinnedToolIds, toolId];

    setPinnedToolIds(nextPinnedToolIds);
    try {
      window.localStorage.setItem(PINNED_TOOLS_STORAGE_KEY, JSON.stringify(nextPinnedToolIds));
    } catch {
      // Keep the current-session state usable when local storage is unavailable.
    }

    try {
      UsageTracker.trackEvent(toolId, isPinned ? "sidebar_unpin" : "sidebar_pin", {
        tool_id: toolId,
        source: "sidebar_context_menu",
      });
    } catch {
      // Analytics must not interrupt a navigation action.
    }
  };

  const visibleTools = tools.filter((tool) => !tool.requiresTauri || desktop);
  const visibleToolsById = new Map(visibleTools.map((tool) => [tool.id, tool]));
  const pinnedToolIdSet = new Set(pinnedToolIds);
  const pinnedTools = pinnedToolIds
    .map((toolId) => visibleToolsById.get(toolId))
    .filter((tool): tool is (typeof tools)[number] => tool !== undefined);

  const renderToolItem = (tool: (typeof tools)[number], isPinned: boolean) => (
    <SidebarMenuItem key={tool.id}>
      <ContextMenu>
        <ContextMenuTrigger>
          <SidebarMenuButton
            render={<NavLink to={`/${tool.id}`} onClick={() => setOpenMobile(false)} />}
            isActive={pathname === `/${tool.id}`}
            tooltip={tool.name}
          >
            <HugeiconsIcon icon={TOOL_ICONS[tool.icon as keyof typeof TOOL_ICONS] ?? ToolboxIcon} strokeWidth={2} aria-hidden="true" />
            <span className={SIDEBAR_LABEL_CLASS_NAME}>{tool.name}</span>
            {isPinned && (
              <span
                className="ml-auto max-w-4 shrink-0 overflow-hidden text-muted-foreground transition-[max-width,opacity,transform] duration-150 ease-out group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:translate-x-1 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:pointer-events-none"
                title="Pinned"
                aria-label="Pinned"
                role="img"
              >
                <HugeiconsIcon icon={PinIcon} strokeWidth={2} aria-hidden="true" />
              </span>
            )}
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => togglePinnedTool(tool.id)}>
            <HugeiconsIcon icon={isPinned ? PinOffIcon : PinIcon} strokeWidth={2} aria-hidden="true" />
            <span>
              {isPinned ? "Unpin" : "Pin"} {tool.name}
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  );

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
              <span className={`font-semibold ${SIDEBAR_LABEL_CLASS_NAME}`}>AD Tools</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarTrigger className="md:hidden" />
      </SidebarHeader>
      <SidebarContent>
        {pinnedTools.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel aria-hidden={state === "collapsed"}>Pinned</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{pinnedTools.map((tool) => renderToolItem(tool, true))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {categories
          .filter((category) => !category.requiresTauri || desktop)
          .map((category) => {
            const categoryTools = visibleTools.filter((tool) => tool.category === category.id && !pinnedToolIdSet.has(tool.id));
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
                    render={<CollapsibleTrigger disabled={state === "collapsed"} />}
                    aria-hidden={state === "collapsed"}
                    className="w-full cursor-pointer group-data-[collapsible=icon]:pointer-events-none"
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
                      <SidebarMenu>{categoryTools.map((tool) => renderToolItem(tool, false))}</SidebarMenu>
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
        <header className="flex h-12 items-center gap-3 border-b px-4 text-sm md:px-6">
          <SidebarTrigger />
          <NavLink to="/" className="font-medium">
            AD Tools
          </NavLink>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{active?.name ?? "Home"}</span>
        </header>
        <main className="tool-workspace p-4 md:p-6">
          {registered ? (
            <Suspense fallback={<p role="status">Loading tool…</p>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/uuid-generator" element={<UUIDGeneratorPage />} />
                <Route path="/json-tools" element={<JSONToolsPage />} />
                <Route path="/base64-tools" element={<Base64ToolsPage />} />
                <Route path="/char-counter" element={<CharCounterPage />} />
                <Route path="/tlv-viewer" element={<TLVViewerPage />} />
                <Route path="/qr-tools" element={<QRToolsPage />} />
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
