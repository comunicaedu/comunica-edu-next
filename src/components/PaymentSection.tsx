"use client";

import { useState, useEffect, useCallback } from "react";
import { CreditCard, QrCode, FileText, Loader2, Copy, Check, ExternalLink, RefreshCw, Gift } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";

type PaymentMethod = "pix" | "boleto" | "cartao" | "trial" | null;

interface PaymentSectionProps {
  customerData: {
    nome: string;
    email: string;
    telefone: string;
    cpfCnpj: string;
    cep: string;
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    complemento: string;
  };
  onPaymentConfirmed: () => void;
  disabled?: boolean;
  onValidate?: () => boolean;
  dueDay: string;
}

const formatCardNumber = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(.{4})/g, "$1 ").trim();
};

const formatExpiry = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
};

const formatCvv = (value: string) => value.replace(/\D/g, "").slice(0, 4);

const SERVICE_NAMES: Record<string, string> = {
  "radio-interna": "Rádio Interna",
  "radio-web": "Rádio Web",
  "tv-indoor": "TV Indoor",
  "controle-caixa": "Controle de Caixa",
};

const PLAN_NAMES: Record<string, string> = {
  "radio-interna-start": "Start",
  "radio-interna-pro": "Pro",
  "radio-web-start": "Start",
  "radio-web-pro": "Pro",
  "tv-indoor-start": "Start",
  "tv-indoor-pro": "Pro",
  "controle-caixa-start": "Start",
  "controle-caixa-pro": "Pro",
};

const getSelectedPlanInfo = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlPlan = params.get("plan");
    const urlService = params.get("service");
    if (urlPlan && urlService) {
      const stored = localStorage.getItem("selected_plan");
      const parsed = stored ? JSON.parse(stored) : null;
      const valor = parsed?.valor;
      return {
        serviceName: SERVICE_NAMES[urlService] || urlService,
        planName: PLAN_NAMES[urlPlan] || urlPlan,
        value: typeof valor === "number" ? valor : 150,
      };
    }
    const stored = localStorage.getItem("selected_plan");
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        serviceName: SERVICE_NAMES[parsed.serviceId] || parsed.serviceId || "o serviço",
        planName: PLAN_NAMES[parsed.id] || parsed.plano || parsed.id || "",
        value: typeof parsed.valor === "number" ? parsed.valor : 150,
      };
    }
  } catch { /* ignore */ }
  return { serviceName: "o serviço", planName: "", value: 150 };
};

