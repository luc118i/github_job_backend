import Anthropic from '@anthropic-ai/sdk';
import { Job, JobSearchRequest, RepoContext, UserPreferences } from '../types';
import { AdzunaJob, searchAllQueries } from './adzuna';
import { searchRemotiveJobs } from './remotive';
import { searchGupyJobs } from './gupy';
import { buildSearchQueries } from './queryBuilder';
import { findJobsGemini } from './gemini';
import { resolveJobLink } from './linkVerifier';
import { isBlocked } from '../utils/inferCategory';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WEB_SEARCH_BETA = 'web-search-2025-03-05';

// ── Source platforms for AI web search ──────────────────────────
const JOB_PLATFORMS = [
  // Job boards diretos
  'Gupy (gupy.io)', 'Indeed', 'Glassdoor', 'Catho', 'InfoJobs',
  'Remotive (remotive.com)', 'GeekHunter', 'Programathor', 'Trampos.co', '99jobs',
  // LinkedIn Jobs
  'LinkedIn Jobs (linkedin.com/jobs)',
  // Redes sociais (posts públicos)
  'X/Twitter (#vagastech #vagasTI #hiringBR #devBR)',
  'Facebook (grupos públicos de vagas tech)',
  'Instagram (recrutadores tech brasileiros)',
  // Sites de empresa
  'site direto da empresa contratante',
].join(', ');

// ── Helpers ──────────────────────────────────────────────────────

function buildSourceHints(blocked?: string[], liked?: string[]): string {
  const lines: string[] = [];
  if (blocked?.length) lines.push(`Evite vagas das fontes: ${blocked.join(', ')}`);
  if (liked?.length) lines.push(`Priorize vagas das fontes: ${liked.join(', ')}`);
  return lines.length ? '\n' + lines.join('\n') : '';
}

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

// ── Multi-source deduplication ────────────────────────────────────

