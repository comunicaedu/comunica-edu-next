"use client";

import { useState } from "react";

export default function SetupPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("/api/auth/restore-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(`✅ Conta "${username}" ${data.action === "created" ? "criada" : "atualizada"} com sucesso! Acesse: /login`);
      } else {
        setStatus(`❌ Erro: ${data.error}`);
      }
    } catch {
      setStatus("❌ Erro ao conectar.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1f2e" }}>
      <div style={{ background: "#2a2f3e", padding: "2rem", borderRadius: "12px", width: "100%", maxWidth: "360px" }}>
        <h1 style={{ color: "#fff", marginBottom: "1.5rem", fontSize: "1.2rem" }}>Restaurar Acesso Admin</h1>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ color: "#aaa", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Usuário</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", background: "#1a1f2e", color: "#fff", border: "1px solid #444", fontSize: "1rem" }}
              autoComplete="off"
            />
          </div>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ color: "#aaa", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Digite a senha"
              style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", background: "#1a1f2e", color: "#fff", border: "1px solid #444", fontSize: "1rem" }}
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{ width: "100%", padding: "0.65rem", borderRadius: "6px", background: "#f59e0b", color: "#fff", fontWeight: "bold", fontSize: "1rem", border: "none", cursor: "pointer" }}
          >
            {loading ? "Aguarde..." : "Criar / Restaurar Conta"}
          </button>
        </form>
        {status && (
          <p style={{ marginTop: "1rem", color: status.startsWith("✅") ? "#4ade80" : "#f87171", fontSize: "0.9rem" }}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
