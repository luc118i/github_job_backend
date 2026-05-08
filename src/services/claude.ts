import Anthropic from '@anthropic-ai/sdk';
import { Job, JobSearchRequest, RepoContext, UserPreferences } from '../types';
import { AdzunaJob, searchAllQueries } from './adzuna';
import { buildSearchQueries } from './queryBuilder';
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

function formatRepoContext(repos: RepoContext[]): string {
  return repos
    .map((r) => {
      const parts = [r.name];
      if (r.description) parts.push(`(${r.description})`);
      if (r.topics.length) parts.push(`[${r.topics.join(', ')}]`);
      return '- ' + parts.join(' ');
    })
    .join('\n');
}

function buildProfileSummary(profile: JobSearchRequest): string {
  const lines: (string | null)[] = [
    profile.username ? `GitHub: ${profile.username}` : null,
    `Nome: ${profile.name}`,
    profile.bio ? `Bio: ${profile.bio}` : null,
    profile.skills.length > 0
      ? `Tecnologias: ${profile.skills.slice(0, 6).join(', ')}`
      : null,
  ];

  if (profile.repoContext?.length) {
    lines.push(`Projetos e domínios de conhecimento:\n${formatRepoContext(profile.repoContext)}`);
  } else if (profile.topRepos.length > 0) {
    lines.push(`Repositórios: ${profile.topRepos.join(', ')}`);
  }

  if (profile.followers) lines.push(`Seguidores GitHub: ${profile.followers}`);

  return lines.filter(Boolean).join('\n') + buildPreferencesSummary(profile.preferences);
}

// --- Adzuna flow: query generation + ranking ---


const RANK_JOBS_TOOL: Anthropic.Tool = {
  name: 'rank_jobs',
  description: 'Seleciona e formata as vagas mais relevantes para o perfil do candidato.',
  input_schema: {
    type: 'object' as const,
    required: ['jobs'],
    properties: {
      jobs: {
        type: 'array',
        minItems: 3,
        maxItems: 10,
        items: {
          type: 'object',
          required: ['title', 'company', 'level', 'remote', 'skills', 'description', 'link'],
          properties: {
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'] },
            skills:      { type: 'array', items: { type: 'string' } },
            description: { type: 'string', description: '2 frases explicando por que essa vaga combina com o perfil' },
            salary:      { type: ['string', 'null'] },
            link:        { type: 'string', description: 'Use o link original da vaga, sem alteração.' },
          },
        },
      },
    },
  },
};

async function rankJobs(profile: JobSearchRequest, rawJobs: AdzunaJob[]): Promise<Job[]> {
  const jobsList = rawJobs
    .map((j, i) => `[${i + 1}] ${j.title} — ${j.company} | ${j.location}${j.salary ? ` | ${j.salary}` : ''}\n${j.description}\nLink: ${j.link}`)
    .join('\n\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: 'Você é um especialista em recrutamento. Analise as vagas listadas e selecione as 3 a 6 mais relevantes para o perfil do candidato. Para cada vaga selecionada, determine o nível (Junior/Pleno/Senior), se é remota, extraia as principais skills exigidas e escreva 2 frases explicando por que combina com o perfil. Preserve o link original intacto.',
    tools: [RANK_JOBS_TOOL],
    tool_choice: { type: 'tool', name: 'rank_jobs' },
    messages: [{
      role: 'user',
      content: `PERFIL DO CANDIDATO:\n${buildProfileSummary(profile)}\n\nVAGAS DISPONÍVEIS:\n${jobsList}`,
    }],
  });

  const toolBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'rank_jobs'
  );

  if (!toolBlock) throw new Error('Claude não ranqueou as vagas');

  const result = toolBlock.input as { jobs: Job[] };
  return Array.isArray(result.jobs) ? result.jobs : [];
}

