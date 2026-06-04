import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  MessageType, MessageDraft, MessageGenRequest,
  MessageTone, MessageLength, MessageLanguage,
} from '../types';

// Gerador de cartas/mensagens (Career Studio M6). Mesmo padrão do cvGenerator:
// Groq como motor primário (loop de modelos) e Gemini como fallback. A saída é
// TEXTO. Suporta controles de tom/tamanho/idioma e gera 1-3 variações.

const geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

// ── Controles de geração ──────────────────────────────────────────
const TONE_PT: Record<MessageTone, string> = {
  formal: 'Tom formal e respeitoso, linguagem profissional e impecável.',
  balanced: 'Tom profissional e humano, nem engessado nem informal demais.',
  casual: 'Tom leve e cordial, próximo e natural, mantendo o profissionalismo.',
};
const TONE_EN: Record<MessageTone, string> = {
  formal: 'Formal, respectful tone with polished professional language.',
  balanced: 'Professional yet human tone — neither stiff nor too casual.',
  casual: 'Light, friendly and natural tone while staying professional.',
};
const LENGTH_PT: Record<MessageLength, string> = {
  short: 'Bem curta: 3 a 4 linhas no total.',
  medium: 'Tamanho médio: 2 parágrafos curtos.',
  long: 'Mais detalhada: 3 parágrafos.',
};
const LENGTH_EN: Record<MessageLength, string> = {
  short: 'Very short: 3-4 lines total.',
  medium: 'Medium length: 2 short paragraphs.',
  long: 'More detailed: 3 paragraphs.',
};

function clampVariations(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(3, Math.round(n)));
}

function systemPrompt(lang: MessageLanguage): string {
  if (lang === 'en') {
    return `You are an expert in recruiting and professional communication.
You write persuasive, natural job-application texts in English.
Hard rules:
1. Use ONLY the real data provided — NEVER invent experiences, numbers, companies or courses.
2. Professional, human and direct — no empty clichés or over-flattery.
3. NEVER use emojis or decorative symbols.
4. Return ONLY a valid JSON object (no code fences, no explanations).`;
  }
  return `Você é um especialista em recrutamento e comunicação profissional no Brasil.
Escreve textos de candidatura persuasivos, naturais e em português brasileiro.
Regras invioláveis:
1. Use APENAS dados reais fornecidos — NUNCA invente experiências, números, empresas ou cursos.
2. Tom profissional, humano e direto — sem clichês vazios nem bajulação exagerada.
3. NUNCA use emojis ou símbolos decorativos.
4. Retorne APENAS um objeto JSON válido (sem cercas de código, sem explicações).`;
}

// Rótulos e instruções específicas por tipo de mensagem (em PT e EN).
const TYPE_SPEC: Record<MessageType, { withSubject: boolean; pt: string; en: string }> = {
  cover_letter: {
    withSubject: false,
    pt: 'Escreva uma CARTA DE APRESENTAÇÃO conectando a experiência real do candidato às necessidades da vaga, citando 2-3 skills exigidas. Abra com interesse genuíno e feche com disponibilidade para conversar. "subject" deve ser null.',
    en: 'Write a COVER LETTER connecting the candidate\'s real experience to the role\'s needs, citing 2-3 required skills. Open with genuine interest and close with availability to talk. "subject" must be null.',
  },
  recruiter_dm: {
    withSubject: false,
    pt: 'Escreva uma MENSAGEM CURTA e direta (LinkedIn/WhatsApp). Apresente-se em 1 frase, mostre fit com a vaga e peça para conversar. "subject" deve ser null.',
    en: 'Write a SHORT, direct MESSAGE (LinkedIn/WhatsApp). Introduce yourself in 1 sentence, show fit with the role and ask to talk. "subject" must be null.',
  },
  email: {
    withSubject: true,
    pt: 'Escreva um E-MAIL de candidatura pronto para enviar com o currículo. "subject" = assunto objetivo. "content" = corpo com saudação, conexão com a vaga e encerramento com assinatura.',
    en: 'Write a job-application EMAIL ready to send with the resume. "subject" = objective subject line. "content" = body with greeting, connection to the role and a closing signature.',
  },
  follow_up: {
    withSubject: false,
    pt: 'Escreva uma MENSAGEM DE FOLLOW-UP educada para acompanhar uma candidatura/entrevista já feita. Reforça o interesse sem soar insistente. "subject" deve ser null.',
    en: 'Write a polite FOLLOW-UP message after an application/interview already done. Reinforce interest without sounding pushy. "subject" must be null.',
  },
};

