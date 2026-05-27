import Anthropic from '@anthropic-ai/sdk';
import { LinkedInPosition, LinkedInEducation, LinkedInCertification, ProfessionSearchResult, UserPreferences, CareerProfile } from '../types';
import { searchRemotiveJobs } from './remotive';
import { searchGupyJobs } from './gupy';
import { findProfessionJobsGemini, findJobsByQueryGemini } from './gemini';
import { resolveJobLink } from './linkVerifier';
import { isBlocked } from '../utils/inferCategory';
import { isLawProfile, extractLawSpecialties, buildLawQueries } from '../utils/profileUtils';
import { fetchLegalJobs } from './legalJobs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WEB_SEARCH_BETA = 'web-search-2025-03-05';

// ── Plataformas alvo da busca IA ──────────────────────────────────
const JOB_PLATFORMS = [
  'Gupy (gupy.io)', 'Indeed', 'Glassdoor', 'Catho', 'InfoJobs',
  'Remotive (remotive.com)', 'GeekHunter', 'Programathor', 'Trampos.co', '99jobs',
  'LinkedIn Jobs (linkedin.com/jobs)',
  'X/Twitter (#vagastech #vagasTI #hiringBR)',
  'Facebook (grupos públicos de vagas)',
  'Instagram (recrutadores e empresas tech)',
  'site direto da empresa',
].join(', ');

// ── Profile formatters ────────────────────────────────────────────

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

function formatCertifications(certifications: LinkedInCertification[]): string {
  if (!certifications.length) return '';
  const items = certifications.map((c) => {
    const parts = [c.name];
    if (c.authority) parts.push(`(${c.authority})`);
    if (c.licenseNumber) parts.push(`nº ${c.licenseNumber}`);
    return parts.join(' ');
  });
  return '\nCertificações e habilitações profissionais: ' + items.join('; ');
}

const WORK_STYLE_LABELS: Record<string, string> = {
  analytical: 'analítico (dados e resolução de problemas)',
  creative: 'criativo (inovação e design)',
  operational: 'operacional (processos e execução)',
  relational: 'relacional (pessoas e comunicação)',
};

const TECH_LABELS: Record<string, string> = {
  basic: 'básico',
  intermediate: 'intermediário',
  advanced: 'avançado',
};

const LEADERSHIP_LABELS: Record<string, string> = {
  low: 'pouca',
  medium: 'moderada',
  high: 'forte',
};

function buildCareerProfileBlock(profile?: CareerProfile): string {
  if (!profile) return '';

  const lines: string[] = ['\nPERFIL DE CARREIRA (use isto para personalizar a busca):'];

  lines.push(`Objetivo: ${profile.careerGoals}`);

  if (profile.personalitySummary) {
    lines.push(`Perfil comportamental: ${profile.personalitySummary}`);
  }

  if (profile.workStyle.length) {
    lines.push(`Estilo de trabalho: ${profile.workStyle.map((s) => WORK_STYLE_LABELS[s] ?? s).join(', ')}`);
  }

  lines.push(`Capacidade de liderança: ${LEADERSHIP_LABELS[profile.leadershipLevel] ?? profile.leadershipLevel}`);
  lines.push(`Nível com tecnologia: ${TECH_LABELS[profile.techLiteracy] ?? profile.techLiteracy}`);

  if (profile.hiddenSkills.length) {
    lines.push(`Habilidades não evidentes no currículo: ${profile.hiddenSkills.join(', ')}`);
  }

  if (profile.transitionReady && profile.transitionTarget) {
    lines.push(`TRANSICAO DE CARREIRA: o candidato quer migrar para "${profile.transitionTarget}". Priorize vagas nessa área, mesmo sem experiência formal. Busque vagas que valorizem habilidades transferíveis.`);
  } else if (profile.desiredAreas.length) {
    lines.push(`Áreas de interesse: ${profile.desiredAreas.join(', ')}`);
  }

  if (profile.blockedAreas.length) {
    lines.push(`IMPORTANTE — não retorne vagas nestas áreas: ${profile.blockedAreas.join(', ')}`);
  }

  if (profile.potentialSummary) {
    lines.push(`Potencial a explorar: ${profile.potentialSummary}`);
  }

  return '\n' + lines.join('\n');
}

