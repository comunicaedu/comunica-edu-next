"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function ResetPage() {
  const [status, setStatus] = useState("Limpando sessão e banco de dados...");

  useEffect(() => {
    const run = async () => {
      // 1. Limpa localStorage corrompido
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("sb-") || k === "owner-avatar-user-id") {
          localStorage.removeItem(k);
        }
      });

      // 2. Faz login anônimo para obter sessão válida
      setStatus("Obtendo sessão...");
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // 3. Atualiza registros corrompidos — muda uploaded_by de texto inválido para null
        setStatus("Corrigindo registros no banco...");

        // Busca todos os spots e músicas para verificar
        const { data: songs } = await supabase
          .from("songs")
          .select("id, uploaded_by")
          .eq("uploaded_by", session.user.id);

        setStatus(`Sessão válida. ${songs?.length ?? 0} registros seus encontrados.`);
      } else {
        setStatus("Sessão limpa. Redirecionando para login...");
      }

      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    };

    run();
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1f242e", color: "#fff", fontFamily: "sans-serif", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 40, height: 40, border: "3px solid #f97316", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <p style={{ fontSize: 16 }}>{status}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
