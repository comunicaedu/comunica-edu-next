import { NextRequest, NextResponse } from "next/server";

// Converte números e símbolos para extenso — para que o locutor leia corretamente
function expandNumbers(t: string): string {
  const u = ["zero","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez",
    "onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  const d = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  const c = ["","cem","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  const mil = ["","mil","dois mil","três mil","quatro mil","cinco mil","seis mil","sete mil","oito mil","nove mil","dez mil",
    "onze mil","doze mil","treze mil","quatorze mil","quinze mil","dezesseis mil","dezessete mil","dezoito mil","dezenove mil","vinte mil"];

  function numToWords(n: number): string {
    if (n === 0) return "zero";
    if (n < 0) return "menos " + numToWords(-n);
    if (n < 20) return u[n];
    if (n === 100) return "cem";
    if (n < 100) return d[Math.floor(n/10)] + (n%10 ? " e " + u[n%10] : "");
    if (n < 1000) return c[Math.floor(n/100)] + (n%100 ? " e " + numToWords(n%100) : "");
    if (n < 20000) return mil[Math.floor(n/1000)] + (n%1000 ? " e " + numToWords(n%1000) : "");
    return String(n); // acima de 20mil deixa como está por ora
  }

  // Datas: 13/04/2026 → treze de abril de dois mil e vinte e seis
  const months: Record<string,string> = {
    "01":"janeiro","02":"fevereiro","03":"março","04":"abril","05":"maio","06":"junho",
    "07":"julho","08":"agosto","09":"setembro","10":"outubro","11":"novembro","12":"dezembro"
  };
  t = t.replace(/\b(\d{1,2})\/(\d{2})\/(\d{4})\b/g, (_m, day, mon, year) => {
    const y = parseInt(year);
    const yStr = y < 2010 ? numToWords(y) : numToWords(Math.floor(y/1000)) + " mil e " + numToWords(y%1000);
    return `${numToWords(parseInt(day))} de ${months[mon] ?? mon} de ${yStr}`;
  });

  // Horas: 16h35 ou 16:35
  t = t.replace(/\b(\d{1,2})[h:](\d{2})\b/gi, (_m, h, min) =>
    `${numToWords(parseInt(h))} horas${parseInt(min) ? " e " + numToWords(parseInt(min)) + " minutos" : ""}`);
  t = t.replace(/\b(\d{1,2})h\b/gi, (_m, h) => `${numToWords(parseInt(h))} horas`);

  // Dinheiro: R$ 13,95 → treze reais e noventa e cinco centavos
  t = t.replace(/r\$\s*(\d+)[,.](\d{2})/gi, (_m, reais, cents) =>
    `${numToWords(parseInt(reais))} reais e ${numToWords(parseInt(cents))} centavos`);
  t = t.replace(/r\$\s*(\d+)/gi, (_m, n) => `${numToWords(parseInt(n))} reais`);

  // Porcentagem: 37% → trinta e sete por cento
  t = t.replace(/(\d+)%/g, (_m, n) => `${numToWords(parseInt(n))} por cento`);

  // Kg, litros, gramas
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*kg\b/gi, (_m, n) => `${numToWords(parseInt(n))} quilos`);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*g\b/g, (_m, n) => `${numToWords(parseInt(n))} gramas`);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*litros?\b/gi, (_m, n) => `${numToWords(parseInt(n))} litros`);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*l\b/gi, (_m, n) => `${numToWords(parseInt(n))} litros`);
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*ml\b/gi, (_m, n) => `${numToWords(parseInt(n))} mililitros`);

  // Placas de carro: ABC1234 ou ABC-1234 → á bê cê um dois três quatro
  const letterNames: Record<string,string> = {
    a:"á",b:"bê",c:"cê",d:"dê",e:"é",f:"éfe",g:"gê",h:"agá",i:"í",j:"jota",
    k:"cá",l:"éle",m:"ême",n:"êne",o:"ó",p:"pê",q:"quê",r:"erre",s:"esse",
    t:"tê",u:"ú",v:"vê",w:"dábliu",x:"xis",y:"ípsilon",z:"zê"
  };
  t = t.replace(/\b([A-Za-z]{2,4})[-\s]?(\d{3,4})\b/g, (_m, letters, nums) => {
    const l = letters.toLowerCase().split("").map((c: string) => letterNames[c] ?? c).join(" ");
    const n = nums.split("").map((c: string) => numToWords(parseInt(c))).join(" ");
    return `${l} ${n}`;
  });

  // Números soltos restantes (1–19999)
  t = t.replace(/\b(\d{1,5})\b/g, (_m, n) => {
    const num = parseInt(n);
    if (num > 19999) return n;
    return numToWords(num);
  });

  return t;
}

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-002",
];

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API key not configured." }, { status: 500 });
  }

  let audioBase64: string;
  let mimeType: string;
  try {
    ({ audioBase64, mimeType } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!audioBase64?.trim()) {
    return NextResponse.json({ error: "Audio é obrigatório." }, { status: 400 });
  }

  const prompt = `Transcreva palavra por palavra TUDO que foi falado neste áudio em português brasileiro. Do início ao fim, sem cortar nada.

REGRAS OBRIGATÓRIAS — siga exatamente:
- NÃO corrija, NÃO resuma, NÃO parafrase nenhuma palavra
- Escreva números SEMPRE por extenso: "16" → "dezesseis", "35" → "trinta e cinco"
- Horas: "16:35" ou "dezesseis horas e trinta e cinco" → "dezesseis horas e trinta e cinco"
- Datas: "13/04/2026" → "treze de abril de dois mil e vinte e seis"
- Dinheiro: "R$13,95" → "treze reais e noventa e cinco centavos"
- Porcentagem: "37%" → "trinta e sete por cento"
- Medidas: "2kg" → "dois quilos", "2 litros" → "dois litros"
- Placas de carro: "ABC1234" → "á bê cê um dois três quatro"
- Letras soltas: "G", "K", "H" → "gê", "cá", "agá"
- Palavras em inglês: escreva como soam em português (ex: "High School" → "rái scul")
- PROIBIDO usar algarismos: 0 1 2 3 4 5 6 7 8 9
- PROIBIDO usar símbolos: % R$ / kg g ml
- Adicione vírgula apenas onde há pausa natural clara
- Retorne SOMENTE o texto transcrito, sem aspas, sem explicações`;

  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType ?? "audio/webm", data: audioBase64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 4096 },
  });

  try {
    let response: Response | null = null;

    for (const model of GEMINI_MODELS) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );
      if (response.ok) break;

      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message ?? "";
      const isUnavailable = response.status === 404 || msg.includes("no longer available") || msg.includes("not found");
      if (!isUnavailable) {
        return NextResponse.json({ error: `Erro Gemini ${response.status}` }, { status: 502 });
      }
    }

    if (!response || !response.ok) {
      return NextResponse.json({ error: "Gemini indisponível." }, { status: 502 });
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!raw) {
      return NextResponse.json({ error: "Transcrição vazia." }, { status: 502 });
    }

    const transcript = expandNumbers(raw);
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[tts-transcribe]", err);
    return NextResponse.json({ error: "Falha ao transcrever." }, { status: 500 });
  }
}
