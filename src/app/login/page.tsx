"use client";

import { useCallback, useState, useEffect, useRef } from "react";
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
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import { toast } from "sonner";

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
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ username: false, senha: false });
  const [panelOpacity] = useState(85);
  const [panelBlur] = useState(2);
  const [fieldsLocked, setFieldsLocked] = useState(true);

  const router = useRouter();
  const setSession = useSessionStore(s => s.setSession);

  // Prevent browser autofill: fields start as readOnly, unlock after mount
  useEffect(() => {
    const t = setTimeout(() => setFieldsLocked(false), 50);
    return () => clearTimeout(t);
  }, []);
  const { settings } = useBackground();

  const isFormValid = username.trim() !== "" && senha.trim() !== "";

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
    const uname = username.trim().toLowerCase();
    if (!uname || !senha) return;

    setLoading(true);
    try {
      // Limpa sessão anterior e estado residual antes de logar
      await supabase.auth.signOut();
      localStorage.removeItem("edu-admin-return-session");
      localStorage.removeItem("edu-impersonated-username");
      sessionStorage.removeItem("edu-admin-return-session");
      sessionStorage.removeItem("edu-impersonated-username");
      localStorage.removeItem("edu-username");

      // Caches POR_USUARIO — limpar ao trocar de usuário
      try {
        localStorage.removeItem("user-logo");
        localStorage.removeItem("edu_fav_genres");
        localStorage.removeItem("avatar-position-config");

        // Chaves dinâmicas POR_USUARIO — remover por prefixo
        const dynamicPrefixes = [
          "playlists-cache",
          "edu-fav-",
          "draggable-adjust-",
          "edu-player-state",
        ];
        const toDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (dynamicPrefixes.some(p => key.startsWith(p))) {
            toDelete.push(key);
          }
        }
        toDelete.forEach(k => localStorage.removeItem(k));

        sessionStorage.clear();
      } catch {}

      // Tenta username@comunicaedu.app primeiro
      let { data, error: authError } = await supabase.auth.signInWithPassword({
        email: `${uname}@comunicaedu.app`,
        password: senha,
      });

      // Fallback: tenta o input direto como email (contas antigas)
      if (authError) {
        const fallback = await supabase.auth.signInWithPassword({
          email: uname,
          password: senha,
        });
        if (!fallback.error) {
          data = fallback.data;
          authError = null;
        }
      }

      if (authError || !data?.user) {
        setErrors({ username: true, senha: true });
        toast.error("Usuário ou senha incorretos.");
        setLoading(false);
        return;
      }

      localStorage.setItem("edu-username", uname);

      // Obtém JWT próprio em paralelo (não bloqueia se falhar)
      try {
        const jwtRes = await fetch("/api/auth/jwt-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuario: uname, senha }),
        });
        if (jwtRes.ok) {
          const { token, user } = await jwtRes.json();
          if (token && user?.id) {
            setSession(token, user);
          }
        } else {
          console.warn("[login] jwt-login falhou, seguindo sem JWT proprio");
        }
      } catch (e) {
        console.warn("[login] erro ao obter JWT proprio:", e);
      }

      router.replace("/player");
    } catch {
      toast.error("Erro ao entrar. Tente novamente.");
      setLoading(false);
    }
  }, [username, senha, router]);

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
        <AnimatePresence initial={false} mode="wait">

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
                  <label className="text-sm font-medium text-white">Usuário</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value.toLowerCase()); if (errors.username) setErrors(prev => ({ ...prev, username: false })); }}
                      placeholder="Digite seu usuário"
                      autoComplete="new-password"
                      readOnly={fieldsLocked}
                      onFocus={() => setFieldsLocked(false)}
                      className={`pl-10 bg-muted border-border text-white ${errors.username ? "border-destructive ring-1 ring-destructive" : ""}`}
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
                      autoComplete="new-password"
                      readOnly={fieldsLocked}
                      onFocus={() => setFieldsLocked(false)}
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
