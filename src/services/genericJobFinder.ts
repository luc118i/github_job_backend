import Anthropic from '@anthropic-ai/sdk';
import { LinkedInPosition, LinkedInEducation, ProfessionSearchResult } from '../types';
import { findProfessionJobsGemini } from './gemini';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WEB_SEARCH_BETA = 'web-search-2025-03-05';

function formatPositions(positions: LinkedInPosition[]): string {
  if (!positions.length) return 'Sem experiência';
  return positions.slice(0, 3).map((p) => {
    const end = p.finishedOn ?? 'atual';
    return `${p.title}, ${p.company} (${p.startedOn}–${end})`;
  }).join('; ');
}

function formatEducation(education: LinkedInEducation[]): string {
  if (!education.length) return 'Sem formação';
  return education.slice(0, 2).map((e) =>
    `${e.degree ?? 'Curso'}, ${e.school}${e.endDate ? ` ${e.endDate}` : ''}`
  ).join('; ');
}

const RETURN_JOBS_TOOL: Anthropic.Tool = {
  name: 'return_jobs',
  description: 'Retorna as vagas encontradas. Sempre chame esta função ao final com todas as vagas pesquisadas.',
  input_schema: {
    type: 'object' as const,
    required: ['profileSummary', 'jobs'],
    properties: {
      profileSummary: {
        type: 'string',
        description: 'Resumo do perfil: "Profissão | Nível | Destaque principal"',
      },
      jobs: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['title', 'company', 'level', 'remote', 'tags', 'description', 'match'],
          properties: {
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'], description: 'Cidade/estado ou "Remoto" ou "Híbrido - Cidade, UF"' },
            tags:        { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            salary:      { type: ['string', 'null'] },
            link:        { type: ['string', 'null'] },
            match:       { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
  },
};

async function findProfessionJobsClaude(
  positions: LinkedInPosition[],
  education: LinkedInEducation[]
): Promise<ProfessionSearchResult> {
  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: 'Você é um especialista em recrutamento para todas as áreas profissionais. Use web_search para encontrar vagas reais e chame return_jobs com os resultados.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `Pesquise 6 vagas reais compatíveis com o perfil abaixo no LinkedIn, Catho ou InfoJobs. Depois chame return_jobs com os resultados.

Experiência: ${formatPositions(positions)}
Formação: ${formatEducation(education)}`,
        },
      ],
    },
    { headers: { 'anthropic-beta': WEB_SEARCH_BETA } }
  );

  const toolBlock = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'return_jobs'
  );

  if (!toolBlock) {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    console.error('[profession] Claude não chamou return_jobs. Resposta:', text.slice(0, 400));
    throw new Error('Claude não retornou vagas estruturadas');
  }

  const result = toolBlock.input as ProfessionSearchResult;
  return {
    profileSummary: result.profileSummary ?? '',
    jobs: Array.isArray(result.jobs) ? result.jobs : [],
  };
}

export async function findProfessionJobs(
  positions: LinkedInPosition[],
  education: LinkedInEducation[]
): Promise<ProfessionSearchResult> {
  try {
    return await findProfessionJobsClaude(positions, education);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.warn('[profession] Claude rate limit, switching to Gemini...');
      return findProfessionJobsGemini(positions, education);
    }
    throw err;
  }
}
