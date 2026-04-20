"use client";

import { useState, useEffect } from "react";
import { Users, Shield, Wifi, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

const AdminDashboard = () => {
  const [totalAdmins, setTotalAdmins] = useState(0);
  const [totalClients, setTotalClients] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);

      const { count: profileCount } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });

      const { count: adminCount } = await supabase
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");

      const { count: activeCount } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("status", "ativo");

      setTotalClients((profileCount ?? 0) - (adminCount ?? 0));
      setTotalAdmins(1);
      setOnlineUsers(activeCount ?? 0);
      setLoading(false);
    };

    fetchMetrics();
  }, []);

  const metrics = [
    {
      label: "Administradores",
      value: totalAdmins,
      icon: <Shield className="h-5 w-5" />,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Clientes Cadastrados",
      value: totalClients,
      icon: <Users className="h-5 w-5" />,
      color: "text-accent-foreground",
      bg: "bg-accent/30",
    },
    {
      label: "Usuários Ativos",
      value: onlineUsers,
      icon: <Wifi className="h-5 w-5" />,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      label: "Ex-Clientes",
      value: "—",
      icon: <UserPlus className="h-5 w-5" />,
      color: "text-muted-foreground",
      bg: "bg-muted/30",
      loadAsync: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Card key={m.label} className="bg-card border-0">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl ${m.bg} flex items-center justify-center ${m.color}`}>
                {m.icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{loading ? "…" : m.value}</p>
                <p className="text-xs text-muted-foreground">{m.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  );
};

export default AdminDashboard;