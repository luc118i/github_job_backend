import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PortfolioData } from '../types';

// "Pergunte sobre mim" (Portfólio v6.0): um chat onde o recrutador pergunta
// sobre o candidato e a IA responde com base APENAS no perfil público.
// Groq como motor primário, Gemini como fallback (padrão do projeto).

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

export interface PortfolioChatTurn {
  role: 'recruiter' | 'ai';
  content: string;
}

function systemPrompt(name: string): string {
  return `Você é um assistente que responde perguntas de RECRUTADORES sobre ${name}, com base EXCLUSIVAMENTE no perfil fornecido abaixo.
Regras:
1. Responda em português brasileiro, de forma direta — 1 a 3 frases.
2. Use SOMENTE as informações do perfil. Se não houver a informação, diga que o perfil não traz esse dado.
3. Seja específico e cite evidências (projeto, experiência) quando possível.
4. Nunca invente números, empresas ou experiências.
5. Fale de ${name} na terceira pessoa. Sem emojis.`;
}

function buildContext(p: PortfolioData): string {
  const lines: string[] = [`PERFIL DE ${p.name.toUpperCase()}`];
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.summary) lines.push(`Resumo: ${p.summary}`);
  const r = p.recruiter;
  const rec = [
    r.level && `nível ${r.level}`, r.area && `área ${r.area}`, r.location && `local ${r.location}`,
    r.remote && r.remote, r.salary && `pretensão ${r.salary}`,
  ].filter(Boolean).join(' · ');
  if (rec) lines.push(`Resumo profissional: ${rec}`);
  if (p.competencies.length) lines.push(`Competências: ${p.competencies.join(', ')}`);
  if (p.projects.length) {
    lines.push('Projetos:');
    for (const pr of p.projects.slice(0, 10)) {
      const det = [pr.tech.join(', '), pr.competencies.join(', ')].filter(Boolean).join(' | ');
      lines.push(`- ${pr.title}: ${pr.description || '(sem descrição)'}${det ? ` [${det}]` : ''}${pr.highlights?.length ? ` Resultados: ${pr.highlights.join('; ')}` : ''}`);
    }
  }
  if (p.positions.length) {
    lines.push('Experiências:');
    for (const e of p.positions.slice(0, 8)) {
      lines.push(`- ${e.title} @ ${e.company} (${e.startedOn ?? ''}${e.finishedOn ? ` - ${e.finishedOn}` : ' - atual'})${e.description ? `: ${e.description}` : ''}`);
    }
  }
  if (p.education.length) {
    lines.push('Formação: ' + p.education.map((ed) => `${ed.degree ?? ''} ${ed.school}`.trim()).join('; '));
  }
  if (p.certifications.length) {
    lines.push('Certificações: ' + p.certifications.map((c) => c.name).join('; '));
  }
  return lines.join('\n');
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  const status = (err as { status?: number }).status;
  const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
  return (
    status === 429 || status === 503 || status === 404 ||
    code === 'model_decommissioned' || code === 'model_not_found' || msg.includes('vazia')
  );
}

function mapHistory(history: PortfolioChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  return history.slice(-8).map((t) => ({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.content }));
}

async function groqAsk(name: string, context: string, history: PortfolioChatTurn[], question: string): Promise<string> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(name) },
    { role: 'system', content: context },
    ...mapHistory(history),
    { role: 'user', content: question },
  ];
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({ model, max_tokens: 300, messages });
      const text = response.choices[0]?.message.content?.trim() ?? '';
      if (!text) throw new Error('Groq retornou resposta vazia');
      return text;
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[portfolio/ask/groq] ${model} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiAsk(name: string, context: string, history: PortfolioChatTurn[], question: string): Promise<string> {
  const contents = [
    ...mapHistory(history).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: question }] },
  ];
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({ model: modelName, systemInstruction: `${systemPrompt(name)}\n\n${context}` });
      const result = await model.generateContent({ contents });
      const text = result.response.text().trim();
      if (!text) throw new Error('Gemini retornou resposta vazia');
      return text;
    } catch (err) {
      if (isRetryable(err)) { console.warn(`[portfolio/ask] Gemini ${modelName} falhou, tentando próximo...`); lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

/** Responde uma pergunta do recrutador sobre o candidato (Groq → Gemini). */
export async function askAboutCandidate(profile: PortfolioData, question: string, history: PortfolioChatTurn[]): Promise<string> {
  const context = buildContext(profile);
  try {
    return await groqAsk(profile.name, context, history, question);
  } catch (err) {
    console.warn(`[portfolio/ask] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiAsk(profile.name, context, history, question);
  }
}
