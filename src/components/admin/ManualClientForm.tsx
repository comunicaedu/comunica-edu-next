"use client";

import { useState, useRef } from "react";
import { UserPlus, Loader2, Eye, EyeOff, ImagePlus, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServicePlans } from "@/hooks/useServicePlans";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import { isValidCNPJ } from "@/lib/cpfCnpjValidation";
import { ALL_CLIENT_FEATURES } from "@/hooks/useClientFeatures";
import { convertToPng } from "@/lib/logoUtils";

const formatCNPJ = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const formatPhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const formatCEP = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};

const ManualClientForm = ({ onSuccess }: { onSuccess?: (userId: string) => void }) => {
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedService, setSelectedService] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [aiVinhetasLimit, setAiVinhetasLimit] = useState<number>(30);
  const [notaFiscal, setNotaFiscal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Address
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [complemento, setComplemento] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  // Logo
  const [logo, setLogo] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { plans } = useServicePlans();
  const { toast } = useToast();

  const [featureToggles, setFeatureToggles] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    ALL_CLIENT_FEATURES.forEach((f) => { initial[f.key] = false; });
    return initial;
  });

  const [featureLimits] = useState<Record<string, number>>({});

  const activePlans = plans.filter((p) => p.is_active);

  // Default services that are always available + any from the database
  const DEFAULT_SERVICES = [
    "Rádio Interna",
    "TV Interna",
    "Rádio Web",
    "Comprar Spots",
    "Comprar Jingle",
  ];
  const dbServiceLabels = activePlans.map((p) => p.service_label).filter(Boolean);
  const serviceLabels = [...new Set([...DEFAULT_SERVICES, ...dbServiceLabels])];

  // Filter plans by selected service
  const filteredPlans = selectedService
    ? activePlans.filter((p) => p.service_label === selectedService)
    : activePlans;

  // When service changes, reset plan and adjust features based on the plan's included features
  const handleServiceChange = (service: string) => {
    setSelectedService(service);
    setSelectedPlan("");
  };

  // When plan changes, auto-adjust features based on plan data
  const handlePlanChange = (planId: string) => {
    setSelectedPlan(planId);
    const plan = activePlans.find((p) => p.id === planId);
    if (plan) {
      setAiVinhetasLimit(plan.ai_audio_limit || 30);
    }
  };

  const toggleFeature = (key: string) => {
    setFeatureToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // CEP lookup
  const lookupCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        if (data.logradouro) setRua(data.logradouro);
        if (data.bairro) setBairro(data.bairro);
        if (data.localidade) setCidade(data.localidade);
      }
    } catch {
      // silently ignore
    }
    setCepLoading(false);
  };

  const handleCepChange = (v: string) => {
    const formatted = formatCEP(v);
    setCep(formatted);
    const digits = v.replace(/\D/g, "");
    if (digits.length === 8) lookupCEP(digits);
  };

  // Logo upload
  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Selecione uma imagem válida", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagem muito grande (máx. 5MB)", variant: "destructive" });
      return;
    }
    setLogoLoading(true);
    try {
      const pngDataUrl = await convertToPng(file);
      setLogo(pngDataUrl);
    } catch {
      toast({ title: "Erro ao processar imagem", variant: "destructive" });
    }
    setLogoLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!usuario.trim() || !senha.trim()) {
      toast({ title: "Usuário e senha são obrigatórios", variant: "destructive" });
      return;
    }

    if (usuario.length > 6) {
      toast({ title: "Usuário deve ter no máximo 6 caracteres", variant: "destructive" });
      return;
    }

    if (senha.length > 5) {
      toast({ title: "Senha deve ter no máximo 5 caracteres", variant: "destructive" });
      return;
    }

    const rawCnpj = cnpj.replace(/\D/g, "");
    if (rawCnpj && !isValidCNPJ(rawCnpj)) {
      toast({ title: "CNPJ inválido", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      // 1. Create auth user via admin API (MUST be first — we need the userId)
      const storeToken = useSessionStore.getState().token;
      const res = await fetch("/api/auth/create-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(storeToken ? { Authorization: `Bearer ${storeToken}` } : {}),
        },
        body: JSON.stringify({
          username: usuario.trim().toLowerCase(),
          password: senha,
          profile: {
            nome: nome.trim() || null,
            telefone: telefone || null,
            cidade: cidade || null,
            cep: cep.replace(/\D/g, "") || null,
            rua: rua || null,
            numero: numero || null,
            bairro: bairro || null,
            complemento: complemento || null,
            notaFiscal,
          },
        }),
      });
      const resText = await res.text();
      let resData: any = {};
      try { resData = JSON.parse(resText); } catch { resData = {}; }
      console.log("create-client →", res.status, resText);

      if (!res.ok || !resData.userId) {
        toast({ title: resData.error || `Erro ${res.status}: ${resText}` , variant: "destructive" });
        setSaving(false);
        return;
      }

      const userId = resData.userId;

      // 2. Create Asaas customer — só se nome e CNPJ foram preenchidos
      if (nome.trim() && rawCnpj) {
        try {
          await supabase.functions.invoke("create-asaas-customer", {
            body: {
              nome: nome.trim(),
              telefone: telefone.replace(/\D/g, "") || undefined,
              cpfCnpj: rawCnpj,
            },
          });
        } catch {
          // Asaas indisponível — continua mesmo assim
        }
      }

      // 3. Save feature toggles + AI vinhetas limit
      const featureRows = ALL_CLIENT_FEATURES.map((f) => ({
        user_id: userId,
        feature_key: f.key,
        enabled: featureToggles[f.key] ?? true,
        limit_value: null,
      }));

      const featToken = useSessionStore.getState().token;
      await fetch("/api/admin/save-client-features", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(featToken ? { Authorization: `Bearer ${featToken}` } : {}),
        },
        body: JSON.stringify({
          userId,
          features: featureRows,
          aiVinhetasLimit,
        }),
      });

      // 4. Upload logo como avatar se fornecido
      if (logo) {
        try {
          const logoRes = await fetch(logo);
          const logoBlob = await logoRes.blob();
          const logoFile = new File([logoBlob], "avatar.png", { type: logoBlob.type || "image/png" });

          const uploadToken = useSessionStore.getState().token;

          const form = new FormData();
          form.append("clientId", userId);
          form.append("file", logoFile);

          await fetch("/api/admin/upload-client-avatar", {
            method: "POST",
            headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {},
            body: form,
          });
        } catch {
          // Avatar opcional — não bloqueia o cadastro
        }
      }

      toast({ title: "Cliente cadastrado com sucesso!" });
      onSuccess?.(userId);

      // Reset form
      setNome(""); setCnpj(""); setTelefone(""); setSenha(""); setUsuario("");
      setSelectedService(""); setSelectedPlan(""); setAiVinhetasLimit(30); setNotaFiscal(false);
      setCep(""); setRua(""); setNumero(""); setBairro(""); setCidade(""); setComplemento("");
      setLogo(null);
      const reset: Record<string, boolean> = {};
      ALL_CLIENT_FEATURES.forEach((f) => { reset[f.key] = false; });
      setFeatureToggles(reset);
    } catch (err: any) {
      toast({ title: "Erro ao cadastrar", description: err?.message || "Tente novamente", variant: "destructive" });
    }

    setSaving(false);
  };

  return (
    <div className="bg-card rounded-xl p-6">
      <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-primary" />
        Cadastro Manual de Cliente
      </h3>
      <p className="text-sm text-muted-foreground mb-5">
        Insira os dados do novo cliente. O registro será criado automaticamente no gateway de pagamento.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
        {/* Dados de contato */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome / Razão Social *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo ou razão social" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cnpj">CNPJ *</Label>
            <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(formatCNPJ(e.target.value))} placeholder="00.000.000/0000-00" maxLength={18} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="usuario">Usuário *</Label>
            <Input id="usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Digite seu usuário" maxLength={6} autoComplete="off" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha *</Label>
            <div className="relative">
              <Input
                id="senha"
                type={showPassword ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Digite sua senha"
                maxLength={5}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="telefone">Telefone</Label>
            <Input id="telefone" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} placeholder="(00) 00000-0000" maxLength={15} />
          </div>

          {/* Nota Fiscal */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/20">
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="nota-fiscal" className="font-semibold text-sm cursor-pointer">Deseja receber Nota Fiscal?</Label>
                <Switch
                  id="nota-fiscal"
                  checked={notaFiscal}
                  onCheckedChange={(checked) => setNotaFiscal(checked)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Ao ativar, o endereço será usado para emissão de NF
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="servico">Serviço *</Label>
            <Select value={selectedService} onValueChange={handleServiceChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o serviço" />
              </SelectTrigger>
              <SelectContent>
                {serviceLabels.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan">Plano Inicial</Label>
            <Select value={selectedPlan} onValueChange={handlePlanChange} disabled={!selectedService}>
              <SelectTrigger>
                <SelectValue placeholder={selectedService ? "Selecione um plano" : "Selecione um serviço primeiro"} />
              </SelectTrigger>
              <SelectContent>
                {filteredPlans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.plan_label} (R$ {p.price.toFixed(2)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Logo */}
        <div className="rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Logo do Cliente</h4>
          <div className="flex items-center gap-4">
            {logo ? (
              <div className="relative">
                <img src={logo} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-border bg-secondary/20" />
                <button
                  type="button"
                  title="Remover logo"
                  onClick={() => setLogo(null)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-secondary/20">
                {logoLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
            )}
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" title="Selecionar logo" className="hidden" onChange={handleLogoFile} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                {logo ? "Trocar logo" : "Enviar logo"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG até 5MB</p>
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Endereço</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cep">CEP</Label>
              <div className="relative">
                <Input id="cep" value={cep} onChange={(e) => handleCepChange(e.target.value)} placeholder="00000-000" maxLength={9} />
                {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cidade">Cidade</Label>
              <Input id="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rua">Rua</Label>
            <Input id="rua" value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua / Logradouro" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="numero">Número</Label>
              <Input id="numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bairro">Bairro</Label>
              <Input id="bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="complemento">Complemento</Label>
              <Input id="complemento" value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="Apto, sala..." />
            </div>
          </div>
        </div>

        {/* Recursos Liberados */}
        <div className="rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Recursos Liberados</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Ative ou desative os recursos disponíveis para este cliente.
          </p>
          <div className="grid gap-2">
            {ALL_CLIENT_FEATURES.map((feat) => (
              <div key={feat.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-secondary/20">
                  <span className="text-sm text-foreground">{feat.label}</span>
                  <Switch
                    checked={featureToggles[feat.key] ?? false}
                    onCheckedChange={() => toggleFeature(feat.key)}
                  />
                </div>
                {(feat.key === "player_espelho" || feat.key === "player_independente") && (
                  <div className="ml-[72px] flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/10 border border-border/40">
                    <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Gerar link do player flutuante
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

        </div>

        <Button type="submit" disabled={saving} className="w-full font-semibold">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
          Cadastrar Cliente
        </Button>
      </form>
    </div>
  );
};

export default ManualClientForm;