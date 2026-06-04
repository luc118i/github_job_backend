import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  InterviewGenRequest,
  InterviewPrepDraft,
  InterviewQuestion,
  InterviewQCategory,
  InterviewChatRequest,
  InterviewJob,
  InterviewCandidate,
} from '../types';

// Interview Studio (Career Studio M7). Dois modos, ambos Groq → Gemini:
//  • generatePrep: gera perguntas prováveis (técnicas + comportamentais) com
//    resposta sugerida em STAR + perguntas para o candidato fazer ao recrutador.
//  • simulateReply: a IA atua como ENTREVISTADOR num chat, faz uma pergunta por
//    vez e dá feedback curto da resposta anterior.

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

// ── Contexto compartilhado ────────────────────────────────────────
function jobBlock(job: InterviewJob): string {
  const desc = job.description.length > 600 ? job.description.slice(0, 600) + '...' : job.description;
  return [
    `VAGA: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remoto' : 'Presencial'}`,
    `Skills exigidas: ${job.skills.join(', ') || '[não informado]'}`,
    `Descrição: ${desc}`,
  ].join('\n');
}

function candidateBlock(c: InterviewCandidate): string {
  const lines = [`CANDIDATO: ${c.name}`];
  if (c.currentRole) lines.push(`Cargo atual/último: ${c.currentRole}`);
  if (c.skills?.length) lines.push(`Skills: ${c.skills.join(', ')}`);
  if (c.projects?.length) lines.push(`Projetos: ${c.projects.join('; ')}`);
  if (c.bio) lines.push(`Bio: ${c.bio}`);
  if (c.summary) lines.push(`Resumo: ${c.summary}`);
  return lines.join('\n');
}

// ── 1) Geração da preparação ──────────────────────────────────────
const PREP_SYSTEM = `Você é um coach de carreira e entrevistador técnico sênior no Brasil.
Prepara candidatos para entrevistas de forma realista e prática, em português brasileiro.
Regras:
1. Use APENAS dados reais fornecidos do candidato — NUNCA invente experiências, números ou empresas.
2. As respostas sugeridas devem seguir o método STAR (Situação, Tarefa, Ação, Resultado), em 1 parágrafo natural.
3. Sem emojis. Sem markdown de títulos.
4. Retorne APENAS um objeto JSON válido.`;

function buildPrepPrompt(req: InterviewGenRequest): string {
  return [
    'Gere uma preparação de entrevista e retorne APENAS este JSON:',
    '{"questions": [{"category": "tecnica"|"comportamental", "question": "<pergunta>", "suggestedAnswer": "<resposta STAR>"}], "recruiterQuestions": ["<pergunta p/ o recrutador>"]}',
    '',
    'Inclua de 6 a 8 perguntas prováveis, misturando técnicas (sobre as skills/contexto da vaga) e comportamentais.',
    'Para cada uma, escreva uma resposta sugerida em STAR baseada no perfil REAL do candidato abaixo.',
    'Inclua de 3 a 5 perguntas inteligentes que o candidato pode fazer ao recrutador.',
    '',
    jobBlock(req.job),
    '',
    candidateBlock(req.candidate),
    '',
    'Retorne só o JSON.',
  ].join('\n');
}

const VALID_CAT = new Set<InterviewQCategory>(['tecnica', 'comportamental']);

function sliceJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON da preparação');
  return text.slice(start, end + 1);
}

function parsePrep(raw: string): InterviewPrepDraft {
  const parsed = JSON.parse(sliceJson(raw)) as { questions?: unknown; recruiterQuestions?: unknown };

  const questions: InterviewQuestion[] = Array.isArray(parsed.questions)
    ? (parsed.questions as Record<string, unknown>[])
        .map((q) => {
          const catRaw = String(q.category ?? '').toLowerCase().trim();
          const category: InterviewQCategory = VALID_CAT.has(catRaw as InterviewQCategory)
            ? (catRaw as InterviewQCategory)
            : 'comportamental';
          return {
            category,
            question: typeof q.question === 'string' ? q.question.trim() : '',
            suggestedAnswer: typeof q.suggestedAnswer === 'string' ? q.suggestedAnswer.trim() : '',
          };
        })
        .filter((q) => q.question)
    : [];

  const recruiterQuestions: string[] = Array.isArray(parsed.recruiterQuestions)
    ? (parsed.recruiterQuestions as unknown[]).map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (questions.length === 0) throw new Error('Preparação sem perguntas válidas');
  return { questions, recruiterQuestions };
}

