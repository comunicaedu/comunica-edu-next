/**
 * Converts any image file to PNG via canvas and returns a data URL.
 */
export const convertToPng = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas not supported")); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

interface RGB { r: number; g: number; b: number; }

function rgbToHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function getLuminance({ r, g, b }: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Extracts dominant colors from an image data URL and returns a theme-ready palette.
 */
export const extractColorsFromLogo = (dataUrl: string): Promise<{
  primary: string;
  accent: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  sidebarBackground: string;
}> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 100; // downsample for speed
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Collect non-white, non-black pixels
      const pixels: RGB[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue; // skip transparent
        const lum = getLuminance({ r, g, b });
        if (lum > 0.92 || lum < 0.08) continue; // skip near-white/black
        pixels.push({ r, g, b });
      }

      if (pixels.length === 0) {
        // fallback
        resolve({
          primary: "#f59e0b",
          accent: "#f59e0b",
          background: "#272d38",
          foreground: "#2d3340",
          card: "#ffffff",
          cardForeground: "#2d3340",
          sidebarBackground: "#1f242e",
        });
        return;
      }

      // Simple clustering: find most frequent color buckets (quantize to 16-step)
      const buckets = new Map<string, { color: RGB; count: number }>();
      for (const px of pixels) {
        const qr = Math.round(px.r / 32) * 32;
        const qg = Math.round(px.g / 32) * 32;
        const qb = Math.round(px.b / 32) * 32;
        const key = `${qr},${qg},${qb}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          // running average
          existing.color.r = Math.round((existing.color.r * (existing.count - 1) + px.r) / existing.count);
          existing.color.g = Math.round((existing.color.g * (existing.count - 1) + px.g) / existing.count);
          existing.color.b = Math.round((existing.color.b * (existing.count - 1) + px.b) / existing.count);
        } else {
          buckets.set(key, { color: { ...px }, count: 1 });
        }
      }

      const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
      const primaryColor = sorted[0].color;

      // Find a secondary color that's visually distinct
      let accentColor = sorted.length > 1 ? sorted[1].color : primaryColor;
      for (const bucket of sorted.slice(1)) {
        if (colorDistance(primaryColor, bucket.color) > 80) {
          accentColor = bucket.color;
          break;
        }
      }

      const primaryLum = getLuminance(primaryColor);
      const isDark = primaryLum < 0.5;

      // Build a harmonious palette based on the logo's dominant color
      const darken = (c: RGB, factor: number): RGB => ({
        r: Math.round(c.r * factor),
        g: Math.round(c.g * factor),
        b: Math.round(c.b * factor),
      });

      const bgColor = darken(primaryColor, 0.15);
      const sidebarBg = darken(primaryColor, 0.12);

      resolve({
        primary: rgbToHex(primaryColor),
        accent: rgbToHex(accentColor),
        background: rgbToHex(bgColor),
        foreground: isDark ? "#e5e7eb" : "#1f2937",
        card: "#ffffff",
        cardForeground: "#2d3340",
        sidebarBackground: rgbToHex(sidebarBg),
      });
    };
    img.src = dataUrl;
  });
};