const PaymentSection = ({ customerData, onPaymentConfirmed, disabled, onValidate, dueDay }: PaymentSectionProps) => {
  const [method, setMethod] = useState<PaymentMethod>(null);
  const [loading, setLoading] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [pixData, setPixData] = useState<{ qrCode: string; copyPaste: string } | null>(null);
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [card, setCard] = useState({ number: "", name: "", expiry: "", cvv: "" });

  const planInfo = getSelectedPlanInfo();
  const VALUE = planInfo.value;

  const resetPayment = () => {
    setPaymentId(null);
    setPixData(null);
    setBoletoUrl(null);
    setPolling(false);
    setCopied(false);
  };

  const checkPaymentStatus = useCallback(async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("check-payment-status", {
        body: { paymentId: id },
      });
      if (!error && data?.confirmed) {
        setConfirmed(true);
        setPolling(false);
        toast.success("Pagamento confirmado! Redirecionando...");
        setTimeout(() => onPaymentConfirmed(), 1500);
        return true;
      }
    } catch { /* retry */ }
    return false;
  }, [onPaymentConfirmed]);

  useEffect(() => {
    if (!polling || !paymentId || confirmed) return;
    const interval = setInterval(async () => {
      const done = await checkPaymentStatus(paymentId);
      if (done) clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [polling, paymentId, confirmed, checkPaymentStatus]);

  const isCardValid = card.number.replace(/\s/g, "").length >= 13 && card.name.trim() && card.expiry.length >= 4 && card.cvv.length >= 3;

  const handleSubmitPayment = async () => {
    if (!method) return;

    // Run parent validation first
    if (onValidate && !onValidate()) return;

    if (!dueDay) {
      toast.error("Selecione o dia de vencimento da cobrança.");
      return;
    }

    if ((method === "cartao" || method === "trial") && !isCardValid) {
      toast.error("Preencha todos os dados do cartão corretamente.");
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        nome: customerData.nome,
        email: customerData.email,
        telefone: customerData.telefone,
        cpfCnpj: customerData.cpfCnpj,
        cep: customerData.cep,
        address: customerData.rua,
        addressNumber: customerData.numero,
        complement: customerData.complemento,
        province: customerData.bairro,
        city: customerData.cidade,
        state: customerData.estado,
        paymentMethod: method === "trial" ? "cartao" : method,
        value: VALUE,
        isTrial: method === "trial",
        dueDay: parseInt(dueDay),
      };

      if (method === "cartao" || method === "trial") {
        body.cardData = { number: card.number, name: card.name, expiry: card.expiry, cvv: card.cvv };
      }

      const { data, error } = await supabase.functions.invoke("create-asaas-payment", { body });

      if (error || !data) {
        const errorMsg = data?.error || "Erro ao processar pagamento.";
        toast.error(errorMsg);
        resetPayment();
        setLoading(false);
        return;
      }

      setPaymentId(data.paymentId);

      if (method === "trial" && data.subscriptionId) {
        setConfirmed(true);
        toast.success("Período de teste ativado! Redirecionando...");
        setTimeout(() => onPaymentConfirmed(), 1500);
      } else if (method === "pix" && data.pixQrCode) {
        setPixData({ qrCode: data.pixQrCode, copyPaste: data.pixCopyPaste });
        setPolling(true);
        toast.info("QR Code gerado! Escaneie para pagar.");
      } else if (method === "boleto" && (data.boletoUrl || data.invoiceUrl)) {
        setBoletoUrl(data.boletoUrl || data.invoiceUrl);
        setPolling(true);
        toast.info("Boleto gerado! Clique para baixar.");
      } else if (method === "cartao" && data.confirmed) {
        setConfirmed(true);
        toast.success("Pagamento confirmado! Redirecionando...");
        setTimeout(() => onPaymentConfirmed(), 1500);
      } else if (method === "cartao") {
        setPolling(true);
        toast.info("Processando pagamento do cartão...");
      }
    } catch {
      toast.error("Erro ao processar pagamento.");
    }
    setLoading(false);
  };

  const handleCopyPix = async () => {
    if (!pixData?.copyPaste) return;
    await navigator.clipboard.writeText(pixData.copyPaste);
    setCopied(true);
    toast.success("Código PIX copiado!");
    setTimeout(() => setCopied(false), 3000);
  };

  const METHODS = [
    { id: "trial" as const, icon: Gift, label: "Experimente Grátis por 3 Dias", desc: "Cartão obrigatório • Cancele quando quiser" },
    { id: "pix" as const, icon: QrCode, label: "PIX", desc: "QR Code • Confirmação instantânea" },
    { id: "boleto" as const, icon: FileText, label: "Boleto", desc: "Compensação em até 3 dias úteis" },
    { id: "cartao" as const, icon: CreditCard, label: "Cartão de Crédito", desc: "Cobrança imediata • Acesso instantâneo" },
  ];

  const needsCard = method === "cartao" || method === "trial";

  if (confirmed) {
    return (
      <div className="space-y-3 text-center p-4 rounded-lg border border-primary/30 bg-primary/5">
        <Check className="h-10 w-10 text-primary mx-auto" />
        <p className="text-sm font-semibold text-foreground">
          {method === "trial" ? "Período de teste ativado!" : "Pagamento confirmado!"}
        </p>
        <p className="text-xs text-muted-foreground">Redirecionando para o login...</p>
      </div>
    );
  }

   return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Forma de Pagamento</p>
      <div className="h-px bg-muted/40 mb-1" aria-hidden="true" />
      <div className="grid gap-1.5">
        {METHODS.map((m, index) => (
          <div key={m.id}>
            <button
              type="button"
              disabled={(m.id === "trial" ? false : disabled) || loading}
              onClick={() => { setMethod(m.id); resetPayment(); }}
              className={`flex w-full items-center gap-2.5 p-2.5 rounded-lg text-left transition-colors text-xs ${
                method === m.id
                  ? "bg-primary/10 text-foreground ring-1 ring-primary/40"
                  : "bg-transparent text-foreground hover:bg-muted/10"
              } ${m.id === "trial" ? "" : "disabled:opacity-50"}`}
            >
              <m.icon className={`h-4 w-4 shrink-0 ${method === m.id ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <p className={`font-medium ${method === m.id ? "text-primary" : "text-foreground"}`}>{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.desc}</p>
              </div>
            </button>
            <div className="my-1 h-px bg-muted/40" aria-hidden="true" />
          </div>
        ))}
      </div>

      {/* Trial info banner */}
      {method === "trial" && !paymentId && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/10 text-xs space-y-1 animate-fade-in">
          <p className="font-semibold text-foreground">ℹ️ Como funciona o teste grátis{planInfo.planName ? ` — ${planInfo.serviceName} (${planInfo.planName})` : ""}:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>Acesso completo ao serviço de {planInfo.serviceName} por 3 dias sem cobrança</li>
            <li>Após os 3 dias, a mensalidade de R$ {VALUE.toFixed(2).replace(".", ",")} será cobrada automaticamente</li>
            <li>Cancele quando quiser antes do 3º dia para não ser cobrado</li>
          </ul>
        </div>
      )}

      {needsCard && !paymentId && (
        <div className="space-y-2 animate-fade-in">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dados do Cartão</p>
          <Input value={card.number} onChange={(e) => setCard(prev => ({ ...prev, number: formatCardNumber(e.target.value) }))} placeholder="Número do cartão" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
          <Input value={card.name} onChange={(e) => setCard(prev => ({ ...prev, name: e.target.value }))} placeholder="Nome impresso no cartão" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={card.expiry} onChange={(e) => setCard(prev => ({ ...prev, expiry: formatExpiry(e.target.value) }))} placeholder="Validade" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
            <Input value={card.cvv} onChange={(e) => setCard(prev => ({ ...prev, cvv: formatCvv(e.target.value) }))} placeholder="CVV" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
          </div>
        </div>
      )}

      {pixData && (
        <div className="space-y-3 animate-fade-in p-3 rounded-lg border-2 border-primary bg-primary/10">
          <p className="text-xs font-semibold text-foreground text-center">Escaneie o QR Code ou copie o código</p>
          <div className="flex justify-center bg-white p-2 rounded-lg w-fit mx-auto">
            <img src={`data:image/png;base64,${pixData.qrCode}`} alt="QR Code PIX" className="w-40 h-40 rounded" />
          </div>
          <Button type="button" size="sm" onClick={handleCopyPix} className="w-full text-xs h-9 font-semibold">
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {copied ? "Copiado!" : "Copiar código PIX"}
          </Button>
          {polling && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando confirmação do pagamento...
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={resetPayment} className="w-full text-xs h-7 text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3 mr-1.5" /> Trocar forma de pagamento
          </Button>
        </div>
      )}

      {boletoUrl && (
        <div className="space-y-3 animate-fade-in p-3 rounded-lg border-2 border-primary bg-primary/10">
          <div className="flex items-center justify-center gap-2">
            <Check className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold text-foreground">Boleto gerado com sucesso!</p>
          </div>
          <Button type="button" size="sm" onClick={() => window.open(boletoUrl, "_blank")} className="w-full text-xs h-9 font-semibold">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir / Baixar Boleto
          </Button>
          {polling && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando confirmação do pagamento...
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={resetPayment} className="w-full text-xs h-7 text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3 mr-1.5" /> Trocar forma de pagamento
          </Button>
        </div>
      )}

      {method && !paymentId && (
        <Button
          type="button"
          onClick={handleSubmitPayment}
          disabled={loading || (needsCard && !isCardValid)}
          className="w-full font-semibold text-xs h-8 rounded-lg"
        >
          {loading ? (
            <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processando...</span>
          ) : method === "trial" ? (
            "Ativar Teste Grátis de 3 Dias"
          ) : (
            `Pagar R$ ${VALUE.toFixed(2).replace(".", ",")} via ${method === "pix" ? "PIX" : method === "boleto" ? "Boleto" : "Cartão"}`
          )}
        </Button>
      )}
    </div>
  );
};

export default PaymentSection;