async function groqPrep(prompt: string): Promise<InterviewPrepDraft> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: PREP_SYSTEM },
    { role: 'user', content: prompt },
  ];
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou resposta vazia');
      return parsePrep(raw);
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[interview/groq] ${model} falhou (${(err as Error).message}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiPrep(prompt: string): Promise<InterviewPrepDraft> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: PREP_SYSTEM,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parsePrep(result.response.text());
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[interview] Gemini ${modelName} falhou, tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Gera a preparação (Groq → fallback Gemini). NÃO persiste. */
export async function generatePrep(req: InterviewGenRequest): Promise<InterviewPrepDraft> {
  const prompt = buildPrepPrompt(req);
  try {
    return await groqPrep(prompt);
  } catch (err) {
    console.warn(`[interview] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiPrep(prompt);
  }
}

// ── 2) Simulação interativa (chat) ────────────────────────────────
const SIM_SYSTEM = `Você é um ENTREVISTADOR profissional conduzindo uma entrevista de emprego em português brasileiro.
Comporte-se como um entrevistador humano e realista para a vaga e o candidato informados.
Regras:
1. Faça UMA pergunta por vez. Comece se apresentando em 1 frase e fazendo a primeira pergunta.
2. A partir da 2ª interação, dê um feedback curto (1-2 frases) sobre a resposta anterior do candidato e então faça a próxima pergunta.
3. Misture perguntas técnicas e comportamentais ligadas à vaga.
4. Tom profissional e cordial. Sem emojis. Responda em texto corrido (sem JSON, sem markdown de títulos).
5. Seja conciso: no máximo um parágrafo curto por turno.`;

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' ||
    msg.includes('vazia') || msg.includes('vazio') || msg.includes('JSON') || msg.includes('preparação')
  );
}

function buildSimContext(req: InterviewChatRequest): string {
  return [
    'Conduza a entrevista para o contexto abaixo.',
    '',
    jobBlock(req.job),
    '',
    candidateBlock(req.candidate),
  ].join('\n');
}

async function groqSim(req: InterviewChatRequest): Promise<string> {
  // Mapeia os papéis do nosso domínio para os da API: entrevistador=assistant, candidato=user.
  const history: Groq.Chat.ChatCompletionMessageParam[] = req.history.map((t) => ({
    role: t.role === 'interviewer' ? 'assistant' : 'user',
    content: t.content,
  }));
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SIM_SYSTEM },
    { role: 'system', content: buildSimContext(req) },
    ...history,
    // Sem histórico, instrui a IA a abrir a entrevista.
    ...(history.length === 0
      ? [{ role: 'user' as const, content: 'Comece a entrevista.' }]
      : []),
  ];

  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({ model, max_tokens: 400, messages });
      const text = response.choices[0]?.message.content?.trim() ?? '';
      if (!text) throw new Error('Groq retornou resposta vazia');
      return text;
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[interview/sim/groq] ${model} falhou, tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiSim(req: InterviewChatRequest): Promise<string> {
  const contents = req.history.map((t) => ({
    role: t.role === 'interviewer' ? 'model' : 'user',
    parts: [{ text: t.content }],
  }));
  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Comece a entrevista.' }] });

  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: `${SIM_SYSTEM}\n\n${buildSimContext(req)}`,
      });
      const result = await model.generateContent({ contents });
      const text = result.response.text().trim();
      if (!text) throw new Error('Gemini retornou resposta vazia');
      return text;
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[interview/sim] Gemini ${modelName} falhou, tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Próximo turno do entrevistador (Groq → fallback Gemini). Efêmero. */
export async function simulateReply(req: InterviewChatRequest): Promise<string> {
  try {
    return await groqSim(req);
  } catch (err) {
    console.warn(`[interview/sim] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiSim(req);
  }
}