function buildSourcePrefsBlock(blocked?: string[], liked?: string[]): string {
  const lines: string[] = [];
  if (blocked?.length) lines.push(`Evite vagas das fontes: ${blocked.join(', ')}`);
  if (liked?.length) lines.push(`Priorize vagas das fontes: ${liked.join(', ')}`);
  return lines.length ? '\n' + lines.join('\n') : '';
}

function buildProfessionPrefsBlock(prefs: UserPreferences | undefined): string {
  if (!prefs) return '';
  const lines: string[] = [];
  const modalityLabel: Record<string, string> = { remote: 'Remoto', presencial: 'Presencial', hybrid: 'Híbrido', any: '' };
  if (prefs.modality !== 'any') lines.push(`Modalidade: ${modalityLabel[prefs.modality]}`);
  if (prefs.location) lines.push(`Local preferido: ${prefs.location}`);
  if (prefs.salaryMin || prefs.salaryMax) {
    const range = [prefs.salaryMin && `R$ ${prefs.salaryMin}`, prefs.salaryMax && `R$ ${prefs.salaryMax}`].filter(Boolean).join(' – ');
    lines.push(`Faixa salarial: ${range}`);
  }
  if (prefs.level !== 'any') lines.push(`Nível: ${prefs.level}`);
  if (prefs.maxAgeDays) lines.push(`Período máximo: ${prefs.maxAgeDays} dias`);
  return lines.length ? '\nPreferências (priorize): ' + lines.join(' · ') : '';
}

/** Extracts the most recent job title to use as a search query. */
function extractCurrentTitle(positions: LinkedInPosition[]): string | null {
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) => {
    if (!a.finishedOn && b.finishedOn) return -1; // current first
    if (a.finishedOn && !b.finishedOn) return 1;
    return 0;
  });
  return sorted[0].title;
}

/** Pre-fetches jobs from Remotive + Gupy using the candidate's current title. */
async function prefetchDirectJobs(
  positions: LinkedInPosition[],
  preferences?: UserPreferences,
  blockedSources?: string[],
): Promise<string> {
  const title = extractCurrentTitle(positions);
  if (!title) return '';

  const queries = [title];
  const blocked = (blockedSources ?? []).map((s) => s.toLowerCase());
  const [remotive, gupy] = await Promise.all([
    blocked.includes('remotive') ? Promise.resolve([]) : searchRemotiveJobs(queries, preferences).catch(() => []),
    blocked.includes('gupy')     ? Promise.resolve([]) : searchGupyJobs(queries, preferences).catch(() => []),
  ]);

  const jobs = [...remotive, ...gupy];
  if (!jobs.length) return '';

  const list = jobs
    .slice(0, 10)
    .map((j, i) => {
      const src = j.source ? ` [${j.source}]` : '';
      return `${i + 1}. "${j.title}" — ${j.company} | ${j.location}${src}\n   Link: ${j.link || 'sem link'}\n   ${j.description.slice(0, 150)}`;
    })
    .join('\n\n');

  return `\n\nVAGAS PRÉ-COLETADAS (Remotive + Gupy) — avalie e inclua na lista se forem relevantes para o perfil:\n${list}`;
}

// ── Tool definition ───────────────────────────────────────────────

