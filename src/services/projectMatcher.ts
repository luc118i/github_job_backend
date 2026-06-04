import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProjectMatchJob, ProjectAiMatch } from '../types';

// Match semântico projeto↔vaga (Career Studio M5+). Diferente do match
// determinístico (léxico, no front), aqui a IA lê o README de cada projeto
// e estima a relevância para a vaga considerando TRANSFERÊNCIA de
// competências — capta, por ex., que um sistema operacional demonstra
// "implementação" e "gestão" mesmo sem citar a skill literal.
// Mesmo padrão do messageGenerator: Groq primário, Gemini como fallback.

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

/** Projeto enriquecido com README para a IA avaliar. */
export interface MatchProject {
  id: string;
  title: string;
  description: string;
  tech: string[];
  readme: string | null;
}

const SYSTEM_PROMPT = `Você é um recrutador técnico sênior no Brasil.
Avalia o quanto cada PROJETO do candidato é relevante para uma VAGA específica.
Considere TRANSFERÊNCIA de competências, não só palavras-chave: um projeto pode
demonstrar liderança, gestão, implementação ou análise mesmo sem citar a skill literal.
Leia o README de cada projeto para entender o que ele realmente faz.

Regras:
1. Dê um score de 0 a 100 por projeto (0 = nada a ver, 100 = altamente relevante).
2. "reason": UMA frase curta em português explicando o score, citando o vínculo concreto com a vaga.
3. NÃO invente fatos que não estejam no projeto.
4. Sem emojis. Retorne APENAS um objeto JSON válido.`;

const README_MAX = 1500; // por projeto, dentro do prompt — controla o total de tokens.

function buildPrompt(job: ProjectMatchJob, projects: MatchProject[]): string {
  const shortDesc = job.description.length > 700 ? job.description.slice(0, 700) + '...' : job.description;

  const lines = [
    'Retorne APENAS um JSON no formato:',
    '{"matches": [{"id": "<id>", "score": <0-100>, "reason": "<1 frase>"}]}',
    'Inclua TODOS os projetos listados, usando exatamente o "id" informado.',
    '',
    `VAGA: ${job.title}`,
    `Skills exigidas: ${job.skills.join(', ') || '[não informado]'}`,
    `Descrição: ${shortDesc}`,
    '',
    'PROJETOS:',
  ];

  for (const p of projects) {
    const readme = p.readme ? p.readme.slice(0, README_MAX) : '(sem README)';
    lines.push(
      '---',
      `id: ${p.id}`,
      `título: ${p.title}`,
      `descrição: ${p.description || '(sem descrição)'}`,
      `stack: ${p.tech.join(', ') || '(não informada)'}`,
      `README: ${readme}`,
    );
  }
  lines.push('---', '', 'Retorne só o JSON com o array "matches".');

  return lines.join('\n');
}

/** Faz o parse tolerante do JSON e normaliza os scores para 0-100 inteiros. */
function parseMatches(raw: string, valid: Set<string>): ProjectAiMatch[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON do match');

  const parsed = JSON.parse(text.slice(start, end + 1)) as { matches?: unknown };
  if (!Array.isArray(parsed.matches)) throw new Error('JSON do match sem array "matches"');

  const out: ProjectAiMatch[] = [];
  for (const m of parsed.matches as Record<string, unknown>[]) {
    const id = String(m.id ?? '');
    if (!valid.has(id)) continue; // ignora ids alucinados
    const scoreNum = Number(m.score);
    const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 0;
    const reason = typeof m.reason === 'string' ? m.reason.trim() : '';
    out.push({ id, score, reason });
  }
  if (out.length === 0) throw new Error('Nenhum match válido retornado');
  return out;
}

async function groqMatch(prompt: string, valid: Set<string>): Promise<ProjectAiMatch[]> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
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
      if (!raw.trim()) throw new Error('Groq retornou resposta vazia');
      return parseMatches(raw, valid);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
      const retryable =
        status === 429 || status === 503 || status === 404 ||
        code === 'model_decommissioned' || code === 'model_not_found' ||
        msg.includes('vazia') || msg.includes('vazio') || msg.includes('JSON') || msg.includes('match');
      if (retryable) {
        console.warn(`[match/groq] ${model} falhou (${msg}), tentando próximo modelo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiMatch(prompt: string, valid: Set<string>): Promise<ProjectAiMatch[]> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseMatches(result.response.text(), valid);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const msg = (err as Error).message ?? '';
      const retryable = status === 503 || status === 429 || msg.includes('JSON') || msg.includes('match');
      if (retryable) {
        console.warn(`[match] Gemini ${modelName} falhou (${status ?? msg}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Ranqueia os projetos para a vaga lendo os READMEs (Groq → fallback Gemini).
 * Uma única chamada de IA para todos os projetos (barato). Retorna scores 0-100.
 */
export async function matchProjects(
  job: ProjectMatchJob,
  projects: MatchProject[],
): Promise<ProjectAiMatch[]> {
  if (projects.length === 0) return [];
  const valid = new Set(projects.map((p) => p.id));
  const prompt = buildPrompt(job, projects);
  try {
    return await groqMatch(prompt, valid);
  } catch (err) {
    console.warn(`[match] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiMatch(prompt, valid);
  }
}
