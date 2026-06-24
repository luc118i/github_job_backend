import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Enriquecimento de projeto (Biblioteca v5.0): a IA detecta as competências
// profissionais demonstradas pelo projeto (a partir de título, stack e README)
// e calculamos um Portfolio Score heurístico (0-100). Groq → fallback Gemini.

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

export interface EnrichInput {
  title: string;
  description: string;
  tech: string[];
  readme: string | null;
}

const SYSTEM_PROMPT = `Você analisa projetos de software e identifica as COMPETÊNCIAS PROFISSIONAIS que eles demonstram.
Competências são habilidades de mercado (ex.: "Arquitetura Frontend", "APIs REST", "Modelagem de Dados",
"CI/CD", "Gestão de Estado"), não apenas nomes de tecnologia. Em português brasileiro.
Regras:
1. Baseie-se APENAS no que o projeto evidencia (título, stack, README). Não invente.
2. Gere de 5 a 8 competências curtas (2-3 palavras cada).
3. Retorne APENAS um objeto JSON válido: {"competencies": ["..."]}.`;

function buildPrompt(p: EnrichInput): string {
  const readme = p.readme ? p.readme.slice(0, 1800) : '(sem README)';
  return [
    'Liste as competências profissionais demonstradas por este projeto.',
    'Retorne só: {"competencies": ["...", "..."]}',
    '',
    `Título: ${p.title}`,
    `Stack: ${p.tech.join(', ') || '(não informada)'}`,
    `Descrição: ${p.description || '(sem descrição)'}`,
    `README: ${readme}`,
  ].join('\n');
}

function sliceJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON das competências');
  return text.slice(start, end + 1);
}

function parseCompetencies(raw: string): string[] {
  const parsed = JSON.parse(sliceJson(raw)) as { competencies?: unknown };
  if (!Array.isArray(parsed.competencies)) throw new Error('JSON sem array competencies');
  const out = parsed.competencies.map((c) => String(c).trim()).filter(Boolean).slice(0, 8);
  if (out.length === 0) throw new Error('Nenhuma competência válida');
  return out;
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' ||
    msg.includes('vazia') || msg.includes('JSON') || msg.includes('competência')
  );
}

async function groqCompetencies(prompt: string): Promise<string[]> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model, max_tokens: 512, response_format: { type: 'json_object' }, messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou resposta vazia');
      return parseCompetencies(raw);
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[enrich/groq] ${model} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiCompetencies(prompt: string): Promise<string[]> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName, systemInstruction: SYSTEM_PROMPT, generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseCompetencies(result.response.text());
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[enrich] Gemini ${modelName} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

// Skills mais pedidas no mercado (proxy de "relevância de mercado" do score).
const IN_DEMAND = new Set([
  'react', 'typescript', 'javascript', 'node', 'nodejs', 'python', 'java', 'sql',
  'aws', 'docker', 'kubernetes', 'next', 'nextjs', 'postgres', 'postgresql', 'mongodb',
  'redis', 'graphql', 'tailwind', 'go', 'golang', 'rust', 'kotlin', 'swift', 'flutter',
  'spring', 'django', 'express', 'ci/cd', 'git', 'rest', 'api',
]);

/**
 * Portfolio Score 0-100 (heurística ponderada, sem IA):
 * complexidade 30 + diversidade de stack 20 + relevância de mercado 25 +
 * documentação 10 + atividade 15.
 */
export function computePortfolioScore(p: EnrichInput, competencies: string[]): number {
  const techCount = p.tech.length;
  const readmeLen = (p.readme ?? '').length;

  // Complexidade (30): mistura de stack + tamanho do README + nº de competências.
  const complexity = Math.min(30, techCount * 3 + Math.min(12, readmeLen / 250) + Math.min(8, competencies.length * 1.2));

  // Diversidade de stack (20).
  const diversity = Math.min(20, techCount * 4);

  // Relevância de mercado (25): proporção da stack que está em alta demanda.
  const norm = (s: string) => s.toLowerCase().trim();
  const inDemand = p.tech.filter((t) => IN_DEMAND.has(norm(t))).length;
  const market = techCount ? Math.round((inDemand / techCount) * 25) : 0;

  // Documentação (10): README presente e com corpo.
  const docs = readmeLen > 1200 ? 10 : readmeLen > 300 ? 6 : readmeLen > 0 ? 3 : 0;

  // Atividade (15): sem data de commit aqui; baseline moderado.
  const activity = 10;

  return Math.max(0, Math.min(100, Math.round(complexity + diversity + market + docs + activity)));
}

/** Gera competências (Groq → Gemini) e calcula o score. */
export async function enrichProject(input: EnrichInput): Promise<{ competencies: string[]; score: number }> {
  const prompt = buildPrompt(input);
  let competencies: string[];
  try {
    competencies = await groqCompetencies(prompt);
  } catch (err) {
    console.warn(`[enrich] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    competencies = await geminiCompetencies(prompt);
  }
  const score = computePortfolioScore(input, competencies);
  return { competencies, score };
}
