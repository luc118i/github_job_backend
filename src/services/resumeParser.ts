import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { LinkedInData } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Lazy init — evita instanciar antes do .env ser carregado (mesmo padrão de groq.ts)
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

function normalize(parsed: Partial<LinkedInData>): LinkedInData {
  return {
    name: parsed.name ?? null,
    email: parsed.email ?? null,
    phone: parsed.phone ?? null,
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
  };
}

const RESUME_PROMPT = (text: string) => `Extraia dados do currículo abaixo. Retorne APENAS JSON válido, sem markdown:
{
  "name": "Nome Completo ou null",
  "email": "email@exemplo.com ou null",
  "phone": "+55 11 99999-9999 ou null",
  "positions": [
    {"company": "string", "title": "string", "description": "string|null", "location": "string|null", "startedOn": "string", "finishedOn": "string|null"}
  ],
  "education": [
    {"school": "string", "degree": "string|null (ex: Tecnólogo, Bacharelado)", "fieldOfStudy": "string|null (ex: Análise e Desenvolvimento de Sistemas)", "startDate": "string|null", "endDate": "string|null", "notes": "string|null"}
  ],
  "certifications": [
    {"name": "string", "authority": "string|null", "licenseNumber": "string|null", "startedOn": "string|null", "finishedOn": "string|null"}
  ]
}

finishedOn null = emprego atual ou sem expiração. Retorne null para campos não encontrados. Retorne arrays vazios se não encontrar dados. Inclua aprovações em exames profissionais (OAB, CRM, CREA, CRC, CFA, etc.) no campo certifications.

TEXTO DO CURRÍCULO:
${text.slice(0, 6000)}`;

async function parseResumeClaude(text: string): Promise<LinkedInData> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: RESUME_PROMPT(text) }],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const clean = raw.replace(/```json|```/g, '').trim();
  return normalize(JSON.parse(clean) as Partial<LinkedInData>);
}

const EXTRACT_RESUME_TOOL: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_resume',
    description: 'Estrutura os dados extraídos do currículo.',
    parameters: {
      type: 'object',
      required: ['positions', 'education', 'certifications'],
      properties: {
        name: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        positions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              title: { type: 'string' },
              description: { type: ['string', 'null'] },
              location: { type: ['string', 'null'] },
              startedOn: { type: 'string' },
              finishedOn: { type: ['string', 'null'] },
            },
          },
        },
        education: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              school: { type: 'string' },
              degree: { type: ['string', 'null'] },
              fieldOfStudy: { type: ['string', 'null'] },
              startDate: { type: ['string', 'null'] },
              endDate: { type: ['string', 'null'] },
              notes: { type: ['string', 'null'] },
            },
          },
        },
        certifications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              authority: { type: ['string', 'null'] },
              licenseNumber: { type: ['string', 'null'] },
              startedOn: { type: ['string', 'null'] },
              finishedOn: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
};

async function parseResumeGroq(text: string): Promise<LinkedInData> {
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: RESUME_PROMPT(text) }],
        tools: [EXTRACT_RESUME_TOOL],
        tool_choice: { type: 'function', function: { name: 'extract_resume' } },
      });

      const toolCall = response.choices[0]?.message.tool_calls?.find(
        (tc) => tc.function.name === 'extract_resume'
      );
      if (!toolCall) throw new Error('Groq não retornou extract_resume');

      return normalize(JSON.parse(toolCall.function.arguments) as Partial<LinkedInData>);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || status === 503 || status === 404 || msg.includes('JSON') || msg.includes('extract_resume');
      if (retryable) {
        console.warn(`[resume/groq] ${model} falhou (${msg}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Extrai dados estruturados de currículo a partir de texto puro — funciona com
 *  qualquer formato de origem (PDF de currículo, LinkedIn, texto colado, etc.).
 *  Motor primário: Claude. Se falhar (quota, crédito, indisponibilidade), cai pro Groq. */
export async function parseResumeText(text: string): Promise<LinkedInData> {
  try {
    return await parseResumeClaude(text);
  } catch (err) {
    console.warn(`[resume] Claude falhou (${(err as Error).message}), tentando Groq...`);
    return parseResumeGroq(text);
  }
}
