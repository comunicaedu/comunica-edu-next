import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { BackgroundProvider } from "@/contexts/BackgroundContext";
import { Toaster } from "sonner";
import PWASetup from "@/components/PWASetup";

export const metadata: Metadata = {
  title: "ComunicaEDU",
  description: "Sistema de programação musical para rádio e varejo",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ComunicaEDU",
  },
  icons: {
    icon: [
      { url: "/edu-logo-icon.png", type: "image/png" },
    ],
    apple: [
      { url: "/edu-logo-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/edu-logo-icon.png",
  },
  other: {
    // Alexa Silk browser + old Android
    "mobile-web-app-capable": "yes",
    // Microsoft Tile (Edge / Windows)
    "msapplication-TileColor": "#1f242e",
    "msapplication-TileImage": "/edu-logo-icon.png",
    "msapplication-tap-highlight": "no",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,        // allow pinch-zoom on tablets/accessibility
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: dark)",  color: "#1f242e" },
    { media: "(prefers-color-scheme: light)", color: "#1f242e" },
  ],
  viewportFit: "cover",   // notch / rounded-corner safe area
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      {/* Aplica tema salvo antes do primeiro paint — evita flash de tema padrão */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=JSON.parse(localStorage.getItem('comunica-edu-theme')||'null');if(!t)return;function h(x){x=x.replace('#','');var r=parseInt(x.slice(0,2),16)/255,g=parseInt(x.slice(2,4),16)/255,b=parseInt(x.slice(4,6),16)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),hh=0,s=0,l=(mx+mn)/2;if(mx!==mn){var d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)hh=((g-b)/d+(g<b?6:0))/6;else if(mx===g)hh=((b-r)/d+2)/6;else hh=((r-g)/d+4)/6;}return Math.round(hh*360)+' '+Math.round(s*100)+'% '+Math.round(l*100)+'%';}var e=document.documentElement;if(t.background)e.style.setProperty('--background',h(t.background));if(t.foreground)e.style.setProperty('--foreground',h(t.foreground));if(t.card)e.style.setProperty('--card',h(t.card));if(t.cardForeground)e.style.setProperty('--card-foreground',h(t.cardForeground));if(t.primary){e.style.setProperty('--primary',h(t.primary));e.style.setProperty('--accent',h(t.primary));e.style.setProperty('--ring',h(t.primary));e.style.setProperty('--sidebar-primary',h(t.primary));}if(t.muted)e.style.setProperty('--muted',h(t.muted));if(t.mutedForeground)e.style.setProperty('--muted-foreground',h(t.mutedForeground));if(t.sidebarBackground){e.style.setProperty('--sidebar-background',h(t.sidebarBackground));}if(t.secondary)e.style.setProperty('--secondary',h(t.secondary));}catch(e){}})();` }} />
      </head>
      <body className="h-full bg-background text-foreground">
        <PWASetup />
        <ThemeProvider>
          <BackgroundProvider>
            {children}
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{ duration: 4000 }}
            />
          </BackgroundProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
