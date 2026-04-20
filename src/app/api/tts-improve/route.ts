import { NextRequest, NextResponse } from "next/server";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-002",
];

// ── Expansões determinísticas (regex) ────────────────────────────────────────
// Feito aqui em JS para não depender do Gemini — nunca corta o texto
function expandForTTS(raw: string): string {
  let t = raw;

  // 1. Horários: 10h → dez horas, 10h30 → dez horas e trinta minutos
  const hours: Record<number, string> = {
    0:"zero",1:"uma",2:"duas",3:"três",4:"quatro",5:"cinco",6:"seis",
    7:"sete",8:"oito",9:"nove",10:"dez",11:"onze",12:"doze",13:"treze",
    14:"quatorze",15:"quinze",16:"dezesseis",17:"dezessete",18:"dezoito",
    19:"dezenove",20:"vinte",21:"vinte e uma",22:"vinte e duas",23:"vinte e três",
  };
  const mins: Record<number, string> = {
    0:"",5:"cinco",10:"dez",15:"quinze",20:"vinte",25:"vinte e cinco",
    30:"trinta",35:"trinta e cinco",40:"quarenta",45:"quarenta e cinco",50:"cinquenta",55:"cinquenta e cinco",
  };
  t = t.replace(/\b(\d{1,2})h(\d{2})?\b/gi, (_m, h, min) => {
    const hNum = parseInt(h);
    const hStr = hours[hNum] ?? h;
    if (min) {
      const mNum = parseInt(min);
      const mStr = mins[mNum];
      return mStr ? `${hStr} horas e ${mStr} minutos` : `${hStr} horas`;
    }
    return `${hStr} horas`;
  });

  // 2. Moeda: R$50 → cinquenta reais
  const numWords = (n: number): string => {
    const u = ["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
    const d = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
    const c = ["","cem","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
    if (n === 0) return "zero";
    if (n === 100) return "cem";
    if (n < 20) return u[n];
    if (n < 100) return d[Math.floor(n/10)] + (n%10 ? " e " + u[n%10] : "");
    return c[Math.floor(n/100)] + (n%100 ? " e " + numWords(n%100) : "");
  };
  t = t.replace(/r\$\s*(\d+)/gi, (_m, n) => `${numWords(parseInt(n))} reais`);

  // 3. Porcentagem: 30% → trinta por cento
  t = t.replace(/(\d+)%/g, (_m, n) => `${numWords(parseInt(n))} por cento`);

  // 4. Números soltos 1–999 por extenso (apenas quando não são parte de palavras)
  t = t.replace(/\b(\d{1,3})\b/g, (_m, n) => numWords(parseInt(n)));

  // 5. Abreviações comuns
  const abbr: [RegExp, string][] = [
    [/\bvc\b/gi, "você"], [/\bvcs\b/gi, "vocês"], [/\bpq\b/gi, "porque"],
    [/\btb\b/gi, "também"], [/\btbm\b/gi, "também"], [/\bmt[oa]?\b/gi, "muito"],
    [/\bblz\b/gi, "beleza"], [/\bflw\b/gi, "falou"],
    [/\bq\b/gi, "que"], [/\bpra\b/gi, "para"], [/\bpro\b/gi, "para o"],
    [/\bpros\b/gi, "para os"], [/\bpras\b/gi, "para as"],
    [/\bta\b/gi, "está"], [/\bto\b/gi, "estou"], [/\btao\b/gi, "estão"],
    [/\bne\b/gi, "não é"], [/\bné\b/gi, "não é"],
    [/\boq\b/gi, "o que"], [/\bsq\b/gi, "só que"],
    [/\bkd\b/gi, "cadê"], [/\bhj\b/gi, "hoje"], [/\bmsm\b/gi, "mesmo"],
    [/\bqdo\b/gi, "quando"], [/\bqto\b/gi, "quanto"], [/\bqts\b/gi, "quantos"],
    [/\bsd[d]?\b/gi, "saudade"], [/\bobg\b/gi, "obrigado"],
  ];
  for (const [re, val] of abbr) t = t.replace(re, val);

  // 6. Acentos obrigatórios — palavras muito comuns sem acento
  const accents: [RegExp, string][] = [
    // preposição "até" (não confunde com verbo "atê" que não existe)
    [/\bate\b/g, "até"],
    // meses
    [/\bjaneiro\b/gi,"janeiro"],[/\bfevereiro\b/gi,"fevereiro"],
    [/\bmarco\b/gi,"março"],[/\babril\b/gi,"abril"],
    [/\bmaio\b/gi,"maio"],[/\bjunho\b/gi,"junho"],
    [/\bjulho\b/gi,"julho"],[/\bagosto\b/gi,"agosto"],
    [/\bsetembro\b/gi,"setembro"],[/\boutubro\b/gi,"outubro"],
    [/\bnovembro\b/gi,"novembro"],[/\bdezembro\b/gi,"dezembro"],
    // "abriu" quando após "de" é provável erro de "abril"
    [/\bde abriu\b/gi,"de abril"],[/\bdo abriu\b/gi,"do abril"],
    [/\baté o abriu\b/gi,"até o abril"],
    // palavras com acento faltando — lista curada
    [/\bnao\b/gi,"não"],[/\bsao\b/gi,"são"],[/\bestao\b/gi,"estão"],
    [/\bvao\b/gi,"vão"],[/\btem\b/gi,"tem"],
    [/\btambem\b/gi,"também"],[/\bvoce\b/gi,"você"],
    [/\bprecisa\b/gi,"precisa"],[/\bpreco\b/gi,"preço"],
    [/\bprecos\b/gi,"preços"],[/\bpromocao\b/gi,"promoção"],
    [/\bpromocoes\b/gi,"promoções"],[/\boferta\b/gi,"oferta"],
    [/\bimperdiveis\b/gi,"imperdíveis"],[/\bimperivel\b/gi,"imperdível"],
    // alimentos e marcas comuns
    [/\bpau de alho\b/gi,"pão de alho"],[/\bpao de alho\b/gi,"pão de alho"],
    [/\bhainekn\b/gi,"Heineken"],[/\bheinekn\b/gi,"Heineken"],[/\bhaineken\b/gi,"Heineken"],
    [/\bcoca cola\b/gi,"Coca-Cola"],[/\bbradesco\b/gi,"Bradesco"],
    [/\bitau\b/gi,"Itaú"],[/\bmagazine luisa\b/gi,"Magazine Luiza"],
    [/\bproximo\b/gi,"próximo"],[/\bpropria\b/gi,"própria"],
    [/\bunicos\b/gi,"únicos"],[/\bunica\b/gi,"única"],
    [/\bpagina\b/gi,"página"],[/\bpublic\b/gi,"públic"],
    [/\bnumero\b/gi,"número"],[/\bnumeros\b/gi,"números"],
    [/\bhistoria\b/gi,"história"],[/\bpratica\b/gi,"prática"],
    [/\brapido\b/gi,"rápido"],[/\brapida\b/gi,"rápida"],
    [/\bfacil\b/gi,"fácil"],[/\bdificil\b/gi,"difícil"],
    [/\buteis\b/gi,"úteis"],[/\butil\b/gi,"útil"],
    [/\bavos\b/gi,"avós"],[/\bavo\b/gi,"avô"],
    [/\bpai\b/gi,"pai"],[/\bmae\b/gi,"mãe"],
    [/\bmas\b(?= \w)/gi,"mas"],[/\bsozinho\b/gi,"sozinho"],
    [/\bdomingo\b/gi,"domingo"],[/\bsabado\b/gi,"sábado"],
    [/\bquarta\b/gi,"quarta"],[/\bterca\b/gi,"terça"],
    [/\bsecao\b/gi,"seção"],[/\bsecoes\b/gi,"seções"],
    [/\bgarantia\b/gi,"garantia"],[/\beconomia\b/gi,"economia"],
    [/\bqualidade\b/gi,"qualidade"],[/\bvariedade\b/gi,"variedade"],
    [/\bpossivel\b/gi,"possível"],[/\bincrivel\b/gi,"incrível"],
    [/\bexclusivo\b/gi,"exclusivo"],[/\blimitado\b/gi,"limitado"],
  ];
  for (const [re, val] of accents) t = t.replace(re, val);

  // 7. Fonética de letras — lê cada letra pelo seu nome em português
  const letraFonetica: Record<string, string> = {
    a:"á", b:"bê", c:"cê", d:"dê", e:"é", f:"éfe", g:"gê", h:"agá",
    i:"í", j:"jota", k:"cá", l:"éle", m:"ême", n:"êne", o:"ó", p:"pê",
    q:"quê", r:"erre", s:"ésse", t:"tê", u:"u", v:"vê", w:"dáblio",
    x:"xis", y:"ípsilon", z:"zê", ç:"cê cedilha",
  };

  // Placas BR antigas: ABC-1234 ou ABC1234
  t = t.replace(/\b([a-záçãõêôâü]{3})[\s-]?(\d{4})\b/gi, (_m, letras, nums) => {
    const ls = letras.toLowerCase().split("").map((l: string) => letraFonetica[l] ?? l).join(" ");
    const ns = nums.split("").map((n: string) => letraFonetica[n] ?? n).join(" ");
    return `${ls} ${ns}`;
  });

  // Placas Mercosul: ABC1D23
  t = t.replace(/\b([a-záçãõêôâü]{3})(\d)([a-záçãõêôâü])(\d{2})\b/gi, (_m, l1, n1, l2, n2) => {
    const spell = (s: string) => s.toLowerCase().split("").map((c: string) => letraFonetica[c] ?? c).join(" ");
    return `${spell(l1)} ${spell(n1)} ${spell(l2)} ${spell(n2)}`;
  });

  // Siglas em maiúsculas (2 a 5 letras) isoladas — ex: CPF, CNPJ, CEP, RG
  t = t.replace(/\b([A-ZÁÇÃÕÊÔÂÜ]{2,5})\b/g, (_m, sigla) => {
    return sigla.toLowerCase().split("").map((l: string) => letraFonetica[l] ?? l).join(" ");
  });

  // 8. Capitalização: primeira letra de cada frase
  t = t.replace(/(^|[.!?]\s+)([a-záéíóúãõâêôàü])/g,
    (_m, sep, letter) => sep + letter.toUpperCase());

  return t;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API key not configured." }, { status: 500 });
  }

  let text: string;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!text?.trim()) {
    return NextResponse.json({ error: "Texto é obrigatório." }, { status: 400 });
  }

  // Passo 1: expansões determinísticas (nunca cortam o texto)
  const expanded = expandForTTS(text.toLowerCase());

  // Passo 2: Gemini só para ortografia — tarefa simples, sem risco de cortar
  const prompt = `Corrija apenas os erros ortográficos do texto abaixo. Não altere nada mais — não mova palavras, não resuma, não adicione, não remova nada. Retorne o texto COMPLETO e idêntico, apenas com as palavras erradas corrigidas.

Texto: "${expanded}"

Responda APENAS com o texto corrigido. Sem aspas. Sem explicações.`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 4096 },
  });

  try {
    let response: Response | null = null;

    for (const model of MODELS) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );
      if (response.ok) break;

      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message ?? "";
      const isModelUnavailable =
        response.status === 404 ||
        msg.includes("no longer available") ||
        msg.includes("not found");

      if (!isModelUnavailable) {
        const status = response.status;
        const friendly =
          status === 429 ? "Cota do Gemini esgotada." :
          status === 403 ? "Chave do Gemini inválida." :
          `Erro Gemini ${status}: ${msg}`;
        return NextResponse.json({ error: friendly }, { status: 502 });
      }
    }

    if (!response || !response.ok) {
      // Gemini falhou — retorna pelo menos com as expansões feitas
      return NextResponse.json({ improved: expanded });
    }

    const data = await response.json();
    const improved = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Se Gemini retornar vazio, menor ou parecer cortado, usa o expandido direto
    if (!improved || improved.length < expanded.length * 0.85) {
      return NextResponse.json({ improved: expanded });
    }

    return NextResponse.json({ improved });
  } catch {
    // Em caso de falha total, retorna o texto com expansões aplicadas
    return NextResponse.json({ improved: expanded });
  }
}
