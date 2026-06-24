import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Geração do cabeçalho do portfólio (v6.0): a IA cria headline + resumo a
// partir das fontes do usuário (LinkedIn + projetos/competências + carreira).
// Groq primário, Gemini fallback.

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

export interface PortfolioGenInput {
  name: string;
  positions: { title: string; company: string; description: string | null }[];
  projects: { title: string; tech: string[]; competencies: string[] }[];
  desiredAreas: string[];
  careerGoals: string | null;
  competencies: string[];
}

export interface PortfolioGenDraft {
  headline: string;
  summary: string;
}

const SYSTEM_PROMPT = `Você escreve o cabeçalho de uma página profissional (portfólio) em português brasileiro.
Regras:
1. Use APENAS os dados fornecidos. NUNCA invente cargos, empresas, números ou anos.
2. "headline": 1 linha curta de posicionamento (ex.: "Analista de Dados · Power BI e Automação").
3. "summary": 1 parágrafo de 2 a 4 frases, em terceira pessoa ou impessoal, destacando trajetória e foco.
4. Sem emojis. Retorne APENAS um objeto JSON válido: {"headline": "...", "summary": "..."}.`;

function buildPrompt(p: PortfolioGenInput): string {
  const lines: string[] = [
    'Gere o cabeçalho do portfólio. Retorne só: {"headline": "...", "summary": "..."}',
    '',
    `Nome: ${p.name}`,
  ];
  if (p.desiredAreas.length) lines.push(`Áreas de interesse: ${p.desiredAreas.join(', ')}`);
  if (p.careerGoals) lines.push(`Objetivo de carreira: ${p.careerGoals}`);
  if (p.competencies.length) lines.push(`Competências: ${p.competencies.slice(0, 12).join(', ')}`);
  if (p.positions.length) {
    lines.push('Experiências:');
    for (const e of p.positions.slice(0, 6)) {
      lines.push(`- ${e.title} @ ${e.company}${e.description ? `: ${e.description}` : ''}`);
    }
  }
  if (p.projects.length) {
    lines.push('Projetos:');
    for (const pr of p.projects.slice(0, 8)) {
      lines.push(`- ${pr.title} [${[...pr.tech, ...pr.competencies].slice(0, 5).join(', ')}]`);
    }
  }
  lines.push('', 'Retorne só o JSON.');
  return lines.join('\n');
}

function parseDraft(raw: string): PortfolioGenDraft {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON do portfólio');
  const parsed = JSON.parse(text.slice(start, end + 1)) as { headline?: unknown; summary?: unknown };
  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!headline && !summary) throw new Error('Cabeçalho vazio');
  return { headline, summary };
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' ||
    msg.includes('vazio') || msg.includes('JSON') || msg.includes('portfólio')
  );
}

async function groqGen(prompt: string): Promise<PortfolioGenDraft> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model, max_tokens: 600, response_format: { type: 'json_object' }, messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou resposta vazia');
      return parseDraft(raw);
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[portfolio/gen/groq] ${model} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiGen(prompt: string): Promise<PortfolioGenDraft> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName, systemInstruction: SYSTEM_PROMPT, generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseDraft(result.response.text());
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[portfolio/gen] Gemini ${modelName} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

/** Gera headline + resumo do portfólio (Groq → Gemini). NÃO persiste. */
export async function generatePortfolioTexts(input: PortfolioGenInput): Promise<PortfolioGenDraft> {
  const prompt = buildPrompt(input);
  try {
    return await groqGen(prompt);
  } catch (err) {
    console.warn(`[portfolio/gen] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiGen(prompt);
  }
}
