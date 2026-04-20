"use client";

import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { User, Lock, Eye, EyeOff, CreditCard, Mail, Phone, MapPin, Home, Hash, CalendarDays, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ComunicaEduLogo from "@/components/ComunicaEduLogo";
import LogoUpload from "@/components/LogoUpload";
import PaymentSection from "@/components/PaymentSection";
import { toast } from "sonner";
import { isValidDocument } from "@/lib/cpfCnpjValidation";
import { isValidPhone, formatPhone } from "@/lib/phoneValidation";

const formatCPF = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

const formatCNPJ = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const formatCEP = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
};

const NUMPAD_KEY_TO_DIGIT: Record<string, string> = {
  Numpad0: "0",
  Numpad1: "1",
  Numpad2: "2",
  Numpad3: "3",
  Numpad4: "4",
  Numpad5: "5",
  Numpad6: "6",
  Numpad7: "7",
  Numpad8: "8",
  Numpad9: "9",
};

interface CadastroFormProps {
  onBack: () => void;
  onNavigatePlanos?: () => void;
}

const PLAN_STORAGE_KEY = "selected_plan";
const PLAN_UNLOCK_KEY = "cadastro_plan_unlock";
const PLAN_UNLOCK_MAX_AGE_MS = 30 * 60 * 1000;

type StoredPlan = {
  id?: string;
  planId?: string;
  serviceId?: string;
  service?: string;
};

