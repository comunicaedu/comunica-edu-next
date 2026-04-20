import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ── Supabase ──────────────────────────────────────────────────────────────────
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Vozes disponíveis ─────────────────────────────────────────────────────────
const VOICE_MAP: Record<string, string> = {
  "masculina-jovem":  "TxGEqnHWrfWFTfGW9XjX",
  "masculina-madura": "nPczCjzI2devNBz1zQrb",
  "masculina-extra":  "KoQQbl9zjAdLgKZjm8Ol",
  "feminina-jovem":   "tnSpp4vdxKPjI9w0GnoV",
  "feminina-madura":  "MnUw1cSnpiLoLhpd3Hqp",
};

const VOICE_STABILITY = 0.82;
const VOICE_STYLE     = 0.08;
const MODEL_ID        = "eleven_multilingual_v2";

// ── Gemini ────────────────────────────────────────────────────────────────────
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-002",
];

async function geminiRequest(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  });

  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err?.error?.message ?? "") as string;
      if (res.status === 404 || msg.includes("not found") || msg.includes("no longer available")) continue;
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  }
  return null;
}

// ── Resolve usuário (Bearer token ou secret) ──────────────────────────────────
async function resolveUserId(req: NextRequest, secret?: string): Promise<string | null> {
  // Modo webhook — secret compartilhado (para Alexa, Siri, etc.)
  const envSecret = process.env.VOICE_COMMAND_SECRET;
  if (envSecret && secret && secret === envSecret) {
    return process.env.VOICE_COMMAND_USER_ID ?? null;
  }

  // Modo autenticado — Bearer token Supabase
  const auth = (req.headers.get("authorization") ?? "").replace("Bearer ", "").trim();
  if (auth) {
    const { data: { user }, error } = await adminClient().auth.getUser(auth);
    if (!error && user) return user.id;
  }

  return null;
}

// ── Interpreta comando com Gemini ─────────────────────────────────────────────
interface ParsedCommand {
  titulo:         string;
  texto:          string;
  voz:            string;
  intervalo:      number;
  schedule_start: string | null;
  schedule_end:   string | null;
}

async function parseCommand(command: string): Promise<ParsedCommand | null> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const prompt = `Hoje é ${today}. Interprete o comando e responda APENAS com JSON válido, sem markdown, sem explicações.

Comando: "${command}"

Formato obrigatório:
{"titulo":"<máx 40 chars>","texto":"<locutor fala em português, sem algarismos, máx 250 chars>","voz":"<masculina-jovem|masculina-madura|masculina-extra|feminina-jovem|feminina-madura, padrão: feminina-jovem>","intervalo":<número de músicas entre execuções, padrão 3>,"schedule_start":"<YYYY-MM-DDTHH:mm:00 ou null>","schedule_end":"<YYYY-MM-DDTHH:mm:00 ou null>"}

Regras: números por extenso (13%→treze por cento, R$20→vinte reais, 12h→doze horas). Se só data fim informada, schedule_start="${today}T00:00:00". Se sem agenda, null.`;

  const raw = await geminiRequest(prompt);
  if (!raw) return null;

  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as ParsedCommand;
    // Validações básicas
    if (!parsed.texto?.trim()) return null;
    parsed.titulo    = parsed.titulo?.slice(0, 40) || "Spot via assistente";
    parsed.texto     = parsed.texto.slice(0, 300);
    parsed.voz       = parsed.voz in VOICE_MAP ? parsed.voz : "feminina-jovem";
    parsed.intervalo = Math.max(1, Math.min(20, Number(parsed.intervalo) || 3));
    return parsed;
  } catch {
    return null;
  }
}

// ── POST /api/voice-command ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let command: string, secret: string | undefined;
  try {
    ({ command, secret } = await req.json());
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  if (!command?.trim()) {
    return NextResponse.json({ error: "Comando não pode ser vazio." }, { status: 400 });
  }

  // Auth
  const userId = await resolveUserId(req, secret);
  if (!userId) {
    return NextResponse.json({ error: "Não autorizado. Envie Authorization: Bearer <token> ou o campo secret." }, { status: 401 });
  }

  // 1. Interpreta o comando
  const parsed = await parseCommand(command);
  if (!parsed) {
    return NextResponse.json({ error: "Não foi possível interpretar o comando. Tente ser mais específico." }, { status: 422 });
  }

  // 2. Gera áudio com ElevenLabs
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY não configurada." }, { status: 500 });
  }

  const voiceId = VOICE_MAP[parsed.voz];
  let audioBuffer: ArrayBuffer;

  try {
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": elevenKey },
        body: JSON.stringify({
          text: parsed.texto,
          model_id: MODEL_ID,
          voice_settings: {
            stability:        VOICE_STABILITY,
            similarity_boost: 0.75,
            style:            VOICE_STYLE,
            use_speaker_boost: true,
          },
        }),
      }
    );
    if (!ttsRes.ok) {
      return NextResponse.json({ error: "Erro ao gerar áudio." }, { status: 502 });
    }
    audioBuffer = await ttsRes.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Falha ao conectar com ElevenLabs." }, { status: 500 });
  }

  // 3. Faz upload para Supabase Storage (bucket: spots)
  const db = adminClient();
  const storagePath = `${userId}/${Date.now()}-voice-cmd.mp3`;

  const { error: uploadErr } = await db.storage
    .from("spots")
    .upload(storagePath, Buffer.from(audioBuffer), {
      contentType: "audio/mpeg",
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // 4. Cria registro na tabela spots
  const { data: spot, error: dbErr } = await db
    .from("spots")
    .insert({ user_id: userId, title: parsed.titulo, file_path: storagePath })
    .select("id")
    .single();

  if (dbErr || !spot) {
    await db.storage.from("spots").remove([storagePath]);
    return NextResponse.json({ error: dbErr?.message ?? "Erro ao salvar spot." }, { status: 500 });
  }

  // 5. Cria config do spot (agenda + intervalo)
  await db.from("spot_configs").upsert(
    {
      spot_id:        spot.id,
      user_id:        userId,
      priority:       1,
      enabled:        true,
      schedule_start: parsed.schedule_start ?? null,
      schedule_end:   parsed.schedule_end   ?? null,
      interval_songs: parsed.intervalo,
      updated_at:     new Date().toISOString(),
    },
    { onConflict: "spot_id,user_id" }
  );

  // 6. Resposta
  return NextResponse.json({
    ok:      true,
    spot_id: spot.id,
    titulo:  parsed.titulo,
    texto:   parsed.texto,
    voz:     parsed.voz,
    intervalo: parsed.intervalo,
    schedule_start: parsed.schedule_start,
    schedule_end:   parsed.schedule_end,
    message: `Spot "${parsed.titulo}" criado com sucesso e agendado para tocar a cada ${parsed.intervalo} música(s).`,
  });
}
