"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Package, Palette, Tag } from "lucide-react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import AdminDashboard from "./AdminDashboard";
import ClientManagement from "./ClientManagement";
import PlanManagement from "@/components/PlanManagement";
import BackgroundSettings from "./BackgroundSettings";
import ThemeSettings from "./ThemeSettings";
import GenreManagement from "./GenreManagement";

const tabs = [
  { id: "dashboard", label: "Resumo dos Dados", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "clientes", label: "Clientes", icon: <Users className="h-4 w-4" /> },
  { id: "generos", label: "Gêneros", icon: <Tag className="h-4 w-4" /> },
  { id: "planos", label: "Planos & Serviços", icon: <Package className="h-4 w-4" /> },
  { id: "aparencia", label: "Aparência", icon: <Palette className="h-4 w-4" /> },
] as const;

const ADMIN_TAB_RESTORE_LIMIT_MS = 5 * 60 * 1000;

const isValidAdminTab = (tab: unknown): tab is string =>
  typeof tab === "string" && tabs.some((item) => item.id === tab);

const AdminPanel = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { prefs, loaded, updatePref } = useUserPreferences();

  const tabFromUrl = searchParams.get("tab");
  const initialTab = isValidAdminTab(tabFromUrl) ? tabFromUrl : "dashboard";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Restore saved tab from prefs once loaded (if no URL tab override)
  useEffect(() => {
    if (!loaded) return;
    const urlTab = searchParams.get("tab");
    if (urlTab && isValidAdminTab(urlTab)) return; // URL takes priority
    const savedTab = prefs.admin_tab;
    const savedTs = prefs.admin_tab_ts ?? 0;
    if (
      savedTab &&
      isValidAdminTab(savedTab) &&
      Date.now() - savedTs <= ADMIN_TAB_RESTORE_LIMIT_MS
    ) {
      setActiveTab(savedTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    updatePref("admin_tab", activeTab);
    updatePref("admin_tab_ts", Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && isValidAdminTab(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (tabId: string) => {
    if (!isValidAdminTab(tabId) || tabId === activeTab) return;
    setActiveTab(tabId);
    updatePref("admin_tab", tabId);
    updatePref("admin_tab_ts", Date.now());
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", "admin");
    params.set("tab", tabId);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="bg-background pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 pt-1">
        <div className="flex flex-wrap gap-1 p-1 bg-card rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 active:scale-95 ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div key={activeTab} className="space-y-6">
          {activeTab === "dashboard" && <AdminDashboard />}
          {activeTab === "clientes" && <ClientManagement />}
          {activeTab === "generos" && <GenreManagement />}
          {activeTab === "planos" && <PlanManagement />}
          {activeTab === "aparencia" && <><ThemeSettings /><BackgroundSettings /></>}
      </div>
    </div>
  );
};

export default AdminPanel;