function rankJobsHeuristic(rawJobs: AdzunaJob[]): Job[] {
  const LEVEL_RE = /\b(s[eê]nior|sr\.?|especialista|principal|staff|lead)\b/i;
  const JUNIOR_RE = /\b(j[uú]nior|jr\.?|trainee|est[aá]gi[oá]rio|aprendiz)\b/i;
  const REMOTE_RE = /\b(remoto|remote|home.?office|100%\s*remoto)\b/i;
  const SKILL_WORDS = ['python','typescript','javascript','react','node','java','c\\+\\+','golang','rust','docker','kubernetes','aws','azure','gcp','sql','mongodb','postgresql','redis','kafka','spark','tensorflow','pytorch','flutter','kotlin','swift'];
  const skillRe = new RegExp(`\\b(${SKILL_WORDS.join('|')})\\b`, 'gi');

  return rawJobs.slice(0, 10).map((j): Job => {
    const text = `${j.title} ${j.description}`.toLowerCase();

    const level: Job['level'] = LEVEL_RE.test(text) ? 'Senior' : JUNIOR_RE.test(text) ? 'Junior' : 'Pleno';
    const remote = REMOTE_RE.test(text) || j.location.toLowerCase().includes('brasil');
    const skillMatches = text.match(skillRe) ?? [];
    const skills = [...new Set(skillMatches.map((s) => s.charAt(0).toUpperCase() + s.slice(1)))].slice(0, 6);

    return {
      title: j.title,
      company: j.company,
      level,
      remote,
      location: remote ? 'Remoto' : j.location,
      skills: skills.length ? skills : ['Não especificado'],
      description: j.description.slice(0, 200),
      salary: j.salary ?? null,
      link: j.link,
    };
  });
}

async function findJobsAdzuna(profile: JobSearchRequest): Promise<Job[]> {
  const baseQueries = buildSearchQueries(profile);
  const extraQueries = (profile.likedKeywords ?? []).filter((kw) => !baseQueries.includes(kw));
  const queries = [...baseQueries, ...extraQueries].slice(0, 6);
  console.log('[jobs/adzuna] queries geradas:', queries);

  const rawJobs = await searchAllQueries(queries, profile.preferences, profile.blockedKeywords);
  console.log(`[jobs/adzuna] ${rawJobs.length} vagas brutas encontradas`);

  if (rawJobs.length < 3) throw new Error('Adzuna retornou vagas insuficientes');

  try {
    return await rankJobs(profile, rawJobs);
  } catch (err) {
    console.warn('[jobs/adzuna] ranking por IA falhou, usando ranking heurístico:', (err as Error).message);
    return rankJobsHeuristic(rawJobs);
  }
}

// --- Fallback: web search (old behavior) ---

const RETURN_JOBS_TOOL: Anthropic.Tool = {
  name: 'return_jobs',
  description: 'Retorna as vagas encontradas.',
  input_schema: {
    type: 'object' as const,
    required: ['jobs'],
    properties: {
      jobs: {
        type: 'array',
        minItems: 3,
        maxItems: 10,
        items: {
          type: 'object',
          required: ['title', 'company', 'level', 'remote', 'skills', 'description', 'link'],
          properties: {
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'] },
            skills:      { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            salary:      { type: ['string', 'null'] },
            link:        { type: 'string' },
          },
        },
      },
    },
  },
};

async function findJobsWebSearch(profile: JobSearchRequest): Promise<Job[]> {
  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'Você é um especialista em recrutamento. Analise o perfil do candidato de forma holística e use web_search para encontrar vagas reais. Ao chamar return_jobs, copie a URL exata de cada vaga no campo link.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [{
        role: 'user',
        content: `Pesquise 6 vagas reais nos últimos ${profile.preferences?.maxAgeDays ?? 90} dias compatíveis com o perfil abaixo. Chame return_jobs com os resultados.\n\nPERFIL:\n${buildProfileSummary(profile)}`,
      }],
    },
    { headers: { 'anthropic-beta': WEB_SEARCH_BETA } }
  );

  const toolBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'return_jobs'
  );

  if (!toolBlock) throw new Error('Claude não retornou vagas estruturadas');

  const result = toolBlock.input as { jobs: Job[] };
  return Array.isArray(result.jobs) ? result.jobs : [];
}

// --- Entry point ---

export async function findJobs(profile: JobSearchRequest): Promise<Job[]> {
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    try {
      return await findJobsAdzuna(profile);
    } catch (err) {
      console.warn('[jobs] Adzuna flow falhou, usando web search como fallback:', (err as Error).message);
    }
  }

  try {
    return await findJobsWebSearch(profile);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[jobs] Claude API error (${err.status}), switching to Gemini...`);
      return findJobsGemini(profile);
    }
    throw err;
  }
}