const CadastroForm = ({ onBack, onNavigatePlanos }: CadastroFormProps) => {
  const lastGuardToastAt = useRef(0);

  const [userLogo, setUserLogo] = useState<string | null>(() => typeof window !== 'undefined' ? localStorage.getItem("user-logo") : null);

  const handleLogoChange = async (pngDataUrl: string | null) => {
    setUserLogo(pngDataUrl);
    if (pngDataUrl) {
      localStorage.setItem("user-logo", pngDataUrl);
      // Cores serão aplicadas apenas dentro do painel do usuário (Player)
    } else {
      localStorage.removeItem("user-logo");
    }
  };
  const hasPlanSelected = useCallback(() => {
    try {
      const planRaw = localStorage.getItem(PLAN_STORAGE_KEY);
      const unlockRaw = sessionStorage.getItem(PLAN_UNLOCK_KEY);
      if (!planRaw || !unlockRaw) return false;

      const plan = JSON.parse(planRaw) as StoredPlan;
      const unlock = JSON.parse(unlockRaw) as { planId?: string; serviceId?: string; at?: number };

      const planId = plan.id ?? plan.planId;
      const serviceId = plan.serviceId ?? plan.service;
      if (!planId || !serviceId) return false;
      if (unlock.planId !== planId || unlock.serviceId !== serviceId) return false;
      if (!unlock.at || Date.now() - unlock.at > PLAN_UNLOCK_MAX_AGE_MS) return false;

      return true;
    } catch {
      return false;
    }
  }, []);

  const redirectToPlans = useCallback(() => {
    const now = Date.now();
    if (now - lastGuardToastAt.current > 1200) {
      toast.info("Para continuar, escolha primeiro o serviço e o plano desejado.");
      lastGuardToastAt.current = now;
    }
    onNavigatePlanos?.();
  }, [onNavigatePlanos]);

  const [showPassword, setShowPassword] = useState(false);
  const [sendNotifications, setSendNotifications] = useState(true);
  const [wantsNotaFiscal, setWantsNotaFiscal] = useState(false);
  const [dueDay, setDueDay] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    nome: "", cpfCnpj: "", email: "", telefone: "", empresa: "", usuario: "", senha: "",
    cep: "", cidade: "", estado: "", numero: "", complemento: "", rua: "", bairro: "",
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");

  // Document validation state
  const [docError, setDocError] = useState("");
  const [docValid, setDocValid] = useState(false);

  // Phone validation state
  const [phoneError, setPhoneError] = useState("");
  const [phoneValid, setPhoneValid] = useState(false);
  const [phoneType, setPhoneType] = useState<string | null>(null);

  // Real-time document validation
  useEffect(() => {
    const digits = form.cpfCnpj.replace(/\D/g, "");
    if (digits.length === 0) {
      setDocError("");
      setDocValid(false);
      return;
    }
    if (digits.length < 11 || (digits.length > 11 && digits.length < 14)) {
      setDocError("");
      setDocValid(false);
      return;
    }
    const result = isValidDocument(digits);
    if (!result.valid) {
      setDocError(result.error || "Documento Inválido");
      setDocValid(false);
    } else {
      setDocError("");
      setDocValid(true);
    }
  }, [form.cpfCnpj]);

  // Real-time phone validation
  useEffect(() => {
    const digits = form.telefone.replace(/\D/g, "");
    if (digits.length === 0) {
      setPhoneError("");
      setPhoneValid(false);
      setPhoneType(null);
      return;
    }
    if (digits.length < 10) {
      setPhoneError("");
      setPhoneValid(false);
      setPhoneType(null);
      return;
    }
    const result = isValidPhone(digits);
    if (!result.valid) {
      setPhoneError(result.error || "Telefone inválido");
      setPhoneValid(false);
      setPhoneType(result.type);
    } else {
      setPhoneError("");
      setPhoneValid(true);
      setPhoneType(result.type);
    }
  }, [form.telefone]);

  const lookupCEP = useCallback(async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    setCepError("");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      setCepLoading(false);
      if (!res.ok || data?.erro) {
        setCepError("CEP não encontrado");
        return;
      }
      setForm((prev) => ({
        ...prev,
        cidade: data.localidade || prev.cidade,
        estado: data.uf || prev.estado,
        rua: data.logradouro || prev.rua,
        bairro: data.bairro || prev.bairro,
      }));
      setCepError("");
    } catch {
      setCepLoading(false);
      setCepError("Erro ao buscar CEP");
    }
  }, []);

  const handleChange = (field: string, value: string) => {
    if (field === "cpfCnpj") {
      const digits = value.replace(/\D/g, "");
      value = digits.length <= 11 ? formatCPF(digits) : formatCNPJ(digits);
    }
    if (field === "telefone") value = formatPhone(value);
    if (field === "cep") {
      value = formatCEP(value);
      setCepError("");
      const cepDigits = value.replace(/\D/g, "");
      if (cepDigits.length === 8) {
        void lookupCEP(cepDigits);
      }
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleNumericInputKeyDown = (field: keyof typeof form) => (e: KeyboardEvent<HTMLInputElement>) => {
    const mappedDigit = NUMPAD_KEY_TO_DIGIT[e.code];
    if (!mappedDigit || /^\d$/.test(e.key)) return;

    e.preventDefault();

    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextValue = `${input.value.slice(0, start)}${mappedDigit}${input.value.slice(end)}`;

    handleChange(field, nextValue);

    requestAnimationFrame(() => {
      const cursorPosition = start + 1;
      input.setSelectionRange(cursorPosition, cursorPosition);
    });
  };

  const handleCepBlur = () => {
    const digits = form.cep.replace(/\D/g, "");
    if (digits.length === 8) {
      void lookupCEP(digits);
    } else if (digits.length > 0 && digits.length < 8) {
      setCepError("CEP incompleto");
    }
  };

  const isFieldError = (field: keyof typeof form) => submitted && !form[field]?.trim();

  const REQUIRED_FIELDS = ["nome", "email", "usuario", "senha", "cpfCnpj", "telefone", "cep", "rua", "numero", "bairro", "cidade"] as const;

  const FIELD_LABELS: Record<string, string> = {
    nome: "Nome completo", email: "E-mail", usuario: "Usuário", senha: "Senha",
    cpfCnpj: "CPF ou CNPJ", telefone: "Telefone", cep: "CEP", rua: "Rua / Logradouro",
    numero: "Número", bairro: "Bairro", cidade: "Cidade",
  };

  const isFormReady = () => {
    if (REQUIRED_FIELDS.some((f) => !form[f]?.trim())) return false;
    if (!docValid || !phoneValid) return false;
    if (cepError) return false;
    return true;
  };

  const handleTryPay = () => {
    setSubmitted(true);
    if (!docValid) { toast.error("CPF ou CNPJ inválido. Corrija antes de continuar."); return false; }
    if (!phoneValid) { toast.error("Telefone inválido. Corrija antes de continuar."); return false; }
    if (cepError) { toast.error("CEP inválido. Corrija antes de continuar."); return false; }
    const missingFields = REQUIRED_FIELDS.filter((f) => !form[f]?.trim());
    if (missingFields.length > 0) {
      const labels = missingFields.map((f) => FIELD_LABELS[f] || f).join(", ");
      toast.error(`Preencha os campos obrigatórios: ${labels}`);
      return false;
    }
    return true;
  };

  const handlePaymentConfirmed = () => {
    toast.success("Cadastro realizado e pagamento confirmado! Faça login para acessar.");
    onBack();
  };

  const inputError = (field: keyof typeof form) => isFieldError(field) ? "border-destructive" : "border-border";

  const docBorderClass = isFieldError("cpfCnpj") ? "border-destructive" : "border-border";
  const phoneBorderClass = isFieldError("telefone") ? "border-destructive" : "border-border";

  const planSelected = hasPlanSelected();
  const fieldLocked = !planSelected;

  const handleFormOverlayClick = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    redirectToPlans();
  }, [redirectToPlans]);

  return (
    <div className="rounded-xl p-4 sm:p-5 shadow-xl border border-border max-h-[85vh] overflow-y-auto scrollbar-none [scrollbar-gutter:stable] touch-pan-y scroll-smooth transition-all duration-[600ms]" style={{ backgroundColor: 'var(--panel-bg, rgba(92, 92, 92, 0))', backdropFilter: 'var(--panel-blur, blur(0px))', WebkitBackdropFilter: 'var(--panel-blur, blur(0px))' }}>
      <div className="flex justify-center mb-2">
        <ComunicaEduLogo />
      </div>

      <h2 className="text-center text-sm font-semibold text-foreground mb-0.5">Experimente</h2>
      <p className="text-center text-[11px] text-muted-foreground mb-3">Preencha os campos abaixo para criar sua conta</p>

      <div className="relative">
        {fieldLocked && (
          <div
            className="absolute inset-0 z-50 cursor-pointer"
            onPointerDown={handleFormOverlayClick}
            onTouchStart={handleFormOverlayClick}
            onClick={handleFormOverlayClick}
          />
        )}
        <fieldset disabled={fieldLocked} className="space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dados do cliente</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={form.nome} onChange={(e) => handleChange("nome", e.target.value)} placeholder="Nome completo *" className={`pl-8 h-8 text-xs bg-secondary/50 ${inputError("nome")}`} />
            </div>
            {isFieldError("nome") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <div className="relative">
              <CreditCard className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={form.cpfCnpj} onChange={(e) => handleChange("cpfCnpj", e.target.value)} onKeyDown={handleNumericInputKeyDown("cpfCnpj")} placeholder="CPF ou CNPJ *" className={`pl-8 h-8 text-xs bg-secondary/50 ${docBorderClass}`} />
            </div>
            {docError && <p className="text-[10px] text-muted-foreground mt-0.5">{docError}</p>}
            {!docError && isFieldError("cpfCnpj") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} placeholder="E-mail *" className={`pl-8 h-8 text-xs bg-secondary/50 ${inputError("email")}`} />
            </div>
            {isFieldError("email") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={form.telefone} onChange={(e) => handleChange("telefone", e.target.value)} onKeyDown={handleNumericInputKeyDown("telefone")} placeholder="(00) 00000-0000 *" className={`pl-8 h-8 text-xs bg-secondary/50 ${phoneBorderClass}`} />
            </div>
            {phoneError && <p className="text-[10px] text-muted-foreground mt-0.5">{phoneError}</p>}
            {!phoneError && isFieldError("telefone") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
        </div>

        {/* Address */}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
          Endereço <span className="text-destructive">*</span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              {cepLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />}
              <Input value={form.cep} onChange={(e) => handleChange("cep", e.target.value)} onKeyDown={handleNumericInputKeyDown("cep")} onBlur={handleCepBlur} placeholder="CEP *" className={`pl-8 h-8 text-xs bg-secondary/50 ${cepError ? "border-destructive" : inputError("cep")}`} />
            </div>
            {cepError && <p className="text-[10px] text-destructive mt-0.5 font-medium">{cepError}</p>}
            {!cepError && isFieldError("cep") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <Input value={form.cidade} onChange={(e) => handleChange("cidade", e.target.value)} placeholder="Cidade *" className={`h-8 text-xs bg-secondary/50 ${inputError("cidade")}`} />
            {isFieldError("cidade") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-2">
          <div>
            <Input value={form.rua} onChange={(e) => handleChange("rua", e.target.value)} placeholder="Rua / Logradouro *" className={`h-8 text-xs bg-secondary/50 ${inputError("rua")}`} />
            {isFieldError("rua") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <Input value={form.estado} onChange={(e) => handleChange("estado", e.target.value)} placeholder="UF" className="h-8 text-xs bg-secondary/50 border-border" />
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr_1fr] gap-2">
          <div>
            <div className="relative">
              <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={form.numero} onChange={(e) => handleChange("numero", e.target.value)} onKeyDown={handleNumericInputKeyDown("numero")} placeholder="Nº *" className={`pl-8 h-8 text-xs bg-secondary/50 ${inputError("numero")}`} />
            </div>
            {isFieldError("numero") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <div className="relative">
              <Home className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={form.bairro} onChange={(e) => handleChange("bairro", e.target.value)} placeholder="Bairro *" className={`pl-8 h-8 text-xs bg-secondary/50 ${inputError("bairro")}`} />
            </div>
            {isFieldError("bairro") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
          </div>
          <div>
            <Input value={form.complemento} onChange={(e) => handleChange("complemento", e.target.value)} placeholder="Complemento" className="h-8 text-xs bg-secondary/50 border-border" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Opcional</p>
          </div>
        </div>

        {/* Logo Upload */}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">Sua Logomarca</p>
        <div className="p-2.5 rounded-lg border border-border bg-secondary/30">
          <LogoUpload value={userLogo} onChange={handleLogoChange} />
        </div>

        {/* Access */}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">Acesso</p>

        <div>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={form.usuario} onChange={(e) => handleChange("usuario", e.target.value)} placeholder="Crie seu usuário" className={`pl-8 h-8 text-xs bg-secondary/50 ${inputError("usuario")}`} />
          </div>
          {isFieldError("usuario") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
        </div>

        <div>
          <div className="relative">
            <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input type={showPassword ? "text" : "password"} value={form.senha} onChange={(e) => handleChange("senha", e.target.value)} placeholder="Crie sua senha" className={`pl-8 pr-8 h-8 text-xs bg-secondary/50 ${inputError("senha")}`} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {isFieldError("senha") && <p className="text-[10px] text-destructive mt-0.5">Obrigatório</p>}
        </div>

        {/* Billing preferences */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dia de Vencimento</p>
          <Select value={dueDay} onValueChange={setDueDay} disabled={fieldLocked}>
            <SelectTrigger className="h-8 text-xs bg-secondary/50 border-border">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Escolha o melhor dia para cobrança" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(2, "0")).map((day) => (
                <SelectItem key={day} value={day} className="text-xs">
                  Dia {day} de cada mês
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-secondary/30">
          <div>
            <p className="text-xs font-medium text-foreground">Notificação por E-mail e SMS?</p>
            <p className="text-[10px] text-muted-foreground">Lembretes de cobrança automáticos</p>
          </div>
          <Switch checked={sendNotifications} onCheckedChange={setSendNotifications} disabled={fieldLocked} />
        </div>

        <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-secondary/30">
          <div>
            <p className="text-xs font-medium text-foreground">Deseja receber Nota Fiscal?</p>
            <p className="text-[10px] text-muted-foreground">Ao ativar, o endereço será usado para emissão de NF</p>
          </div>
          <Switch checked={wantsNotaFiscal} onCheckedChange={setWantsNotaFiscal} disabled={fieldLocked} />
        </div>

        {/* Payment */}
        <div className="pt-2">
          <PaymentSection
            customerData={{
              nome: form.nome, email: form.email, telefone: form.telefone, cpfCnpj: form.cpfCnpj,
              cep: form.cep, rua: form.rua, numero: form.numero, bairro: form.bairro,
              cidade: form.cidade, estado: form.estado, complemento: form.complemento,
            }}
            onPaymentConfirmed={handlePaymentConfirmed}
            disabled={fieldLocked || !isFormReady()}
            onValidate={handleTryPay}
            dueDay={dueDay}
            logoUrl={userLogo}
          />
        </div>

        {!isFormReady() && !submitted && (
          <p className="text-[10px] text-muted-foreground text-center">
            Preencha todos os campos obrigatórios (*) para habilitar o pagamento
          </p>
        )}
        </fieldset>
      </div>

      <div className="mt-3 text-center">
        <p className="text-muted-foreground text-xs">
          Já tem uma conta?{" "}
          <button onClick={onBack} className="text-primary hover:underline font-medium">Entrar</button>
        </p>
      </div>
    </div>
  );
};

export default CadastroForm;
