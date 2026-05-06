import Anthropic from '@anthropic-ai/sdk';
import { Job, JobSearchRequest, UserPreferences } from '../types';
import { findJobsGemini } from './gemini';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WEB_SEARCH_BETA = 'web-search-2025-03-05';

function buildPreferencesSummary(prefs: UserPreferences | undefined): string {
  if (!prefs) return '';
  const lines: string[] = [];
  const modalityLabel: Record<string, string> = {
    remote: 'Remoto', presencial: 'Presencial', hybrid: 'Híbrido', any: '',
  };
  if (prefs.modality !== 'any') lines.push(`Modalidade: ${modalityLabel[prefs.modality]}`);
  if (prefs.location) lines.push(`Local preferido: ${prefs.location}`);
  if (prefs.salaryMin || prefs.salaryMax) {
    const range = [prefs.salaryMin && `R$ ${prefs.salaryMin}`, prefs.salaryMax && `R$ ${prefs.salaryMax}`].filter(Boolean).join(' – ');
    lines.push(`Faixa salarial: ${range}`);
  }
  if (prefs.level !== 'any') lines.push(`Nível desejado: ${prefs.level}`);
  if (!lines.length) return '';
  return '\n\nPREFERÊNCIAS DO CANDIDATO (priorize vagas que atendam):\n' + lines.join('\n');
}

function buildProfileSummary(profile: JobSearchRequest): string {
  const lines = [
    profile.username ? `GitHub: ${profile.username}` : null,
    `Nome: ${profile.name}`,
    profile.bio ? `Bio: ${profile.bio}` : null,
    profile.skills.length > 0
      ? `Linguagens principais: ${profile.skills.slice(0, 6).join(', ')}`
      : null,
    profile.topRepos.length > 0
      ? `Repositórios em destaque: ${profile.topRepos.join(', ')}`
      : null,
    profile.followers ? `Seguidores GitHub: ${profile.followers}` : null,
  ];
  return lines.filter(Boolean).join('\n') + buildPreferencesSummary(profile.preferences);
}

const RETURN_JOBS_TOOL: Anthropic.Tool = {
  name: 'return_jobs',
  description: 'Retorna as vagas encontradas. Sempre chame esta função ao final com todas as vagas pesquisadas.',
  input_schema: {
    type: 'object' as const,
    required: ['jobs'],
    properties: {
      jobs: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['title', 'company', 'level', 'remote', 'skills', 'description', 'link'],
          properties: {
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'], description: 'Cidade/estado ou "Remoto" ou "Híbrido - Cidade, UF"' },
            skills:      { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            salary:      { type: ['string', 'null'] },
            link:        { type: 'string', description: 'URL exata da página de candidatura encontrada via web_search. Obrigatório — copie o link diretamente do resultado da pesquisa.' },
          },
        },
      },
    },
  },
};

async function findJobsClaude(profile: JobSearchRequest): Promise<Job[]> {
  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'Você é um especialista em recrutamento tech. Use web_search para encontrar vagas reais com suas URLs de candidatura. Ao chamar return_jobs, copie a URL exata de cada vaga encontrada no campo link — nunca deixe link como null.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `Pesquise 6 vagas de emprego reais publicadas nos últimos ${profile.preferences?.maxAgeDays ?? 90} dias compatíveis com o perfil abaixo no LinkedIn, Glassdoor ou similar. Ignore vagas com mais de ${profile.preferences?.maxAgeDays ?? 90} dias de publicação. Para cada vaga encontrada, inclua obrigatoriamente a URL real da página de candidatura no campo link. Depois chame return_jobs com os resultados.

PERFIL:
${buildProfileSummary(profile)}`,
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
    console.error('[jobs] Claude não chamou return_jobs. Resposta:', text.slice(0, 400));
    throw new Error('Claude não retornou vagas estruturadas');
  }

  const result = toolBlock.input as { jobs: Job[] };
  return Array.isArray(result.jobs) ? result.jobs : [];
}

export async function findJobs(profile: JobSearchRequest): Promise<Job[]> {
  try {
    return await findJobsClaude(profile);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[jobs] Claude API error (${err.status}), switching to Gemini...`);
      return findJobsGemini(profile);
    }
    throw err;
  }
}
