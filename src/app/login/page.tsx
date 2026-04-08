"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Lock, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ComunicaEduLogo from "@/components/ComunicaEduLogo";
import CadastroForm from "@/components/CadastroForm";
import PlansModal from "@/components/PlansModal";
import WhatsAppButton from "@/components/WhatsAppButton";
import { useBackground } from "@/contexts/BackgroundContext";
// TODO: reativar imports antes do lançamento
// import { supabase } from "@/lib/supabase/client";
// import { toast } from "sonner";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}, ${alpha})`;
}

const TRANSITION_MS = 0.6;
const PLAN_UNLOCK_KEY = "cadastro_plan_unlock";

type ActiveView = "login" | "cadastro" | "planos";

const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export default function LoginPage() {
  const [activeView, setActiveView] = useState<ActiveView>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading] = useState(false);
  const [errors, setErrors] = useState({ email: false, senha: false });
  const [panelOpacity] = useState(85);
  const [panelBlur] = useState(2);

  const router = useRouter();
  const { settings } = useBackground();

  const isFormValid = email.trim() !== "" && senha.trim() !== "";

  const transition = { duration: TRANSITION_MS, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

  const goToView = useCallback((view: ActiveView, options?: { fromPlanSelection?: boolean }) => {
    if (view === "cadastro" && !options?.fromPlanSelection) {
      sessionStorage.removeItem(PLAN_UNLOCK_KEY);
    }
    setActiveView(view);
  }, []);

  const handleNavigateCadastroFromPlan = useCallback((selection?: { planId: string; serviceId: string; isTrial?: boolean }) => {
    const params = new URLSearchParams();
    if (selection?.planId) params.set("plan", selection.planId);
    if (selection?.serviceId) params.set("service", selection.serviceId);
    if (selection?.isTrial) params.set("trial", "1");
    sessionStorage.setItem(
      PLAN_UNLOCK_KEY,
      JSON.stringify({ planId: selection?.planId, serviceId: selection?.serviceId, at: Date.now() })
    );
    setActiveView("cadastro");
  }, []);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: reativar autenticação real antes do lançamento
    router.replace("/player");
  }, [email, senha, router]);

  const handleOverlayClick = () => {
    if (activeView !== "login") setActiveView("login");
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-no-repeat relative px-4"
      style={{
        backgroundColor: hexToRgba(settings.vignetteColor || "#000000", 1),
        backgroundImage: `url(/studio-bg.jpg)`,
        backgroundSize: `${settings.zoom}%`,
        backgroundPosition: `${settings.posX}% ${settings.posY}%`,
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, transparent 20%, ${hexToRgba(settings.vignetteColor, settings.vignetteOpacity / 100)} 70%, ${hexToRgba(settings.vignetteColor, Math.min(1, settings.vignetteOpacity / 100 + 0.3))} 100%)`,
        }}
      />
      <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity / 100})` }} />

      {activeView !== "login" && (
        <div className="absolute inset-0 z-10 cursor-pointer" onClick={handleOverlayClick} />
      )}

      <div
        className="relative z-20 w-full max-w-[95vw] sm:max-w-md"
        style={{ '--panel-bg': `rgba(92, 92, 92, ${panelOpacity / 100})`, '--panel-blur': `blur(${panelBlur}px)` } as React.CSSProperties}
      >
        <AnimatePresence initial={false}>

          {activeView === "login" && (
            <motion.div
              key="login"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="rounded-xl p-6 sm:p-10 shadow-xl"
              style={{
                backgroundColor: `rgba(92, 92, 92, ${panelOpacity / 100})`,
                backdropFilter: `blur(${panelBlur}px)`,
                WebkitBackdropFilter: `blur(${panelBlur}px)`,
              }}
            >
              <div className="flex justify-center mb-8">
                <ComunicaEduLogo />
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-white">E-mail</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({ ...prev, email: false })); }}
                      placeholder="Digite seu e-mail"
                      autoComplete="email"
                      className={`pl-10 bg-muted border-border text-white ${errors.email ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-white">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={senha}
                      onChange={(e) => { setSenha(e.target.value); if (errors.senha) setErrors(prev => ({ ...prev, senha: false })); }}
                      placeholder="Digite sua senha"
                      autoComplete="current-password"
                      className={`pl-10 pr-10 bg-muted border-border text-white ${errors.senha ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                    >
                      {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={!isFormValid || loading}
                  className="w-full font-semibold text-base h-11 rounded-lg disabled:opacity-50 active:scale-95 transition-all"
                >
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </form>

              <div className="mt-6 text-center space-y-3">
                <p className="text-muted-foreground text-sm">
                  Ainda não é usuário e quer experimentar?
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground font-semibold"
                    onClick={() => goToView("cadastro")}
                  >
                    Cadastre-se
                  </Button>
                  <Button
                    className="font-semibold bg-primary text-foreground border border-primary hover:bg-background hover:text-primary-foreground"
                    onClick={() => goToView("planos")}
                  >
                    Planos e Serviços
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {activeView === "cadastro" && (
            <motion.div
              key="cadastro"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="max-h-[85vh] overflow-y-auto scrollbar-none"
              onClick={(e) => e.stopPropagation()}
            >
              <CadastroForm
                onBack={() => goToView("login")}
                onNavigatePlanos={() => goToView("planos")}
              />
            </motion.div>
          )}

          {activeView === "planos" && (
            <motion.div
              key="planos"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              className="rounded-xl shadow-xl min-h-[520px] max-h-[85vh] overflow-y-auto scrollbar-none touch-pan-y"
              style={{
                backgroundColor: `rgba(92, 92, 92, ${panelOpacity / 100})`,
                backdropFilter: `blur(${panelBlur}px)`,
                WebkitBackdropFilter: `blur(${panelBlur}px)`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <PlansModal
                embedded
                onClose={() => goToView("login")}
                onNavigateCadastro={handleNavigateCadastroFromPlan}
              />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <WhatsAppButton />
    </div>
  );
}
