"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Check,
  Plus,
  X,
  Save,
  Loader2,
  Package,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Store,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useServicePlans, ServicePlan } from "@/hooks/useServicePlans";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/* ── tiny inline editor ── */
const EditableText = ({
  value,
  onChange,
  className = "",
  placeholder = "",
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  type?: string;
}) => (
  <input
    type={type}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    spellCheck
    lang="pt-BR"
    className={`bg-transparent border-b-2 border-dashed border-primary/40 focus:border-primary outline-none transition-colors w-full ${className}`}
  />
);

/* ── editable list row ── */
const EditableListItem = ({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) => (
  <div className="flex items-start gap-2 text-sm text-foreground group">
    <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-1.5" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck
      lang="pt-BR"
      className="bg-transparent border-b border-dashed border-primary/30 focus:border-primary outline-none flex-1 transition-colors text-sm"
    />
    <button
      onClick={onRemove}
      className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity shrink-0 mt-0.5"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  </div>
);

/* ══════════════════════════════════════════════
   VISUAL PLAN CARD  –  full inline editor
   ══════════════════════════════════════════════ */
const VisualPlanCard = ({
  plan,
  onSave,
  onDelete,
}: {
  plan: ServicePlan;
  onSave: (id: string, updates: Partial<ServicePlan>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) => {
  const snap = (v: typeof localState) => ({
    service_label: v.serviceLabel.trim(),
    plan_label: v.planLabel.trim(),
    price: String(parseFloat(v.price) || 0),
    store_count: String(parseInt(v.storeCount) || 1),
    store_label: v.storeLabel.trim() || "Lojas",
    ai_audio_limit: String(parseInt(v.aiLimit) || 0),
    features: v.features.map((f) => f.trim()).filter(Boolean),
    included: v.included.map((f) => f.trim()).filter(Boolean),
    button_label: v.buttonLabel.trim() || "ASSINAR AGORA",
    is_active: v.isActive,
  });

  const initState = (p: ServicePlan) => ({
    serviceLabel: p.service_label,
    planLabel: p.plan_label,
    price: String(p.price),
    storeCount: String(p.store_count),
    storeLabel: (p as any).store_label || "Lojas",
    aiLimit: String(p.ai_audio_limit),
    features: [...p.features],
    included: [...p.included],
    buttonLabel: p.button_label,
    isActive: p.is_active,
  });

  const [localState, setLocal] = useState(() => initState(plan));
  const [savedSnap, setSavedSnap] = useState(() => snap(initState(plan)));
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const s = initState(plan);
    setLocal(s);
    setSavedSnap(snap(s));
    setIsDirty(false);
  }, [plan]);

  const set = <K extends keyof typeof localState>(k: K, v: (typeof localState)[K]) => {
    setLocal((prev) => {
      if (prev[k] !== v) setIsDirty(true);
      return { ...prev, [k]: v };
    });
  };

  const priceNum = parseFloat(localState.price) || 0;
  const storeNum = parseInt(localState.storeCount) || 1;

  const currentSnap = snap(localState);
  const snapshotChanged = JSON.stringify(currentSnap) !== JSON.stringify(savedSnap);
  const hasChanges = isDirty || snapshotChanged;

  /* list helpers */
  const updateList = (list: "features" | "included", idx: number, val: string) => {
    const next = [...localState[list]];
    next[idx] = val;
    set(list, next);
  };
  const removeList = (list: "features" | "included", idx: number) =>
    set(list, localState[list].filter((_, i) => i !== idx));
  const addList = (list: "features" | "included") =>
    set(list, [...localState[list], ""]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await onSave(plan.id, {
        service_label: currentSnap.service_label,
        plan_label: currentSnap.plan_label,
        price: Number(currentSnap.price),
        store_count: Number(currentSnap.store_count),
        features: currentSnap.features,
        included: currentSnap.included,
        button_label: currentSnap.button_label,
        is_active: currentSnap.is_active,
      });

      if (ok) {
        setSavedSnap(currentSnap);
        setIsDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Excluir o plano "${plan.plan_label}"?`)) return;
    setDeleting(true);
    await onDelete(plan.id);
    setDeleting(false);
  };

  return (
    <div
      className={`rounded-xl border-2 bg-card p-5 space-y-4 transition-all duration-[600ms] ${
        localState.isActive
          ? "border-primary hover:shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
          : "border-muted opacity-60"
      }`}
    >
      {/* Active toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {localState.isActive ? (
            <Eye className="h-3.5 w-3.5 text-primary" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
          <span>{localState.isActive ? "Ativo (visível na venda)" : "Desativado"}</span>
        </div>
        <Switch
          checked={localState.isActive}
          onCheckedChange={async (v) => {
            set("isActive", v);
            await onSave(plan.id, { is_active: v });
          }}
        />
      </div>

      {/* Header - Nome do Plano */}
      <div className="space-y-3">
        <EditableText
          value={localState.planLabel}
          onChange={(v) => set("planLabel", v)}
          className="text-lg font-bold text-foreground"
          placeholder="Nome do Plano"
        />
      </div>

      {/* Preço e Lojas - Layout organizado */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Preço mensal
          </label>
          <div className="flex items-baseline gap-1">
            <span className="text-sm text-muted-foreground">R$</span>
            <EditableText
              value={localState.price}
              onChange={(v) => set("price", v)}
              type="number"
              className="text-xl font-extrabold text-primary w-20"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Store className="h-3 w-3" />
            <EditableText
              value={localState.storeLabel || "Lojas"}
              onChange={(v) => set("storeLabel", v)}
              className="text-[10px] uppercase tracking-wide w-16"
              placeholder="Lojas"
            />
          </label>
          <EditableText
            value={localState.storeCount}
            onChange={(v) => set("storeCount", v)}
            type="number"
            className="text-xl font-extrabold text-foreground w-16"
          />
        </div>
      </div>

      {/* Serviço */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Layers className="h-3 w-3" /> Serviço
        </label>
        <EditableText
          value={localState.serviceLabel}
          onChange={(v) => set("serviceLabel", v)}
          className="text-sm text-foreground"
          placeholder="Ex: Rádio Interna"
        />
      </div>

      {/* Features */}
      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Vantagens
        </p>
        <div className="grid gap-1.5">
          {localState.features.map((f, i) => (
            <EditableListItem
              key={i}
              value={f}
              onChange={(v) => updateList("features", i, v)}
              onRemove={() => removeList("features", i)}
            />
          ))}
          <button
            onClick={() => addList("features")}
            className="flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors mt-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar benefício
          </button>
        </div>
      </div>

      {/* Included */}
      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Funções incluídas
        </p>
        <div className="grid gap-1">
          {localState.included.map((f, i) => (
            <EditableListItem
              key={i}
              value={f}
              onChange={(v) => updateList("included", i, v)}
              onRemove={() => removeList("included", i)}
            />
          ))}
          <button
            onClick={() => addList("included")}
            className="flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors mt-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar função
          </button>
        </div>
      </div>

      {/* CTA button preview */}
      <div className="w-full h-12 text-base font-bold rounded-lg border-2 border-primary bg-primary text-primary-foreground flex items-center justify-center">
        <input
          value={localState.buttonLabel}
          onChange={(e) => set("buttonLabel", e.target.value)}
          className="bg-transparent text-center w-full h-full font-bold text-base outline-none text-primary-foreground placeholder:text-primary-foreground/50"
          placeholder="Texto do botão"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          size="sm"
          className="flex-1 font-semibold transition-all duration-300"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Salvar Alterações
        </Button>
        <Button
          onClick={handleDelete}
          disabled={deleting}
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground text-center font-mono">
        {plan.plan_key}
      </p>
    </div>
  );
};

/* ══════════════════════════════════════════════
   NEW PLAN CARD
   ══════════════════════════════════════════════ */
const NewPlanCard = ({
  defaultService,
  onCreate,
}: {
  defaultService: string;
  onCreate: (data: any) => Promise<boolean>;
}) => {
  const [planLabel, setPlanLabel] = useState("");
  const [serviceLabel, setServiceLabel] = useState(defaultService);
  const [price, setPrice] = useState("0");
  const [storeCount, setStoreCount] = useState("1");
  const [features, setFeatures] = useState<string[]>([""]);
  const [included, setIncluded] = useState<string[]>([""]);
  const [buttonLabel, setButtonLabel] = useState("ASSINAR AGORA");
  const [creating, setCreating] = useState(false);

  const generateKey = (label: string, service: string) =>
    `${service}-${label}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase()
      .replace(/^-|-$/g, "");

  const handleCreate = async () => {
    const key = generateKey(planLabel, serviceLabel);
    if (!key || !planLabel.trim()) return;
    setCreating(true);
    const ok = await onCreate({
      plan_key: key,
      plan_label: planLabel.trim(),
      service_label: serviceLabel.trim(),
      price: parseFloat(price) || 0,
      store_count: parseInt(storeCount) || 1,
      ai_audio_limit: 0,
      features: features.filter((f) => f.trim() !== ""),
      included: included.filter((f) => f.trim() !== ""),
      button_label: buttonLabel,
    });
    if (ok) {
      setPlanLabel("");
      setPrice("0");
      setFeatures([""]);
      setIncluded([""]);
    }
    setCreating(false);
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-primary/50 bg-card/50 p-5 space-y-4">
      <p className="text-xs font-semibold text-primary uppercase tracking-wide text-center">
        + Novo Plano
      </p>

      {/* Nome do Plano */}
      <div className="space-y-1">
        <EditableText
          value={planLabel}
          onChange={setPlanLabel}
          className="text-lg font-bold text-foreground"
          placeholder="Nome do Plano"
        />
        {planLabel.trim() && (
          <p className="text-[10px] font-mono text-muted-foreground">
            {generateKey(planLabel, serviceLabel)}
          </p>
        )}
      </div>

      {/* Preço e Lojas */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Preço mensal
          </label>
          <div className="flex items-baseline gap-1">
            <span className="text-sm text-muted-foreground">R$</span>
            <EditableText
              value={price}
              onChange={setPrice}
              type="number"
              className="text-xl font-extrabold text-primary w-20"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Store className="h-3 w-3" /> Lojas
          </label>
          <EditableText
            value={storeCount}
            onChange={setStoreCount}
            type="number"
            className="text-xl font-extrabold text-foreground w-16"
          />
        </div>
      </div>

      {/* Serviço */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Layers className="h-3 w-3" /> Serviço
        </label>
        <EditableText value={serviceLabel} onChange={setServiceLabel} className="text-sm text-foreground" placeholder="Ex: Rádio Interna" />
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Vantagens
        </p>
        <div className="grid gap-1.5">
          {features.map((f, i) => (
            <EditableListItem
              key={i}
              value={f}
              onChange={(v) => {
                const n = [...features];
                n[i] = v;
                setFeatures(n);
              }}
              onRemove={() => setFeatures(features.filter((_, j) => j !== i))}
            />
          ))}
          <button
            onClick={() => setFeatures([...features, ""])}
            className="flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors mt-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar benefício
          </button>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Funções incluídas
        </p>
        <div className="grid gap-1">
          {included.map((f, i) => (
            <EditableListItem
              key={i}
              value={f}
              onChange={(v) => {
                const n = [...included];
                n[i] = v;
                setIncluded(n);
              }}
              onRemove={() => setIncluded(included.filter((_, j) => j !== i))}
            />
          ))}
          <button
            onClick={() => setIncluded([...included, ""])}
            className="flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors mt-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar função
          </button>
        </div>
      </div>

      <div className="w-full h-12 text-base font-bold rounded-lg border-2 border-primary bg-primary text-primary-foreground flex items-center justify-center">
        <input
          value={buttonLabel}
          onChange={(e) => setButtonLabel(e.target.value)}
          className="bg-transparent text-center w-full h-full font-bold text-base outline-none text-primary-foreground placeholder:text-primary-foreground/50"
          placeholder="Texto do botão"
        />
      </div>

      <Button
        onClick={handleCreate}
        disabled={creating || !planLabel.trim()}
        className="w-full font-semibold"
      >
        {creating ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Plus className="h-4 w-4 mr-1" />
        )}
        Criar Plano
      </Button>
    </div>
  );
};

/* ══════════════════════════════════════════════
   SERVICE GROUP  –  collapsible section per service
   ══════════════════════════════════════════════ */
const ServiceGroup = ({
  serviceLabel,
  plans,
  onSave,
  onDelete,
  onCreate,
}: {
  serviceLabel: string;
  plans: ServicePlan[];
  onSave: (id: string, updates: Partial<ServicePlan>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onCreate: (data: any) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState(true);
  const activeCount = plans.filter((p) => p.is_active).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="bg-card rounded-xl">
      <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 rounded-t-xl transition-colors">
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 text-primary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-primary" />
          )}
          <h4 className="text-sm font-bold text-foreground uppercase tracking-wide">
            {serviceLabel}
          </h4>
          <span className="text-xs text-muted-foreground">
            {plans.length} plano{plans.length !== 1 ? "s" : ""} · {activeCount} ativo{activeCount !== 1 ? "s" : ""}
          </span>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans
            .sort((a, b) => a.price - b.price)
            .map((plan) => (
              <VisualPlanCard key={plan.id} plan={plan} onSave={onSave} onDelete={onDelete} />
            ))}
          <NewPlanCard defaultService={serviceLabel} onCreate={onCreate} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/* ══════════════════════════════════════════════
   SERVICE SELECTOR ICONS
   ══════════════════════════════════════════════ */
import {
  Radio,
  Tv,
  Calculator,
  Globe,
  ShoppingCart,
  Music,
  ArrowLeft,
} from "lucide-react";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  "Rádio Interna": <Radio className="h-6 w-6" />,
  "TV Indoor": <Tv className="h-6 w-6" />,
  "Controle de Caixa": <Calculator className="h-6 w-6" />,
  "Rádio Web": <Globe className="h-6 w-6" />,
  "Comprar Spot": <ShoppingCart className="h-6 w-6" />,
  "Comprar Jingle": <Music className="h-6 w-6" />,
};

const DEFAULT_SERVICES = [
  "Rádio Interna",
  "TV Indoor",
  "Controle de Caixa",
  "Rádio Web",
  "Comprar Spot",
  "Comprar Jingle",
];

/* ══════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════ */
const PlanManagement = () => {
  const { plans, loading, updatePlan, createPlan, deletePlan } = useServicePlans();
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [deletingService, setDeletingService] = useState<string | null>(null);

  /* group plans by service_label */
  const grouped = useMemo(() => {
    const map = new Map<string, ServicePlan[]>();
    for (const p of plans) {
      const key = p.service_label || "Sem Categoria";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [plans]);

  /* all known services (from DB + defaults) */
  const allServices = useMemo(() => {
    const set = new Set(DEFAULT_SERVICES);
    grouped.forEach(([label]) => set.add(label));
    return Array.from(set);
  }, [grouped]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const handleCreateNewServicePlan = async () => {
    if (!newServiceName.trim()) return;
    const key = newServiceName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const ok = await createPlan({
      plan_key: `${key}-start`,
      plan_label: "Start",
      service_label: newServiceName.trim(),
      price: 0,
      ai_audio_limit: 30,
      store_count: 1,
      features: ["Benefício 1"],
      included: ["Função 1"],
      button_label: "ASSINAR AGORA",
    });
    if (ok) {
      setNewServiceName("");
      setShowNewService(false);
      setSelectedService(newServiceName.trim());
    }
  };

  const handleDeleteService = async (serviceName: string) => {
    if (!confirm(`Excluir o serviço "${serviceName}" e todos os seus planos?`)) return;
    setDeletingService(serviceName);
    const servicePlansToDelete = plans.filter((p) => p.service_label === serviceName);
    for (const p of servicePlansToDelete) {
      await deletePlan(p.id);
    }
    setDeletingService(null);
  };

  if (!selectedService) {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Gestão de Planos & Serviços
            </h3>
            <Button
              size="sm"
              onClick={() => setShowNewService(!showNewService)}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Novo Serviço
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-6">Alterar planos de qual serviço?</p>

          {showNewService && (
            <div className="flex items-center gap-3 mb-6 p-3 rounded-lg border border-dashed border-primary/50 bg-secondary/20">
              <input
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                placeholder="Nome do novo serviço (ex: TV Indoor)"
                className="flex-1 bg-transparent border-b-2 border-dashed border-primary/40 focus:border-primary outline-none text-sm text-foreground"
              />
              <Button size="sm" onClick={handleCreateNewServicePlan} disabled={!newServiceName.trim()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Criar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewService(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allServices.map((service) => {
              const servicePlans = grouped.find(([l]) => l === service)?.[1] || [];
              const activeCount = servicePlans.filter((p) => p.is_active).length;
              return (
                <div key={service} className="relative group/card">
                  <button
                    onClick={() => setSelectedService(service)}
                    className="w-full flex flex-col items-center gap-3 p-5 rounded-xl bg-card hover:shadow-[0_0_20px_hsl(var(--primary)/0.4)] transition-all duration-[600ms] service-selector-btn"
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
                      {SERVICE_ICONS[service] || <Package className="h-6 w-6" />}
                    </div>
                    <span className="text-sm font-semibold text-foreground">{service}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {servicePlans.length} plano{servicePlans.length !== 1 ? "s" : ""} · {activeCount} ativo
                      {activeCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteService(service); }}
                    disabled={deletingService === service}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-destructive/80 text-destructive-foreground opacity-0 group-hover/card:opacity-100 hover:bg-destructive transition-all"
                    title="Excluir serviço"
                  >
                    {deletingService === service ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const filteredPlans = plans.filter((p) => p.service_label === selectedService);

  return (
    <div className="space-y-4 animate-in fade-in duration-[600ms]">
      <div className="bg-card rounded-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedService(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {SERVICE_ICONS[selectedService] || <Package className="h-4 w-4" />}
          </div>
          <h3 className="text-base font-semibold text-foreground">{selectedService}</h3>
          <span className="text-xs text-muted-foreground">
            {filteredPlans.length} plano{filteredPlans.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-sm text-muted-foreground ml-[4.5rem]">
          Edite diretamente sobre os cards — as alterações refletem na página de vendas.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredPlans
          .sort((a, b) => a.price - b.price)
          .map((plan) => (
            <VisualPlanCard key={plan.id} plan={plan} onSave={updatePlan} onDelete={deletePlan} />
          ))}
        <NewPlanCard defaultService={selectedService} onCreate={createPlan} />
      </div>

      {filteredPlans.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhum plano para este serviço. Use o card "Novo Plano" para criar.
        </div>
      )}
    </div>
  );
};

export default PlanManagement;