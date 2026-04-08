"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Package, Palette, Tag } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AdminDashboard from "./AdminDashboard";
import ClientManagement from "./ClientManagement";
import PlanManagement from "@/components/PlanManagement";
import BackgroundSettings from "./BackgroundSettings";
import ThemeSettings from "./ThemeSettings";
import GenreManagement from "./GenreManagement";

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "clientes", label: "Clientes", icon: <Users className="h-4 w-4" /> },
  { id: "generos", label: "Gêneros", icon: <Tag className="h-4 w-4" /> },
  { id: "planos", label: "Planos & Serviços", icon: <Package className="h-4 w-4" /> },
  { id: "aparencia", label: "Aparência", icon: <Palette className="h-4 w-4" /> },
] as const;

const ADMIN_TAB_KEY = "edu-admin-active-tab";
const ADMIN_TAB_TS_KEY = "edu-admin-active-tab-ts";
const ADMIN_TAB_RESTORE_LIMIT_MS = 5 * 60 * 1000;

const isValidAdminTab = (tab: unknown): tab is string =>
  typeof tab === "string" && tabs.some((item) => item.id === tab);

const getSavedAdminTab = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const tab = localStorage.getItem(ADMIN_TAB_KEY);
    const ts = localStorage.getItem(ADMIN_TAB_TS_KEY);
    if (!tab || !ts || !isValidAdminTab(tab)) return null;
    const elapsed = Date.now() - Number(ts);
    if (elapsed > ADMIN_TAB_RESTORE_LIMIT_MS) return null;
    return tab;
  } catch {
    return null;
  }
};

const saveAdminTab = (tab: string) => {
  try {
    localStorage.setItem(ADMIN_TAB_KEY, tab);
    localStorage.setItem(ADMIN_TAB_TS_KEY, String(Date.now()));
  } catch {}
};

const AdminPanel = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabFromUrl = searchParams.get("tab");
  const initialTab = isValidAdminTab(tabFromUrl) ? tabFromUrl : getSavedAdminTab() ?? "generos";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    saveAdminTab(activeTab);
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
    saveAdminTab(tabId);
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

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="space-y-6"
        >
          {activeTab === "dashboard" && <AdminDashboard />}
          {activeTab === "clientes" && <ClientManagement />}
          {activeTab === "generos" && <GenreManagement />}
          {activeTab === "planos" && <PlanManagement />}
          {activeTab === "aparencia" && <><ThemeSettings /><BackgroundSettings /></>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default AdminPanel;
