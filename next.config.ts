import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,

  // ── Performance ────────────────────────────────────────────────────────────
  compress: true,          // gzip/br compression on responses
  poweredByHeader: false,  // remove X-Powered-By header

  // ── Image optimisation (avif → webp → original) ────────────────────────────
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 days
    remotePatterns: [
      // Supabase storage
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // YouTube thumbnails
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },

  // ── Bundle optimisation ────────────────────────────────────────────────────
  experimental: {
    // Tree-shake large icon/animation libraries — huge win on mobile bandwidth
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-slider",
      "@radix-ui/react-switch",
    ],
  },

  // ── Headers — cache static assets aggressively ─────────────────────────────
  async headers() {
    return [
      {
        // Páginas HTML — nunca cachear no browser
        source: "/(player|login|cadastro|planos|reset|operador|ouvinte)(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/(.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2|woff))",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
