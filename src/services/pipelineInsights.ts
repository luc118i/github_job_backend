import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PipelineInsightItem, PipelineInsights, PipelineTopChance } from '../types';

// IA Insights do Pipeline (MVC v4.0 F5). A IA analisa o histórico de
// candidaturas (etapa + dias parados + skills) e devolve padrões: vagas com
// maior chance de retorno, áreas que mais/menos retornam e a ação recomendada.
// Mesmo padrão dos outros geradores: Groq primário, Gemini como fallback.

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

const SYSTEM_PROMPT = `Você é um analista de carreira no Brasil que lê o pipeline de candidaturas de uma pessoa
e identifica padrões acionáveis. Escreve em português brasileiro, direto e prático.

Semântica das etapas (funil): salvas → preparar → aplicadas → em_analise → entrevista → proposta → contratado.
RETORNO POSITIVO = a candidatura avançou de "aplicadas" (em_analise, entrevista, proposta, contratado).
SEM RETORNO = parada em "aplicadas" há muitos dias.

Regras:
1. Baseie-se APENAS nos dados fornecidos. Não invente empresas ou números.
2. "topChances": até 3 vagas com maior probabilidade de retorno, score 0-100 e razão curta.
3. "positiveAreas"/"negativeAreas": áreas/temas (das skills/títulos) com mais e menos retorno.
4. "recommendedAction": UMA ação concreta e imediata (1 frase).
5. Sem emojis. Retorne APENAS um objeto JSON válido.`;

function buildPrompt(items: PipelineInsightItem[]): string {
  const lines = [
    'Analise o pipeline abaixo e retorne APENAS este JSON:',
    '{"topChances":[{"label":"<empresa/vaga>","score":<0-100>,"reason":"<1 frase>"}],"positiveAreas":["..."],"negativeAreas":["..."],"recommendedAction":"<1 frase>"}',
    '',
    'CANDIDATURAS:',
  ];
  for (const it of items) {
    lines.push(`- ${it.title} @ ${it.company} | etapa: ${it.status} | ${it.days}d na etapa | skills: ${it.skills.join(', ') || '—'}`);
  }
  lines.push('', 'Retorne só o JSON.');
  return lines.join('\n');
}

function sliceJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON dos insights');
  return text.slice(start, end + 1);
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [];
}

function parseInsights(raw: string): PipelineInsights {
  const p = JSON.parse(sliceJson(raw)) as Record<string, unknown>;

  const topChances: PipelineTopChance[] = Array.isArray(p.topChances)
    ? (p.topChances as Record<string, unknown>[]).map((c) => {
        const scoreNum = Number(c.score);
        return {
          label: typeof c.label === 'string' ? c.label.trim() : '',
          score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 0,
          reason: typeof c.reason === 'string' ? c.reason.trim() : '',
        };
      }).filter((c) => c.label).slice(0, 3)
    : [];

  return {
    topChances,
    positiveAreas: strList(p.positiveAreas),
    negativeAreas: strList(p.negativeAreas),
    recommendedAction: typeof p.recommendedAction === 'string' ? p.recommendedAction.trim() : '',
  };
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' ||
    msg.includes('vazia') || msg.includes('JSON') || msg.includes('insights')
  );
}

async function groqInsights(prompt: string): Promise<PipelineInsights> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model, max_tokens: 1024, response_format: { type: 'json_object' }, messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou resposta vazia');
      return parseInsights(raw);
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[insights/groq] ${model} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiInsights(prompt: string): Promise<PipelineInsights> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName, systemInstruction: SYSTEM_PROMPT, generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseInsights(result.response.text());
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[insights] Gemini ${modelName} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

/** Gera os insights do pipeline (Groq → fallback Gemini). */
export async function generatePipelineInsights(items: PipelineInsightItem[]): Promise<PipelineInsights> {
  const prompt = buildPrompt(items);
  try {
    return await groqInsights(prompt);
  } catch (err) {
    console.warn(`[insights] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiInsights(prompt);
  }
}
