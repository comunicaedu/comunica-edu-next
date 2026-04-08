"use client";

import { forwardRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Radio, Tv, Globe, Volume2, Music, ArrowLeft, Loader2, Package } from "lucide-react";
import { useServicePlans, ServicePlan } from "@/hooks/useServicePlans";

type PlanSelection = {
  planId: string;
  serviceId: string;
  isTrial?: boolean;
};

interface PlansModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  embedded?: boolean;
  onClose?: () => void;
  onNavigateCadastro?: (selection?: PlanSelection) => void;
}

const SERVICE_ICONS: Record<string, typeof Radio> = {
  "Rádio Interna": Radio,
  "TV Indoor": Tv,
  "TV Interna": Tv,
  "Rádio Web": Globe,
  "Comprar Spots": Volume2,
  "Comprar Spot": Volume2,
  "Comprar Jingle": Music,
};

const SERVICE_DESCS: Record<string, string> = {
  "Rádio Interna": "Música ambiente e anúncios para sua loja",
  "TV Indoor": "Conteúdo visual para telas da sua loja",
  "TV Interna": "Conteúdo visual para telas da sua loja",
  "Rádio Web": "Sua rádio online na internet",
  "Comprar Spots": "Spots profissionais para sua rádio",
  "Comprar Spot": "Spots profissionais para sua rádio",
  "Comprar Jingle": "Jingles exclusivos para sua marca",
};

const normalizeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const PLAN_STORAGE_KEY = "selected_plan";
const PLAN_UNLOCK_KEY = "cadastro_plan_unlock";

const TRANSITION_MS = 0.6;
const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};
const transition = { duration: TRANSITION_MS, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

const PlanCard = forwardRef<HTMLDivElement, {
  plan: ServicePlan;
  onAssinar: (planKey: string, label: string, price: number) => void;
}>(({ plan, onAssinar }, ref) => {
  const features = plan.features as string[];
  const included = plan.included as string[];

  return (
    <div ref={ref} className="rounded-xl border-2 border-primary bg-card p-5 space-y-4 transition-shadow duration-[600ms] hover:shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-foreground">{plan.plan_label}</h3>
          {plan.store_count > 1 && (
            <p className="text-xs text-muted-foreground">
              {plan.store_count} lojas · R$ {(plan.price / plan.store_count).toFixed(0)}/loja
            </p>
          )}
        </div>
        <span className="text-lg font-extrabold text-primary">
          R$ {plan.price.toFixed(2).replace(".", ",")}
          <span className="text-xs font-normal text-muted-foreground">/mês</span>
        </span>
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vantagens</p>
        <div className="grid gap-1.5">
          {features.map((f, index) => (
            <div key={`${plan.id}-feature-${index}`} className="flex items-start gap-2 text-sm text-foreground">
              <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>

      {included.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Funções incluídas</p>
          <div className="grid gap-1">
            {included.map((f, index) => (
              <div key={`${plan.id}-included-${index}`} className="flex items-center gap-2 text-sm text-foreground">
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />{f}
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        onClick={() => onAssinar(plan.plan_key, plan.plan_label, plan.price)}
        className="w-full h-12 text-base font-bold rounded-lg border-2 border-primary transition-shadow duration-[600ms] hover:shadow-[0_0_16px_hsl(var(--primary)/0.3)]"
      >
        {plan.button_label || "ASSINAR AGORA"}
      </Button>
    </div>
  );
});

PlanCard.displayName = "PlanCard";

const PlansContent = forwardRef<HTMLDivElement, { onClose?: () => void; onNavigateCadastro?: (selection?: PlanSelection) => void }>(
  ({ onClose, onNavigateCadastro }, ref) => {
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const { plans, loading } = useServicePlans();

    const DEFAULT_SERVICES = [
      "Rádio Interna",
      "TV Indoor",
      "Controle de Caixa",
      "Rádio Web",
      "Comprar Spots",
      "Comprar Jingle",
    ];

    /* Build service list: DB services + defaults */
    const dynamicServices = useMemo(() => {
      const set = new Set(DEFAULT_SERVICES);
      for (const p of plans) {
        if (p.is_active) set.add(p.service_label);
      }
      return Array.from(set);
    }, [plans]);

    const handleAssinar = (planKey: string, plano: string, valor: number) => {
      if (!selectedService) return;
      const serviceId = normalizeKey(selectedService);
      const selectedPlan = { id: planKey, serviceId, plano, valor };
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(selectedPlan));
      sessionStorage.setItem(
        PLAN_UNLOCK_KEY,
        JSON.stringify({ planId: planKey, serviceId, at: Date.now() })
      );
      onNavigateCadastro?.({ planId: planKey, serviceId });
    };

    const servicePlans = selectedService
      ? plans.filter((plan) => plan.is_active && plan.service_label === selectedService)
        .sort((a, b) => a.price - b.price)
      : [];

    return (
      <div ref={ref} className="min-h-[520px] sm:min-h-[560px] [scrollbar-gutter:stable]">
        <AnimatePresence mode="wait">
          {!selectedService && (
            <motion.div
              key="services"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="p-6 space-y-5"
            >
              <h2 className="text-xl font-bold text-foreground">Serviços</h2>
              <p className="text-sm text-muted-foreground">Selecione o serviço desejado:</p>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : dynamicServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum serviço disponível no momento.</p>
              ) : (
                <div className="grid gap-2">
                  {dynamicServices.map((label) => {
                    const Icon = SERVICE_ICONS[label] || Package;
                    const desc = SERVICE_DESCS[label] || "Serviço disponível";
                    return (
                      <button
                        key={label}
                        onClick={() => setSelectedService(label)}
                        className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-primary/5 transition-all text-left"
                      >
                        <Icon className="h-5 w-5 text-primary shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {selectedService && (
            <motion.div
              key={selectedService}
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="p-6 space-y-5"
            >
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedService(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h2 className="text-xl font-bold text-foreground">{selectedService}</h2>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : servicePlans.length === 0 ? (
                <div className="text-center py-8">
                  <a
                    href={`https://wa.me/5591984255650?text=${encodeURIComponent(`Olá! Quero solicitar um orçamento para o serviço: ${selectedService}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button className="w-full h-12 text-base font-bold rounded-lg border-2 border-primary transition-shadow duration-[600ms] hover:shadow-[0_0_16px_hsl(var(--primary)/0.3)]">
                      Solicitar Orçamento
                    </Button>
                  </a>
                </div>
              ) : (
                servicePlans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} onAssinar={handleAssinar} />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
);

PlansContent.displayName = "PlansContent";

const PlansModal = ({ open, onOpenChange, embedded, onClose, onNavigateCadastro }: PlansModalProps) => {
  if (embedded) {
    return <PlansContent onClose={onClose} onNavigateCadastro={onNavigateCadastro} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto scrollbar-none [scrollbar-gutter:stable] touch-pan-y p-0 gap-0 bg-card border-border">
        <DialogTitle className="sr-only">Serviços</DialogTitle>
        <PlansContent onClose={() => onOpenChange?.(false)} onNavigateCadastro={onNavigateCadastro} />
      </DialogContent>
    </Dialog>
  );
};

export default PlansModal;