import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const VOICE_MAP: Record<string, string> = {
  "masculina-jovem":  "KeeGf5809M2HyjhM4ZfR",  // custom → Zeraías
  "masculina-madura": "nPczCjzI2devNBz1zQrb",  // custom → Lucas
  "masculina-extra":  "KoQQbl9zjAdLgKZjm8Ol",  // custom → Joabe
  "feminina-jovem":   "KHmfNHtEjHhLK9eER20w",  // custom → Valdice
  "feminina-madura":  "MnUw1cSnpiLoLhpd3Hqp",  // custom → Benilda
};

const MODEL_ID        = "eleven_multilingual_v2";
const MAX_CHARS       = 2000; // texto pode crescer bastante após expansão fonética pelo Gemini
const MAX_GENERATIONS = 20;

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    return NextResponse.json({ error: "TTS API key not configured." }, { status: 500 });
  }

  let text: string, voice: string, stability: number | undefined, style: number | undefined, speed: number | undefined;
  try {
    ({ text, voice, stability, style, speed } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!text?.trim()) {
    return NextResponse.json({ error: "Texto é obrigatório." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Máximo de ${MAX_CHARS} caracteres por geração.` }, { status: 400 });
  }

  // Check and update usage — userId always from token
  const userId = user.userId;
  {
    const supabase  = adminSupabase();
    const monthKey  = getMonthKey();

    const { data: usage } = await supabase
      .from("locutor_usage")
      .select("*")
      .eq("user_id", userId)
      .eq("month_key", monthKey)
      .single();

    if (!user.isAdmin && usage && usage.generations_used >= MAX_GENERATIONS) {
      return NextResponse.json({ error: `Limite de ${MAX_GENERATIONS} gerações mensais atingido.` }, { status: 429 });
    }

    // Upsert usage record
    await supabase.from("locutor_usage").upsert(
      {
        user_id:          userId,
        month_key:        monthKey,
        chars_used:       (usage?.chars_used ?? 0) + text.length,
        generations_used: (usage?.generations_used ?? 0) + 1,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "user_id,month_key" }
    );
  }

  const voiceId = VOICE_MAP[voice] ?? VOICE_MAP["feminina-jovem"];

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": elevenKey,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: MODEL_ID,
          voice_settings: {
            stability:        stability        ?? 0.5,
            similarity_boost: 0.75,
            style:            style            ?? 0.3,
            use_speaker_boost: true,
            speed:            Math.min(1.2, Math.max(0.7, speed ?? 1.0)),
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[TTS] ElevenLabs error:", response.status, errText);
      return NextResponse.json({ error: "Erro na API de voz." }, { status: 502 });
    }

    const audioBuffer = await response.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[TTS] Fetch error:", err);
    return NextResponse.json({ error: "Falha ao conectar com o serviço de voz." }, { status: 500 });
  }
}