function buildPrompt(req: MessageGenRequest): string {
  const lang: MessageLanguage = req.language === 'en' ? 'en' : 'pt';
  const tone: MessageTone = req.tone ?? 'balanced';
  const length: MessageLength = req.length ?? 'medium';
  const n = clampVariations(req.variations);
  const { type, job, candidate } = req;
  const spec = TYPE_SPEC[type];
  const shortDesc = job.description.length > 500 ? job.description.slice(0, 500) + '...' : job.description;

  // Schema da resposta: sempre um array "drafts" (1+ itens), mesmo p/ 1 versão.
  const isEn = lang === 'en';
  const lines: string[] = isEn
    ? [
        `Generate ${n} DISTINCT version(s) and return ONLY this JSON: {"drafts": [{"subject": <string|null>, "content": <string>}]}.`,
        `The array MUST have exactly ${n} item(s)${n > 1 ? ', each a meaningfully different version' : ''}.`,
        '',
        spec.en,
        `Tone: ${TONE_EN[tone]}`,
        `Length: ${LENGTH_EN[length]}`,
        '',
        `JOB: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remote' : 'On-site'}`,
        `Required skills: ${job.skills.join(', ') || '[not provided]'}`,
        `Description: ${shortDesc}`,
        '',
        `CANDIDATE: ${candidate.name}`,
      ]
    : [
        `Gere ${n} versão(ões) DISTINTA(S) e retorne APENAS este JSON: {"drafts": [{"subject": <string|null>, "content": <string>}]}.`,
        `O array DEVE ter exatamente ${n} item(ns)${n > 1 ? ', cada um uma versão sensivelmente diferente' : ''}.`,
        '',
        spec.pt,
        `Tom: ${TONE_PT[tone]}`,
        `Tamanho: ${LENGTH_PT[length]}`,
        '',
        `VAGA: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remoto' : 'Presencial'}`,
        `Skills exigidas: ${job.skills.join(', ') || '[não informado]'}`,
        `Descrição: ${shortDesc}`,
        '',
        `CANDIDATO: ${candidate.name}`,
      ];

  if (candidate.currentRole) lines.push(isEn ? `Current/last role: ${candidate.currentRole}` : `Cargo atual/último: ${candidate.currentRole}`);
  if (candidate.skills?.length) lines.push(isEn ? `Candidate skills: ${candidate.skills.join(', ')}` : `Skills do candidato: ${candidate.skills.join(', ')}`);
  if (candidate.bio) lines.push(`Bio: ${candidate.bio}`);
  if (candidate.summary) lines.push(isEn ? `Professional summary: ${candidate.summary}` : `Resumo profissional: ${candidate.summary}`);
  lines.push('', isEn ? 'No emojis. No markdown headings. Return only the JSON.' : 'Sem emojis. Sem markdown de títulos. Retorne só o JSON.');

  return lines.join('\n');
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]/gu;

function cleanDraft(subjectRaw: unknown, contentRaw: unknown): MessageDraft | null {
  const content = typeof contentRaw === 'string' ? contentRaw.replace(EMOJI_RE, '').replace(/[ \t]+$/gm, '').trim() : '';
  if (!content) return null;
  const subject = typeof subjectRaw === 'string' ? subjectRaw.replace(EMOJI_RE, '').trim() : '';
  return { subject: subject || null, content };
}

/** Extrai os drafts do texto da IA (array "drafts" ou objeto único), tolerando ```json. */
function parseDrafts(raw: string): MessageDraft[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON da mensagem');

  const parsed = JSON.parse(text.slice(start, end + 1)) as { drafts?: unknown; subject?: unknown; content?: unknown };

  let items: { subject?: unknown; content?: unknown }[];
  if (Array.isArray(parsed.drafts)) items = parsed.drafts as { subject?: unknown; content?: unknown }[];
  else items = [{ subject: parsed.subject, content: parsed.content }]; // fallback: objeto único

  const drafts = items.map((d) => cleanDraft(d.subject, d.content)).filter((d): d is MessageDraft => d !== null);
  if (drafts.length === 0) throw new Error('Mensagem vazia');
  return drafts;
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' ||
    msg.includes('vazia') || msg.includes('vazio') || msg.includes('JSON')
  );
}

async function groqMessage(prompt: string, system: string): Promise<MessageDraft[]> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];

  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou mensagem vazia');
      return parseDrafts(raw);
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[msg/groq] ${model} falhou (${(err as Error).message}), tentando próximo modelo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiMessage(prompt: string, system: string): Promise<MessageDraft[]> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: system,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseDrafts(result.response.text());
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[msg] Gemini ${modelName} falhou, tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Gera 1-3 variações da mensagem (Groq → fallback Gemini). NÃO persiste. */
export async function generateMessage(req: MessageGenRequest): Promise<MessageDraft[]> {
  const system = systemPrompt(req.language === 'en' ? 'en' : 'pt');
  const prompt = buildPrompt(req);
  try {
    return await groqMessage(prompt, system);
  } catch (err) {
    console.warn(`[msg] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiMessage(prompt, system);
  }
}
