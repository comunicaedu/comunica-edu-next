"use client";

import { useEffect } from "react";

export default function PWASetup() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistrations().then((registrations) => {
      // Desregistra qualquer SW antigo (ex: do Lovable) que não seja o nosso sw.js
      const toRemove = registrations.filter((reg) => {
        const scriptUrl =
          reg.active?.scriptURL ||
          reg.installing?.scriptURL ||
          reg.waiting?.scriptURL ||
          "";
        return !scriptUrl.endsWith("/sw.js");
      });

      return Promise.all(toRemove.map((reg) => reg.unregister()));
    }).then(() => {
      // Limpa caches antigos do Lovable no navegador
      return caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith("comunica-edu"))
            .map((k) => caches.delete(k))
        )
      );
    }).then(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }).catch(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }, []);

  return null;
}
