import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageType, MessageDraft, MessageGenRequest } from '../types';

// Gerador de cartas/mensagens (Career Studio M6). Mesmo padrão do cvGenerator:
// Groq como motor primário (loop de modelos) e Gemini como fallback. Aqui a
// saída é TEXTO (JSON {subject, content}), não blocos de CV.

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

const SYSTEM_PROMPT = `Você é um especialista em recrutamento e comunicação profissional no Brasil.
Escreve textos de candidatura persuasivos, naturais e em português brasileiro.
Regras invioláveis:
1. Use APENAS dados reais fornecidos — NUNCA invente experiências, números, empresas ou cursos.
2. Tom profissional, humano e direto — sem clichês vazios nem bajulação exagerada.
3. NUNCA use emojis ou símbolos decorativos.
4. Retorne APENAS um objeto JSON válido (sem cercas de código, sem explicações).`;

// Rótulos e instruções específicas por tipo de mensagem.
const TYPE_SPEC: Record<MessageType, { label: string; instructions: string; withSubject: boolean }> = {
  cover_letter: {
    label: 'Carta de apresentação',
    withSubject: false,
    instructions: `Escreva uma CARTA DE APRESENTAÇÃO formal de 2 a 3 parágrafos curtos.
Conecte a experiência real do candidato às necessidades da vaga, citando 2-3 skills exigidas.
Abra com interesse genuíno na vaga/empresa e feche com disponibilidade para conversar.
"subject" deve ser null.`,
  },
  recruiter_dm: {
    label: 'Mensagem para recrutador',
    withSubject: false,
    instructions: `Escreva uma MENSAGEM CURTA e direta (LinkedIn/WhatsApp), no máximo 4-5 linhas.
Apresente-se em 1 frase, mostre fit com a vaga em 1-2 frases e peça para conversar.
Tom cordial e informal-profissional. "subject" deve ser null.`,
  },
  email: {
    label: 'E-mail de candidatura',
    withSubject: true,
    instructions: `Escreva um E-MAIL de candidatura pronto para enviar com o currículo.
"subject" = assunto objetivo (ex.: "Candidatura - <vaga>"). "content" = corpo com saudação,
2 parágrafos curtos conectando experiência à vaga e encerramento com assinatura do candidato.`,
  },
  follow_up: {
    label: 'Follow-up',
    withSubject: false,
    instructions: `Escreva uma MENSAGEM DE FOLLOW-UP educada para acompanhar uma candidatura/entrevista já feita.
Curta (3-4 linhas), reforça o interesse sem soar insistente e se coloca à disposição.
"subject" deve ser null.`,
  },
};

function buildPrompt(req: MessageGenRequest): string {
  const { type, job, candidate } = req;
  const spec = TYPE_SPEC[type];
  const shortDesc = job.description.length > 500 ? job.description.slice(0, 500) + '...' : job.description;

  const lines = [
    `Gere uma "${spec.label}" e retorne APENAS um objeto JSON {"subject": <string|null>, "content": <string>}.`,
    '',
    spec.instructions,
    '',
    `VAGA: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remoto' : 'Presencial'}`,
    `Skills exigidas: ${job.skills.join(', ') || '[não informado]'}`,
    `Descrição: ${shortDesc}`,
    '',
    `CANDIDATO: ${candidate.name}`,
  ];
  if (candidate.currentRole) lines.push(`Cargo atual/último: ${candidate.currentRole}`);
  if (candidate.skills?.length) lines.push(`Skills do candidato: ${candidate.skills.join(', ')}`);
  if (candidate.bio) lines.push(`Bio: ${candidate.bio}`);
  if (candidate.summary) lines.push(`Resumo profissional: ${candidate.summary}`);
  lines.push('', 'Sem emojis. Sem markdown de títulos. Retorne só o JSON.');

  return lines.join('\n');
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]/gu;

/** Extrai {subject, content} do texto da IA, tolerando cercas ```json. */
function parseDraft(raw: string): MessageDraft {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON da mensagem');

  const parsed = JSON.parse(text.slice(start, end + 1)) as { subject?: unknown; content?: unknown };
  const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  if (!content) throw new Error('Mensagem vazia');

  const subjectRaw = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  return {
    subject: subjectRaw ? subjectRaw.replace(EMOJI_RE, '').trim() : null,
    content: content.replace(EMOJI_RE, '').replace(/[ \t]+$/gm, '').trim(),
  };
}

async function groqMessage(prompt: string): Promise<MessageDraft> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages,
      });
      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou mensagem vazia');
      return parseDraft(raw);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
      const retryable =
        status === 429 || status === 503 || status === 404 ||
        code === 'model_decommissioned' || code === 'model_not_found' ||
        msg.includes('vazia') || msg.includes('vazio') || msg.includes('JSON');
      if (retryable) {
        console.warn(`[msg/groq] ${model} falhou (${msg}), tentando próximo modelo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function geminiMessage(prompt: string): Promise<MessageDraft> {
  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      return parseDraft(result.response.text());
    } catch (err) {
      const status = (err as { status?: number }).status;
      const msg = (err as Error).message ?? '';
      const retryable = status === 503 || status === 429 || msg.includes('JSON') || msg.includes('vazia');
      if (retryable) {
        console.warn(`[msg] Gemini ${modelName} falhou (${status ?? msg}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Gera a mensagem (Groq → fallback Gemini). NÃO persiste. */
export async function generateMessage(req: MessageGenRequest): Promise<MessageDraft> {
  const prompt = buildPrompt(req);
  try {
    return await groqMessage(prompt);
  } catch (err) {
    console.warn(`[msg] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    return geminiMessage(prompt);
  }
}
