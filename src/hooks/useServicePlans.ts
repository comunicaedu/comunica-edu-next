"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ServicePlan {
  id: string;
  plan_key: string;
  service_label: string;
  plan_label: string;
  price: number;
  ai_audio_limit: number;
  store_count: number;
  features: string[];
  included: string[];
  is_active: boolean;
  updated_at: string;
  button_label: string;
}

const normalizePlan = (plan: any): ServicePlan => ({
  ...plan,
  price: Number(plan?.price ?? 0),
  ai_audio_limit: Number(plan?.ai_audio_limit ?? 0),
  store_count: Number(plan?.store_count ?? 1),
  features: Array.isArray(plan?.features) ? plan.features.map(String) : [],
  included: Array.isArray(plan?.included) ? plan.included.map(String) : [],
  button_label: plan?.button_label || "ASSINAR AGORA",
});

export function useServicePlans() {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchPlans = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (showLoading) setLoading(true);

    const { data, error } = await supabase
      .from("service_plans")
      .select("*")
      .order("price", { ascending: true });

    if (error) {
      console.error("Error fetching plans:", error);
      toast({ title: "Erro ao carregar planos", description: error.message, variant: "destructive" });
    } else {
      setPlans((data || []).map(normalizePlan));
    }

    if (showLoading) setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const updatePlan = async (id: string, updates: Partial<Omit<ServicePlan, "id" | "plan_key">>) => {
    const { data, error } = await supabase
      .from("service_plans")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return false;
    }

    if (!data) {
      toast({ title: "Sem permissão para salvar", description: "Não foi possível atualizar este plano.", variant: "destructive" });
      return false;
    }

    setPlans((prev) => prev.map((plan) => (plan.id === id ? normalizePlan(data) : plan)));
    toast({ title: "Plano atualizado com sucesso!" });
    return true;
  };

  const createPlan = async (planData: {
    plan_key: string;
    plan_label: string;
    service_label: string;
    price: number;
    ai_audio_limit: number;
    store_count: number;
    features: string[];
    included: string[];
    button_label: string;
  }) => {
    const { data, error } = await supabase.from("service_plans").insert(planData).select("*").maybeSingle();

    if (error) {
      toast({ title: "Erro ao criar plano", description: error.message, variant: "destructive" });
      return false;
    }

    if (!data) {
      toast({ title: "Sem permissão para criar", description: "Não foi possível criar este plano.", variant: "destructive" });
      return false;
    }

    const newPlan = normalizePlan(data);
    setPlans((prev) => [...prev, newPlan].sort((a, b) => a.price - b.price));
    toast({ title: "Novo plano criado com sucesso!" });
    return true;
  };

  const deletePlan = async (id: string) => {
    const { data, error } = await supabase
      .from("service_plans")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return false;
    }

    if (!data) {
      toast({ title: "Sem permissão para excluir", description: "Não foi possível excluir este plano.", variant: "destructive" });
      return false;
    }

    setPlans((prev) => prev.filter((plan) => plan.id !== id));
    toast({ title: "Plano excluído!" });
    return true;
  };

  return { plans, loading, fetchPlans, updatePlan, createPlan, deletePlan };
}
