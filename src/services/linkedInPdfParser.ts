// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfModule = require('pdf-parse');
const pdf = (pdfModule.default ?? pdfModule) as (buf: Buffer) => Promise<{ text: string }>;
import Anthropic from '@anthropic-ai/sdk';
import { LinkedInData } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function parseLinkedInPdf(buffer: Buffer): Promise<LinkedInData> {
  const { text } = await pdf(buffer);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Extraia dados do perfil LinkedIn abaixo. Retorne APENAS JSON válido, sem markdown:
{
  "name": "Nome Completo ou null",
  "email": "email@exemplo.com ou null",
  "phone": "+55 11 99999-9999 ou null",
  "positions": [
    {"company": "string", "title": "string", "description": "string|null", "location": "string|null", "startedOn": "string", "finishedOn": "string|null"}
  ],
  "education": [
    {"school": "string", "degree": "string|null", "startDate": "string|null", "endDate": "string|null", "notes": "string|null"}
  ]
}

finishedOn null = emprego atual. Retorne null para campos não encontrados. Retorne arrays vazios se não encontrar dados.

TEXTO DO PDF:
${text.slice(0, 4000)}`,
      },
    ],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as LinkedInData;

  return {
    name: (parsed.name as string | null | undefined) ?? null,
    email: (parsed.email as string | null | undefined) ?? null,
    phone: (parsed.phone as string | null | undefined) ?? null,
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
  };
}