const RETURN_JOBS_TOOL: Anthropic.Tool = {
  name: 'return_jobs',
  description: 'Retorna as vagas encontradas. OBRIGATÓRIO: sempre chame esta função ao final, mesmo que tenha encontrado apenas 1 vaga. Nunca responda com texto sem chamar return_jobs.',
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
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['title', 'company', 'level', 'remote', 'tags', 'description', 'match', 'link'],
          properties: {
            title:       { type: 'string' },
            company:     { type: 'string' },
            level:       { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
            remote:      { type: 'boolean' },
            location:    { type: ['string', 'null'], description: 'Cidade/estado ou "Remoto" ou "Híbrido - Cidade, UF"' },
            tags:        { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            salary:      { type: ['string', 'null'] },
            link: {
              type: 'string',
              description: 'URL real da vaga encontrada via web_search ou da lista pré-coletada. Aceita links de job boards, LinkedIn Jobs, X/Twitter, Facebook, Instagram ou site da empresa. Nunca invente — deixe vazio se não encontrou.',
            },
            match:       { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
  },
};

// ── Claude search ─────────────────────────────────────────────────

async function findProfessionJobsClaude(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
): Promise<ProfessionSearchResult | null> {
  const lawProfile = isLawProfile(positions);
  const specialties = lawProfile ? extractLawSpecialties(positions) : [];

  const blockedNote = blockedKeywords?.length
    ? ` NÃO inclua vagas das categorias: ${blockedKeywords.join(', ')}.`
    : '';

  // Prompt e plataformas adaptados para perfil jurídico
  const systemPrompt = lawProfile
    ? `Você é um especialista em recrutamento jurídico.${blockedNote} Use web_search para encontrar vagas reais em plataformas jurídicas brasileiras: Jusbrasil Empregos (jusbrasil.com.br/empregos), Conjur (conjur.com.br), Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia e departamentos jurídicos de empresas. No campo link, coloque apenas URLs reais encontradas — nunca invente. NUNCA use links do LinkedIn. IMPORTANTE: ao final, chame return_jobs com todas as vagas encontradas.`
    : `Você é um especialista em recrutamento para todas as áreas profissionais.${blockedNote} Use web_search para encontrar vagas reais. No campo link, coloque apenas URLs reais encontradas em plataformas como Gupy, Indeed, Glassdoor, Catho, InfoJobs — nunca invente um link. Se não encontrar a URL exata, deixe o campo link vazio. NUNCA use links do LinkedIn. IMPORTANTE: ao final, chame return_jobs com todas as vagas encontradas, mesmo que seja apenas 1.`;

  const specialtiesNote = specialties.length
    ? `\nÁreas de especialização identificadas: ${specialties.join(', ')}. Priorize vagas nessas áreas.`
    : '';

  const platformNote = lawProfile
    ? 'Jusbrasil Empregos, Conjur, Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia'
    : JOB_PLATFORMS;

  // Pre-fetch from free APIs in parallel while building the prompt (skip for law profiles — legal sources fetched later)
  const directJobsBlock = lawProfile ? '' : await prefetchDirectJobs(positions, preferences, blockedSources);

  const maxAge = preferences?.maxAgeDays ?? 90;

  // When the user wants a career transition, search for the target area, not their history
  const searchFocus = careerProfile?.transitionReady && careerProfile.transitionTarget
    ? `O candidato quer transicionar para "${careerProfile.transitionTarget}". Busque vagas nessa área que valorizem habilidades transferíveis. NÃO se limite ao histórico profissional listado.`
    : '';


  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `${searchFocus ? searchFocus + ' ' : ''}Pesquise 6 vagas reais publicadas nos últimos ${maxAge} dias compatíveis com o perfil abaixo em: ${platformNote}. NÃO use links do LinkedIn. Para vagas em redes sociais (X, Facebook, Instagram), priorize o link direto no site da empresa. Inclua a URL real de cada vaga.${specialtiesNote}${directJobsBlock}

Experiência: ${formatPositions(positions)}
Formação: ${formatEducation(education)}${formatCertifications(certifications)}${buildCareerProfileBlock(careerProfile)}${buildProfessionPrefsBlock(preferences)}${buildSourcePrefsBlock(blockedSources, likedSources)}

Após a busca, chame return_jobs com 1 a 8 vagas mais relevantes (combinando resultados da web_search e das vagas pré-coletadas acima). Chame return_jobs mesmo que tenha encontrado apenas 1 vaga.`,
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
    return null;
  }

  const result = toolBlock.input as ProfessionSearchResult;
  const rawJobs = Array.isArray(result.jobs) ? result.jobs : [];

  if (!rawJobs.length) {
    console.warn('[profession] Claude chamou return_jobs com array vazio.');
    return null;
  }

  const aiJobs = rawJobs
    .map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }))
    .filter((job) => !isBlocked(job.title, blockedKeywords ?? []));

  // Para perfis jurídicos, busca fontes especializadas em paralelo com o resultado da IA
  if (lawProfile) {
    const lawQueries = buildLawQueries(positions, specialties);
    const legalSourceJobs = await fetchLegalJobs(lawQueries, preferences, blockedKeywords);

    const legalProfJobs = legalSourceJobs
      .filter((j) => !rawJobs.some((ai) => ai.link === j.link))
      .map((j) => ({
        title:       j.title,
        company:     j.company,
        level:       'Pleno' as const,
        remote:      false,
        location:    j.location ?? null,
        tags:        [],
        description: j.description,
        salary:      j.salary ?? null,
        link:        resolveJobLink(j.link, j.title, j.company),
        match:       50,
      }));

    console.log(`[profession/law] claude: ${aiJobs.length} | fontes especializadas: ${legalProfJobs.length}`);
    return {
      profileSummary: result.profileSummary ?? '',
      jobs: [...aiJobs, ...legalProfJobs],
    };
  }

  return { profileSummary: result.profileSummary ?? '', jobs: aiJobs };
}