function mergeRawJobs(...sources: AdzunaJob[][]): AdzunaJob[] {
  const seen = new Set<string>();
  const merged: AdzunaJob[] = [];
  for (const source of sources) {
    for (const job of source) {
      const key = job.link || `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(job);
      }
    }
  }
  return merged;
}

// ── Adzuna flow: query generation + ranking ───────────────────────

const RANK_JOBS_TOOL: Anthropic.Tool = {
  name: 'rank_jobs',
  description: 'Seleciona e formata as vagas mais relevantes para o perfil do candidato.',
  input_schema: {
    type: 'object' as const,
    required: ['jobs'],
    properties: {
      jobs: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          required: ['index', 'title', 'company', 'level', 'remote', 'skills', 'description'],
          properties: {
            index:       { type: 'number', description: 'Número [N] da vaga na listagem fornecida.' },
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'] },
            skills:      { type: 'array', items: { type: 'string' } },
            description: { type: 'string', description: '2 frases explicando por que essa vaga combina com o perfil' },
            salary:      { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

async function rankJobs(profile: JobSearchRequest, rawJobs: AdzunaJob[]): Promise<Job[]> {
  const jobsList = rawJobs
    .map((j, i) => {
      const src = j.source ? ` [${j.source}]` : '';
      return `[${i + 1}] ${j.title} — ${j.company} | ${j.location}${j.salary ? ` | ${j.salary}` : ''}${src}\n${j.description}`;
    })
    .join('\n\n');

  const blockedNote = profile.blockedKeywords?.length
    ? ` NÃO selecione vagas das categorias: ${profile.blockedKeywords.join(', ')}.`
    : '';

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `Você é um especialista em recrutamento. Analise as vagas listadas e selecione as mais relevantes para o perfil do candidato (mínimo 1, máximo 6).${blockedNote} Para cada vaga selecionada, use o índice numérico exato [N] da listagem no campo "index". Determine o nível (Junior/Pleno/Senior), se é remota, extraia as principais skills exigidas e escreva 2 frases explicando por que combina com o perfil. Sempre chame rank_jobs ao final.`,
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

  const result = toolBlock.input as { jobs: (Job & { index?: number })[] };
  const ranked = Array.isArray(result.jobs) ? result.jobs : [];

  // Restore original links and published_at from source data
  return ranked.map((job) => {
    const originalIndex = typeof job.index === 'number' ? job.index - 1 : -1;
    const original = rawJobs[originalIndex];
    return {
      ...job,
      link: original?.link ?? job.link,
      published_at: original?.published_at ?? null,
    };
  });
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
    const remote = REMOTE_RE.test(text) || j.location.toLowerCase().includes('brasil') || j.source === 'Remotive';
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
      published_at: j.published_at ?? null,
    };
  });
}

// ── Fallback: AI web search ───────────────────────────────────────

const RETURN_JOBS_TOOL: Anthropic.Tool = {
  name: 'return_jobs',
  description: 'Retorna as vagas encontradas. OBRIGATÓRIO: sempre chame ao final, mesmo que com apenas 1 vaga.',
  input_schema: {
    type: 'object' as const,
    required: ['jobs'],
    properties: {
      jobs: {
        type: 'array',
        minItems: 1,
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
            link: {
              type: 'string',
              description: 'URL real da página da vaga encontrada via web_search. Aceita links de job boards, LinkedIn Jobs, sites de empresa, X/Twitter, Facebook ou Instagram. Nunca invente — deixe vazio se não encontrou.',
            },
          },
        },
      },
    },
  },
};

async function findJobsWebSearch(profile: JobSearchRequest): Promise<Job[]> {
  const blockedNote = profile.blockedKeywords?.length
    ? ` NÃO inclua vagas das categorias: ${profile.blockedKeywords.join(', ')}.`
    : '';
  const maxAge = profile.preferences?.maxAgeDays ?? 90;

  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `Você é um especialista em recrutamento. Use web_search para encontrar vagas reais.${blockedNote} No campo link, coloque apenas URLs reais encontradas na pesquisa em plataformas como Gupy, Indeed, Glassdoor, Catho, InfoJobs — nunca invente um link. Se não encontrar a URL exata, deixe o campo link vazio. NUNCA use links do LinkedIn.`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [{
        role: 'user',
        content: `Pesquise 6 vagas reais publicadas nos últimos ${maxAge} dias compatíveis com o perfil abaixo nos seguintes canais: ${JOB_PLATFORMS}. Para vagas encontradas em redes sociais (X/Twitter, Facebook, Instagram), inclua o link direto para candidatura no site da empresa quando disponível. Chame return_jobs com os resultados.\n\nPERFIL:\n${buildProfileSummary(profile)}${buildSourceHints(profile.blockedSources, profile.likedSources)}`,
      }],
    },
    { headers: { 'anthropic-beta': WEB_SEARCH_BETA } }
  );

  const toolBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'return_jobs'
  );

  if (!toolBlock) {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    console.error('[jobs] Claude não chamou return_jobs. Resposta:', text.slice(0, 400));
    return [];
  }

  const result = toolBlock.input as { jobs: Job[] };
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  return jobs.map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }));
}

// ── Entry point ───────────────────────────────────────────────────

export async function findJobs(profile: JobSearchRequest): Promise<Job[]> {
  // Build queries from profile skills/repos
  const baseQueries = buildSearchQueries(profile);
  const extraQueries = (profile.likedKeywords ?? []).filter((kw) => !baseQueries.includes(kw));
  const queries = [...baseQueries, ...extraQueries].slice(0, 6);
  console.log('[jobs] queries geradas:', queries);

  // Filter blocked sources
  const blocked = (profile.blockedSources ?? []).map((s) => s.toLowerCase());

  // Fetch from all direct API sources in parallel (Adzuna requires keys; Remotive + Gupy are always free)
  const directSources: Promise<AdzunaJob[]>[] = [
    blocked.includes('remotive')
      ? Promise.resolve([])
      : searchRemotiveJobs(queries, profile.preferences).catch((e) => { console.warn('[remotive] erro:', e.message); return []; }),
    blocked.includes('gupy')
      ? Promise.resolve([])
      : searchGupyJobs(queries, profile.preferences).catch((e) => { console.warn('[gupy] erro:', e.message); return []; }),
  ];

  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
    directSources.push(
      searchAllQueries(queries, profile.preferences, profile.blockedKeywords)
        .catch((e) => { console.warn('[adzuna] erro:', e.message); return []; })
    );
  }

  const sourceResults = await Promise.all(directSources);
  const rawJobs = mergeRawJobs(...sourceResults);

  const counts = sourceResults.map((r, i) => {
    const names = ['Remotive', 'Gupy', 'Adzuna'];
    return `${names[i] ?? `fonte${i}`}=${r.length}`;
  });
  console.log(`[jobs] fontes diretas: ${counts.join(', ')} → ${rawJobs.length} total`);

  if (rawJobs.length >= 3) {
    try {
      return await rankJobs(profile, rawJobs);
    } catch (err) {
      console.warn('[jobs] ranking por IA falhou, usando ranking heurístico:', (err as Error).message);
      return rankJobsHeuristic(rawJobs);
    }
  }

  // Not enough direct results — fall through to AI web search
  console.warn('[jobs] fontes diretas insuficientes, usando web search como fallback');
  try {
    const webJobs = await findJobsWebSearch(profile);
    if (webJobs.length > 0) return webJobs;
    console.warn('[jobs] web search retornou 0 vagas, switching to Gemini...');
    return findJobsGemini(profile);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[jobs] Claude API error (${err.status}), switching to Gemini...`);
      return findJobsGemini(profile);
    }
    console.error('[jobs] Erro inesperado no web search, switching to Gemini:', (err as Error).message);
    return findJobsGemini(profile);
  }
}
