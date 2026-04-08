const EDU_BG_PALETTE = [
  "#1f242e", "#1a2a3a", "#2a1a3a", "#1a3a2a",
  "#3a1a1a", "#3a2a1a", "#1a3a3a", "#2a3a1a",
  "#3a1a2a", "#252535",
];

function seedHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Draws the ComunicaEDU logo on a canvas: amber arcs fully opaque, "EDU" at 10% opacity */
export async function generateEduCover(seed: string): Promise<Blob | null> {
  try {
    const bg = EDU_BG_PALETTE[seedHash(seed) % EDU_BG_PALETTE.length];
    const SIZE = 400;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const amber = "#f59e0b";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = amber;
    ctx.lineCap = "round";
    ctx.lineWidth = SIZE * 0.032;

    // Upper arcs — 210° → 330° (through top)
    const uS = (7 * Math.PI) / 6;
    const uE = (11 * Math.PI) / 6;
    for (let i = 0; i < 3; i++) {
      const r = SIZE * (0.115 + i * 0.088);
      ctx.beginPath();
      ctx.arc(cx, cy, r, uS, uE);
      ctx.stroke();
    }

    // Lower arcs — 30° → 150° (through bottom)
    const lS = Math.PI / 6;
    const lE = (5 * Math.PI) / 6;
    for (let i = 0; i < 3; i++) {
      const r = SIZE * (0.115 + i * 0.088);
      ctx.beginPath();
      ctx.arc(cx, cy, r, lS, lE);
      ctx.stroke();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE * 0.018, 0, 2 * Math.PI);
    ctx.fillStyle = amber;
    ctx.fill();

    // "EDU" — barely perceptible
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = amber;
    ctx.font = `bold ${Math.round(SIZE * 0.16)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EDU", cx, cy);
    ctx.globalAlpha = 1.0;

    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png", 0.92)
    );
  } catch {
    return null;
  }
}