// ── Query-based pre-fetch (Remotive + Gupy without LinkedIn) ─────

async function prefetchDirectJobsByQuery(
  query: string,
  preferences?: UserPreferences,
  blockedSources?: string[],
): Promise<string> {
  const blocked = (blockedSources ?? []).map((s) => s.toLowerCase());
  const queries = [query];
  const [remotive, gupy] = await Promise.all([
    blocked.includes('remotive') ? Promise.resolve([]) : searchRemotiveJobs(queries, preferences).catch(() => []),
    blocked.includes('gupy')     ? Promise.resolve([]) : searchGupyJobs(queries, preferences).catch(() => []),
  ]);

  const jobs = [...remotive, ...gupy];
  if (!jobs.length) return '';

  const list = jobs
    .slice(0, 10)
    .map((j, i) => {
      const src = j.source ? ` [${j.source}]` : '';
      return `${i + 1}. "${j.title}" — ${j.company} | ${j.location}${src}\n   Link: ${j.link || 'sem link'}\n   ${j.description.slice(0, 150)}`;
    })
    .join('\n\n');

  return `\n\nVAGAS PRÉ-COLETADAS (Remotive + Gupy) — avalie e inclua na lista se forem relevantes:\n${list}`;
}

// ── Claude query-based search ─────────────────────────────────────

async function findJobsByQueryClaude(
  query: string,
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
): Promise<ProfessionSearchResult | null> {
  const directJobsBlock = await prefetchDirectJobsByQuery(query, preferences, blockedSources);
  const maxAge = preferences?.maxAgeDays ?? 90;

  const blockedBlock = blockedKeywords?.length
    ? `\nNão retorne vagas com: ${blockedKeywords.join(', ')}`
    : '';

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: 'Você é um especialista em recrutamento. Use web_search para encontrar vagas reais. No campo link, coloque apenas URLs reais — nunca invente. IMPORTANTE: ao final, você DEVE chamar return_jobs com todas as vagas encontradas, mesmo que seja apenas 1.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `Pesquise vagas reais publicadas nos últimos ${maxAge} dias para: "${query}". Canais: ${JOB_PLATFORMS}.${blockedBlock}${directJobsBlock}${buildCareerProfileBlock(careerProfile)}${buildProfessionPrefsBlock(preferences)}${buildSourcePrefsBlock(blockedSources, likedSources)}

Após a busca, chame return_jobs com 1 a 8 vagas mais relevantes.`,
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
    console.error('[query] Claude não chamou return_jobs. Resposta:', text.slice(0, 400));
    return null;
  }

  const result = toolBlock.input as ProfessionSearchResult;
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];

  if (!jobs.length) {
    console.warn('[query] Claude chamou return_jobs com array vazio.');
    return null;
  }

  return {
    profileSummary: result.profileSummary ?? query,
    jobs: jobs.map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) })),
  };
}

export async function findJobsByQuery(
  query: string,
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
): Promise<ProfessionSearchResult> {
  try {
    const result = await findJobsByQueryClaude(query, preferences, blockedKeywords, blockedSources, likedSources, careerProfile);
    if (result) return result;
    console.warn('[query] Claude retornou 0 vagas, switching to Gemini...');
    return findJobsByQueryGemini(query, preferences);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[query] Claude API error (${err.status}), switching to Gemini...`);
      return findJobsByQueryGemini(query, preferences);
    }
    console.error('[query] Erro inesperado, switching to Gemini:', (err as Error).message);
    return findJobsByQueryGemini(query, preferences);
  }
}

// ── Entry point ───────────────────────────────────────────────────

export async function findProfessionJobs(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
): Promise<ProfessionSearchResult> {
  try {
    const result = await findProfessionJobsClaude(positions, education, certifications, preferences, blockedKeywords, blockedSources, likedSources, careerProfile);
    if (result) return result;
    console.warn('[profession] Claude retornou 0 vagas, switching to Gemini...');
    return findProfessionJobsGemini(positions, education, certifications, preferences);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[profession] Claude API error (${err.status}), switching to Gemini...`);
      return findProfessionJobsGemini(positions, education, certifications, preferences);
    }
    console.error('[profession] Erro inesperado, switching to Gemini:', (err as Error).message);
    return findProfessionJobsGemini(positions, education, certifications, preferences);
  }
}
