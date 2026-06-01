import Anthropic from '@anthropic-ai/sdk';
import { LinkedInPosition, LinkedInEducation, LinkedInCertification, ProfessionSearchResult, UserPreferences, CareerProfile } from '../types';
import { searchRemotiveJobs } from './remotive';
import { searchGupyJobs } from './gupy';
import { searchAdzunaJobs } from './adzuna';
import { searchJoobleJobs } from './jooble';
import { searchSineJobs } from './sine';
import { fetchProgramathorJobs } from './programathor';
import { findProfessionJobsGemini, findJobsByQueryGemini } from './gemini';
import { resolveJobLink } from './linkVerifier';
import { isBlocked, isPcdExclusive, expandBlockedTerms } from '../utils/inferCategory';
import { isLawProfile, extractLawSpecialties, buildLawQueries, inferUserContext, hasOAB, isInternJob } from '../utils/profileUtils';
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
    const expanded = expandBlockedTerms(profile.blockedAreas);
    lines.push(`IMPORTANTE — NÃO retorne vagas nestas áreas nem cargos relacionados (incluindo sinônimos e subcategorias): ${expanded.join(', ')}.`);
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
function filterByLevel<T extends { title: string; level?: string }>(jobs: T[], level: UserPreferences['level']): T[] {
  if (level === 'any') return jobs;
  return jobs.filter((j) => {
    const inferred = inferLevelFromTitle(j.title) ?? (j.level as 'Junior' | 'Pleno' | 'Senior' | undefined);
    if (!inferred) return true; // não foi possível determinar — mantém
    return inferred === level;
  });
}

function filterByPtBr<T extends { title: string }>(jobs: T[], ptBrOnly: boolean): T[] {
  if (!ptBrOnly) return jobs;
  return jobs.filter((j) => isPtBrTitle(j.title));
}

function filterByMaxAge<T>(jobs: T[], maxAgeDays: number): T[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  return jobs.filter((j) => {
    const pa = (j as Record<string, unknown>)['published_at'];
    if (!pa || typeof pa !== 'string') return true; // sem data = mantém (não punir sem dado)
    const d = new Date(pa);
    return !isNaN(d.getTime()) && d >= cutoff;
  });
}

function extractCurrentTitle(positions: LinkedInPosition[]): string | null {
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) => {
    if (!a.finishedOn && b.finishedOn) return -1; // current first
    if (a.finishedOn && !b.finishedOn) return 1;
    return 0;
  });
  return sorted[0].title;
}

// ── GitHub data fetcher ───────────────────────────────────────────

interface GithubRepo {
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
}

interface GithubData {
  /** Languages + topics extracted from public repos — used for query building and scoring. */
  techStack: string[];
  /** Pre-formatted block for AI prompts. */
  promptBlock: string;
}

const EMPTY_GITHUB: GithubData = { techStack: [], promptBlock: '' };

/** Fetches the user's public GitHub repos.
 *  Returns both a structured tech stack (for fallback scoring) and a
 *  formatted prompt block (for the AI context). */
async function fetchGithubData(username: string): Promise<GithubData> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'job-finder-app',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=12&type=public`,
      { headers },
    );
    if (!res.ok) return EMPTY_GITHUB;
    const repos = await res.json() as GithubRepo[];
    if (!Array.isArray(repos) || !repos.length) return EMPTY_GITHUB;

    const languages = [...new Set(repos.map((r) => r.language).filter(Boolean))] as string[];
    const topics    = [...new Set(repos.flatMap((r) => r.topics ?? []))];

    // Unified tech stack: languages first (more signal), then topics
    const techStack = [...new Set([...languages, ...topics.slice(0, 8)])];

    const lines: string[] = ['\nGitHub — projetos reais do candidato:'];
    if (languages.length) lines.push(`Tecnologias usadas: ${languages.join(', ')}`);
    if (topics.length)    lines.push(`Tópicos: ${topics.slice(0, 12).join(', ')}`);

    const topRepos = repos.slice(0, 5).map((r) => {
      const lang = r.language ? ` (${r.language})` : '';
      const desc = r.description ? ` — ${r.description.slice(0, 80)}` : '';
      return `${r.name}${lang}${desc}`;
    });
    if (topRepos.length) lines.push(`Projetos: ${topRepos.join('; ')}`);

    return { techStack, promptBlock: '\n' + lines.join('\n') };
  } catch {
    return EMPTY_GITHUB;
  }
}

/** Pre-fetches jobs from Remotive + Gupy.
 *  Priority: career target > desired areas > current LinkedIn title.
 *  This prevents searching for the "old" role when the candidate wants to change areas.
 *  @param excludeIntern - when true, removes estágio/trainee jobs before sending to AI */
async function prefetchDirectJobs(
  positions: LinkedInPosition[],
  preferences?: UserPreferences,
  blockedSources?: string[],
  careerProfile?: CareerProfile,
  excludeIntern = false,
): Promise<string> {
  let queries: string[];

  if (careerProfile?.transitionReady && careerProfile.transitionTarget) {
    queries = [careerProfile.transitionTarget];
  } else if (careerProfile?.desiredAreas.length) {
    queries = careerProfile.desiredAreas.slice(0, 2);
  } else {
    const title = extractCurrentTitle(positions);
    if (!title) return '';
    queries = [title];
  }
  const blocked = (blockedSources ?? []).map((s) => s.toLowerCase());
  const [gupy, adzuna, jooble, sine] = await Promise.all([
    blocked.includes('gupy')           ? Promise.resolve([]) : searchGupyJobs(queries, preferences).catch(() => []),
    blocked.includes('adzuna')         ? Promise.resolve([]) : searchAdzunaJobs(queries, preferences).catch(() => []),
    blocked.includes('jooble')         ? Promise.resolve([]) : searchJoobleJobs(queries, preferences).catch(() => []),
    blocked.includes('emprega brasil') ? Promise.resolve([]) : searchSineJobs(queries, preferences).catch(() => []),
  ]);

  let jobs = [...gupy, ...adzuna, ...jooble, ...sine];
  if (excludeIntern) jobs = jobs.filter((j) => !isInternJob(j.title));
  if (!jobs.length) return '';

  const list = jobs
    .slice(0, 15)
    .map((j, i) => {
      const src = j.source ? ` [${j.source}]` : '';
      return `${i + 1}. "${j.title}" — ${j.company} | ${j.location}${src}\n   Link: ${j.link || 'sem link'}\n   ${j.description.slice(0, 150)}`;
    })
    .join('\n\n');

  return `\n\nVAGAS PRÉ-COLETADAS (Gupy + Adzuna + Jooble + Emprega Brasil) — avalie e inclua na lista se forem relevantes para o perfil:\n${list}`;
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
        description: 'Resumo em uma linha. Se o candidato está em TRANSIÇÃO DE CARREIRA, descreva o ALVO (ex: "T.I | Júnior/Pleno | Em transição com background administrativo"), NUNCA o cargo atual. Para os demais: "Profissão | Nível | Destaque principal".',
      },
      jobs: {
        type: 'array',
        // sem minItems/maxItems — retorne todas as vagas relevantes encontradas
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
            published_at: {
              type: ['string', 'null'],
              description: 'Data de publicação da vaga em formato ISO 8601 (YYYY-MM-DD). Preencha sempre que a data de publicação estiver visível na listagem ou página da vaga. Deixe null apenas se realmente não encontrar a data.',
            },
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
  githubUsername?: string | null,
): Promise<ProfessionSearchResult | null> {
  const lawProfile = isLawProfile(positions);
  const specialties = lawProfile ? extractLawSpecialties(positions) : [];
  const userHasOABInClaude = hasOAB(certifications, positions);

  // Merge feedback blocked + career blocked into one list for the system prompt
  const allBlockedRaw = [
    ...(blockedKeywords ?? []),
    ...(careerProfile?.blockedAreas ?? []),
  ];
  const allBlockedInPrompt = expandBlockedTerms(allBlockedRaw);
  const internBlock = userHasOABInClaude ? ' NÃO inclua vagas de estágio, trainee ou jovem aprendiz — o candidato tem OAB e está habilitado a exercer advocacia.' : '';
  const blockedNote = allBlockedInPrompt.length
    ? ` NÃO inclua vagas nestas categorias, cargos ou áreas (incluindo sinônimos e subcategorias): ${allBlockedInPrompt.join(', ')}.${internBlock}`
    : internBlock;

  const specialtiesNote = specialties.length
    ? `\nÁreas de especialização identificadas: ${specialties.join(', ')}. Priorize vagas nessas áreas.`
    : '';

  const platformNote = lawProfile
    ? 'Jusbrasil Empregos, Conjur, Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia'
    : JOB_PLATFORMS;

  // Infer user's country and city from LinkedIn data (no extra form required).
  // When the user hasn't set a location preference, auto-fill the detected city so
  // both the AI prompt and Gupy pre-fetch prioritize the right area.
  const userCtx = inferUserContext(positions, education);
  const effectivePreferences: UserPreferences | undefined = (() => {
    if (!userCtx.inferredCity || preferences?.location) return preferences;
    return { ...(preferences ?? { modality: 'any', location: '', salaryMin: '', salaryMax: '', level: 'any' }), location: userCtx.inferredCity };
  })();

  // Reforço de localização — definido após effectivePreferences
  const locationEnforcementLinkedIn = (() => {
    const loc = effectivePreferences?.location;
    const mod = effectivePreferences?.modality;
    if (!loc) return '';
    if (mod === 'presencial' || mod === 'hybrid') {
      return ` RESTRIÇÃO DE LOCAL: busque SOMENTE vagas em ${loc} ou região. Não inclua vagas de outros estados.`;
    }
    return ` Priorize vagas em ${loc}.`;
  })();

  // Prompt e plataformas adaptados para perfil jurídico
  const systemPrompt = lawProfile
    ? `Você é um especialista em recrutamento jurídico.${blockedNote}${locationEnforcementLinkedIn} Use web_search para encontrar vagas reais em plataformas jurídicas brasileiras: Jusbrasil Empregos (jusbrasil.com.br/empregos), Conjur (conjur.com.br), Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia e departamentos jurídicos de empresas. No campo link, coloque apenas URLs reais encontradas — nunca invente. NUNCA use links do LinkedIn. IMPORTANTE: ao final, chame return_jobs com todas as vagas encontradas.`
    : `Você é um especialista em recrutamento para todas as áreas profissionais.${blockedNote}${locationEnforcementLinkedIn} Não inclua vagas exclusivas para PCD (Pessoa com Deficiência). Use web_search para encontrar vagas reais. No campo link, coloque apenas URLs reais encontradas em plataformas como Gupy, Indeed, Glassdoor, Catho, InfoJobs — nunca invente um link. Se não encontrar a URL exata, deixe o campo link vazio. NUNCA use links do LinkedIn. IMPORTANTE: ao final, chame return_jobs com todas as vagas encontradas, mesmo que seja apenas 1.`;

  // Pre-fetch jobs (Remotive + Gupy) and GitHub data in parallel
  const [directJobsBlock, githubData] = await Promise.all([
    lawProfile ? Promise.resolve('') : prefetchDirectJobs(positions, effectivePreferences, blockedSources, careerProfile, userHasOABInClaude),
    githubUsername ? fetchGithubData(githubUsername) : Promise.resolve(EMPTY_GITHUB),
  ]);

  const maxAge = effectivePreferences?.maxAgeDays ?? 90;

  const hasCareerFocus = !!(careerProfile?.transitionReady || careerProfile?.desiredAreas.length);

  // Build an explicit search target so Claude queries the RIGHT area, not the LinkedIn job titles
  const searchTarget = careerProfile?.transitionReady && careerProfile.transitionTarget
    ? `vagas em ${careerProfile.transitionTarget}`
    : careerProfile?.desiredAreas.length
      ? `vagas em ${careerProfile.desiredAreas.slice(0, 3).join(' ou ')}`
      : 'vagas';

  const careerBlock = buildCareerProfileBlock(careerProfile);

  // In transition mode: omit position titles entirely — they are the root cause of the AI
  // searching for the OLD area instead of the target. Only keep education, certs and GitHub.
  const isTransition = !!(careerProfile?.transitionReady && careerProfile.transitionTarget);
  const linkedInSection = isTransition
    ? `Formação: ${formatEducation(education)}${formatCertifications(certifications)}${githubData.promptBlock}`
    : `Experiência: ${formatPositions(positions)}\nFormação: ${formatEducation(education)}${formatCertifications(certifications)}${githubData.promptBlock}`;

  const profileSection = hasCareerFocus
    ? `FOCO DA BUSCA:${careerBlock}\n\n${linkedInSection}`
    : `${linkedInSection}${careerBlock}`;

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `${userCtx.isBrazilian ? 'CONTEXTO: Candidato brasileiro — busque vagas em português do Brasil, priorize plataformas nacionais (Gupy, Catho, InfoJobs, Programathor, Trampos.co, 99jobs).\n' : ''}Pesquise o máximo de ${searchTarget} reais publicadas nos últimos ${maxAge} dias em: ${platformNote}. NÃO use links do LinkedIn. Inclua a URL real de cada vaga.${isTransition ? `\nATENÇÃO: O candidato está MIGRANDO para ${careerProfile!.transitionTarget}. Busque SOMENTE vagas de ${careerProfile!.transitionTarget}. NÃO busque vagas das áreas anteriores.` : ''}${specialtiesNote}${directJobsBlock}

${profileSection}${buildProfessionPrefsBlock(effectivePreferences)}${buildSourcePrefsBlock(blockedSources, likedSources)}${userHasOABInClaude ? '\n\nRESTRIÇÃO ABSOLUTA: O candidato possui OAB e está habilitado a exercer advocacia. NÃO inclua NENHUMA vaga de estágio, estagiário, trainee, jovem aprendiz ou qualquer programa de ingresso. Retorne APENAS vagas de advogado, analista jurídico ou cargo efetivo.' : ''}

Chame return_jobs com TODAS as vagas encontradas, sem limite fixo de quantidade. Para cada vaga, preencha published_at com a data de publicação quando visível na listagem (formato YYYY-MM-DD).`,
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

  // Merge feedback blocked keywords + career profile blocked areas for hard filtering
  const allBlocked = [...(blockedKeywords ?? []), ...(careerProfile?.blockedAreas ?? [])];

  const aiJobs = rawJobs
    .map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }))
    .filter((job) => !isBlocked(job.title, allBlocked))
    // Also strip blocked category names from the tags/skills array so they don't appear in the UI
    .map((job) => ({
      ...job,
      tags: allBlocked.length
        ? job.tags.filter((tag) => !isBlocked(tag, allBlocked))
        : job.tags,
    }));

  // Para perfis jurídicos, busca fontes especializadas em paralelo com o resultado da IA
  const filteredAiJobs = filterByMaxAge(aiJobs, maxAge);
  console.log(`[profession] maxAge=${maxAge}d → ${aiJobs.length} vagas → ${filteredAiJobs.length} após filtro de data`);

  if (lawProfile) {
    const lawQueries = buildLawQueries(positions, specialties, certifications);
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

    const filteredLegalJobs = filterByMaxAge(legalProfJobs, maxAge);
    console.log(`[profession/law] claude: ${filteredAiJobs.length} | fontes especializadas: ${filteredLegalJobs.length}`);
    return {
      profileSummary: result.profileSummary ?? '',
      jobs: [...filteredAiJobs, ...filteredLegalJobs],
    };
  }

  // If all jobs were filtered out, signal failure so the caller can try a better fallback
  if (!filteredAiJobs.length) {
    console.warn(`[profession] Nenhuma vaga após filtro de data (maxAge=${maxAge}d). rawJobs=${rawJobs.length}.`);
    return null;
  }

  return { profileSummary: result.profileSummary ?? '', jobs: filteredAiJobs };
}

// ── Query-based pre-fetch (Remotive + Gupy without LinkedIn) ─────

async function prefetchDirectJobsByQuery(
  query: string,
  preferences?: UserPreferences,
  blockedSources?: string[],
  excludeIntern = false,
): Promise<string> {
  const blocked = (blockedSources ?? []).map((s) => s.toLowerCase());
  const queries = [query];
  const [gupy, adzuna, jooble, sine] = await Promise.all([
    blocked.includes('gupy')           ? Promise.resolve([]) : searchGupyJobs(queries, preferences).catch(() => []),
    blocked.includes('adzuna')         ? Promise.resolve([]) : searchAdzunaJobs(queries, preferences).catch(() => []),
    blocked.includes('jooble')         ? Promise.resolve([]) : searchJoobleJobs(queries, preferences).catch(() => []),
    blocked.includes('emprega brasil') ? Promise.resolve([]) : searchSineJobs(queries, preferences).catch(() => []),
  ]);

  let jobs = [...gupy, ...adzuna, ...jooble, ...sine];
  if (excludeIntern) jobs = jobs.filter((j) => !isInternJob(j.title));
  if (!jobs.length) return '';

  const list = jobs
    .slice(0, 15)
    .map((j, i) => {
      const src = j.source ? ` [${j.source}]` : '';
      return `${i + 1}. "${j.title}" — ${j.company} | ${j.location}${src}\n   Link: ${j.link || 'sem link'}\n   ${j.description.slice(0, 150)}`;
    })
    .join('\n\n');

  return `\n\nVAGAS PRÉ-COLETADAS (Gupy + Adzuna + Jooble + Emprega Brasil) — avalie e inclua na lista se forem relevantes:\n${list}`;
}

// ── Claude query-based search ─────────────────────────────────────

async function findJobsByQueryClaude(
  query: string,
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
  linkedIn?: { positions?: LinkedInPosition[]; education?: LinkedInEducation[]; certifications?: LinkedInCertification[] } | null,
): Promise<ProfessionSearchResult | null> {
  // Auto-detecta cidade do LinkedIn quando o usuário não definiu localização
  const userCtxQuery = inferUserContext(linkedIn?.positions ?? [], linkedIn?.education ?? []);
  const effectivePreferencesQuery: UserPreferences | undefined = (() => {
    if (!userCtxQuery.inferredCity || preferences?.location) return preferences;
    return { ...(preferences ?? { modality: 'any', location: '', salaryMin: '', salaryMax: '', level: 'any' }), location: userCtxQuery.inferredCity };
  })();

  const maxAge = effectivePreferencesQuery?.maxAgeDays ?? 90;

  // Merge feedback blocked + career blocked into one list for the system prompt
  const allBlockedRaw = [
    ...(blockedKeywords ?? []),
    ...(careerProfile?.blockedAreas ?? []),
  ];
  const allBlockedInPrompt = expandBlockedTerms(allBlockedRaw);
  const userHasOABQuery = hasOAB(linkedIn?.certifications ?? [], linkedIn?.positions);

  // Pre-fetch após calcular userHasOABQuery para poder filtrar intern jobs já na seed
  const directJobsBlock = await prefetchDirectJobsByQuery(query, effectivePreferencesQuery, blockedSources, userHasOABQuery);
  const internBlock = userHasOABQuery ? ' NÃO inclua vagas de estágio, trainee ou jovem aprendiz — o candidato tem OAB e está habilitado a exercer advocacia.' : '';
  const blockedNote = allBlockedInPrompt.length
    ? ` NÃO inclua vagas nestas categorias, cargos ou áreas (incluindo sinônimos e subcategorias): ${allBlockedInPrompt.join(', ')}.${internBlock}`
    : internBlock;

  // Reforço de localização: quando presencial e cidade detectada, instrui a IA explicitamente
  const locationEnforcement = (() => {
    const loc = effectivePreferencesQuery?.location;
    const mod = effectivePreferencesQuery?.modality;
    if (!loc) return '';
    if (mod === 'presencial' || mod === 'hybrid') {
      return ` RESTRIÇÃO DE LOCAL: busque SOMENTE vagas em ${loc} ou região. Não inclua vagas de outros estados.`;
    }
    return ` Priorize vagas em ${loc}.`;
  })();

  // Build LinkedIn context block for the query path (same as LinkedIn path)
  const linkedInBlock = (() => {
    if (!linkedIn?.positions?.length && !linkedIn?.education?.length) return '';
    const parts: string[] = ['\nCURRÍCULO DO CANDIDATO (use para personalizar os resultados):'];
    if (linkedIn.positions?.length) parts.push(`Experiência: ${formatPositions(linkedIn.positions)}`);
    if (linkedIn.education?.length)  parts.push(`Formação: ${formatEducation(linkedIn.education)}`);
    if (linkedIn.certifications?.length) parts.push(formatCertifications(linkedIn.certifications).trim());
    return parts.join('\n');
  })();

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: `Você é um especialista em recrutamento.${blockedNote}${locationEnforcement} Não inclua vagas exclusivas para PCD (Pessoa com Deficiência). Use web_search para encontrar vagas reais. No campo link, coloque apenas URLs reais — nunca invente. IMPORTANTE: ao final, você DEVE chamar return_jobs com todas as vagas encontradas, mesmo que seja apenas 1.`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any, RETURN_JOBS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `Pesquise o máximo de vagas reais publicadas nos últimos ${maxAge} dias para: "${query}". Canais: ${JOB_PLATFORMS}.${directJobsBlock}${linkedInBlock}${buildCareerProfileBlock(careerProfile)}${buildProfessionPrefsBlock(effectivePreferencesQuery)}${buildSourcePrefsBlock(blockedSources, likedSources)}${userHasOABQuery ? '\n\nRESTRIÇÃO ABSOLUTA: O candidato possui OAB e está habilitado a exercer advocacia. NÃO inclua NENHUMA vaga de estágio, estagiário, trainee, jovem aprendiz ou qualquer programa de ingresso. Retorne APENAS vagas de advogado, analista jurídico ou cargo efetivo.' : ''}

Chame return_jobs com TODAS as vagas relevantes encontradas, sem limite fixo. Para cada vaga, preencha published_at com a data de publicação quando estiver visível (formato YYYY-MM-DD).`,
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
  const rawJobs = Array.isArray(result.jobs) ? result.jobs : [];

  if (!rawJobs.length) {
    console.warn('[query] Claude chamou return_jobs com array vazio.');
    return null;
  }

  // Hard-filter blocked areas from results and strip blocked tags
  const allBlocked = [...(blockedKeywords ?? []), ...(careerProfile?.blockedAreas ?? [])];
  const jobs = rawJobs
    .map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }))
    .filter((job) => !isBlocked(job.title, allBlocked))
    .map((job) => ({
      ...job,
      tags: allBlocked.length
        ? job.tags.filter((tag: string) => !isBlocked(tag, allBlocked))
        : job.tags,
    }));

  if (!jobs.length) {
    console.warn(`[query] Todas as ${rawJobs.length} vagas foram bloqueadas pelo filtro.`);
    return null;
  }

  const filteredJobs = filterByMaxAge(jobs, maxAge);
  console.log(`[query] maxAge=${maxAge}d → ${jobs.length} vagas → ${filteredJobs.length} após filtro de data`);

  if (!filteredJobs.length) {
    console.warn(`[query] Nenhuma vaga após filtro de data (maxAge=${maxAge}d).`);
    return null;
  }

  return {
    profileSummary: result.profileSummary ?? query,
    jobs: filteredJobs,
  };
}

export async function findJobsByQuery(
  query: string,
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
  githubUsername?: string | null,
  certifications?: LinkedInCertification[],
  linkedIn?: { positions?: LinkedInPosition[]; education?: LinkedInEducation[]; certifications?: LinkedInCertification[] } | null,
): Promise<ProfessionSearchResult> {
  const userHasOAB = hasOAB(certifications ?? [], linkedIn?.positions);

  function applyInternFilter(result: ProfessionSearchResult): ProfessionSearchResult {
    if (!userHasOAB) return result;
    const filtered = result.jobs.filter((j) => !isInternJob(j.title));
    if (filtered.length < result.jobs.length) {
      console.log(`[query] OAB detectada → removidas ${result.jobs.length - filtered.length} vaga(s) de estágio/trainee`);
    }
    return { ...result, jobs: filtered };
  }

  // Step 1: Claude
  try {
    const result = await findJobsByQueryClaude(query, preferences, blockedKeywords, blockedSources, likedSources, careerProfile, linkedIn);
    if (result && result.jobs.length > 0) return applyInternFilter(result);
    console.warn('[query] Claude retornou 0 vagas úteis, tentando Gemini...');
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[query] Claude API error (${err.status}): ${err.message.slice(0, 200)}`);
    } else {
      console.error('[query] Erro inesperado, tentando Gemini:', (err as Error).message);
    }
  }

  const maxAgeDays = preferences?.maxAgeDays ?? 90;
  const levelPref   = preferences?.level ?? 'any';
  const ptBrOnly    = preferences?.ptBrOnly ?? false;

  function applyPreferenceFilters(result: ProfessionSearchResult): ProfessionSearchResult {
    let jobs = filterByMaxAge(result.jobs, maxAgeDays);
    jobs = filterByLevel(jobs, levelPref);
    jobs = filterByPtBr(jobs, ptBrOnly);
    if (jobs.length !== result.jobs.length)
      console.log(`[query] pref-filters (age=${maxAgeDays}d level=${levelPref} ptBr=${ptBrOnly}) → ${result.jobs.length} → ${jobs.length}`);
    return { ...result, jobs };
  }

  // Step 2: Gemini
  try {
    const result = applyBlockFilter(await findJobsByQueryGemini(query, preferences), blockedKeywords, careerProfile);
    if (result.jobs.length > 0) return applyPreferenceFilters(applyInternFilter(result));
    console.warn('[query] Gemini retornou 0 vagas úteis, usando script direto...');
  } catch {
    console.warn('[query] Gemini falhou, usando script direto...');
  }

  // Step 3: Smart script fallback — GitHub tech stack + career profile signals
  return applyPreferenceFilters(applyInternFilter(await fetchDirectJobs([query], preferences, blockedKeywords, careerProfile, githubUsername)));
}

// ── Fallback helpers (used when AI is unavailable) ────────────────

/** Keywords that indicate a job is in the IT/software domain. */
const IT_TITLE_KEYWORDS = [
  'desenvolvedor', 'developer', 'programador', 'engenheiro de software',
  'software engineer', 'analista de sistemas', 'frontend', 'back-end', 'backend',
  'fullstack', 'full stack', 'devops', 'sre', 'data engineer', 'data scientist',
  'machine learning', 'qa ', 'quality assurance', 'mobile', 'ios', 'android',
];

/** Infers the candidate's experience level without relying on AI.
 *  Rules (applied in order of priority):
 *  1. Transitioning to a new area → always Junior (no formal exp in target area)
 *  2. No IT/software title in any LinkedIn position → Junior
 *  3. techLiteracy from CareerProfile: advanced → Senior, intermediate → Pleno, basic → Junior */
function inferLevelFromProfile(
  careerProfile?: CareerProfile,
  positions?: LinkedInPosition[],
): 'Junior' | 'Pleno' | 'Senior' {
  if (careerProfile?.transitionReady) return 'Junior';

  const hasITExp = positions?.some((p) =>
    IT_TITLE_KEYWORDS.some((k) => p.title.toLowerCase().includes(k))
  ) ?? false;

  if (!hasITExp) return 'Junior';

  switch (careerProfile?.techLiteracy) {
    case 'advanced':      return 'Senior';
    case 'intermediate':  return 'Pleno';
    default:              return 'Junior';
  }
}

/** Calculates a 0-100 match score for a job based on:
 *  - Overlap between the candidate's GitHub tech stack and the job text (60 pts)
 *  - Match with desiredAreas from the career profile (20 pts)
 *  - Match with hiddenSkills from the career profile (20 pts)
 *
 *  Falls back to 70 when no profile signals are available. */
function scoreJobByProfile(
  job: { title: string; description: string },
  techStack: string[],
  careerProfile?: CareerProfile,
): number {
  const hasSignals = techStack.length > 0 ||
    (careerProfile?.desiredAreas?.length ?? 0) > 0 ||
    (careerProfile?.hiddenSkills?.length ?? 0) > 0;

  if (!hasSignals) return 70;

  const text = `${job.title} ${job.description}`.toLowerCase();
  let score = 20; // base score so a partial match doesn't show 0

  // Tech stack overlap — up to 60 pts
  if (techStack.length) {
    const hits = techStack.filter((t) => text.includes(t.toLowerCase()));
    score += Math.round((hits.length / techStack.length) * 60);
  }

  // Desired areas — up to 20 pts
  if (careerProfile?.desiredAreas?.length) {
    const hit = careerProfile.desiredAreas.some((a) => text.includes(a.toLowerCase()));
    if (hit) score += 20;
  }

  // Hidden skills — up to 20 pts
  if (careerProfile?.hiddenSkills?.length) {
    const hits = careerProfile.hiddenSkills.filter((s) => text.includes(s.toLowerCase()));
    score += Math.round((hits.length / careerProfile.hiddenSkills.length) * 20);
  }

  return Math.min(score, 100);
}

// ── Portuguese query expansion ────────────────────────────────────

/** Maps area terms (all professional areas) to concrete PT-BR job-title queries
 *  that Brazilian boards (Gupy, Remotive, etc.) actually understand.
 *  Ordered by seniority: junior / assistente first so results skew entry-level. */
// Queries curtas (2-3 palavras) — Gupy faz match de substring no título.
// "analista de logistica junior" → 0 resultado porque vagas se chamam só "Analista de Logística".
// Nível não entra na query; o match scoring cuida de priorizar vagas adequadas ao perfil.
const AREA_BR_EXPANSIONS: Record<string, string[]> = {
  // ── T.I / Tecnologia ──────────────────────────────────────────────
  'tecnologia da informacao': ['desenvolvedor', 'analista de sistemas', 'suporte ti'],
  'tecnologia':               ['desenvolvedor', 'analista de ti'],
  'ti':                       ['desenvolvedor', 'analista ti', 'suporte tecnico'],
  'desenvolvimento web':      ['desenvolvedor web', 'desenvolvedor fullstack'],
  'desenvolvimento de software': ['desenvolvedor software', 'programador'],
  'backend':                  ['desenvolvedor backend', 'engenheiro backend'],
  'frontend':                 ['desenvolvedor frontend', 'desenvolvedor react'],
  'full stack':               ['desenvolvedor fullstack', 'desenvolvedor full stack'],
  'dados':                    ['analista de dados', 'analista bi', 'engenheiro de dados'],
  'data science':             ['cientista de dados', 'analista de dados'],
  'engenharia de dados':      ['engenheiro de dados', 'analista de dados'],
  'machine learning':         ['engenheiro machine learning', 'cientista de dados'],
  'devops':                   ['engenheiro devops', 'analista infraestrutura'],
  'mobile':                   ['desenvolvedor mobile', 'desenvolvedor android', 'desenvolvedor flutter'],
  'seguranca':                ['analista seguranca', 'analista ciberseguranca'],
  'suporte':                  ['analista de suporte', 'tecnico suporte', 'helpdesk'],
  'design':                   ['designer ux', 'designer ui', 'web designer'],
  // ── Administrativo / Escritório ───────────────────────────────────
  'administrativo':           ['assistente administrativo', 'auxiliar administrativo', 'analista administrativo'],
  'administracao':            ['assistente administrativo', 'auxiliar administrativo'],
  'secretaria':               ['secretaria executiva', 'assistente administrativo'],
  // ── Financeiro / Contábil ─────────────────────────────────────────
  'financas':                 ['assistente financeiro', 'analista financeiro', 'auxiliar financeiro'],
  'financeiro':               ['assistente financeiro', 'analista financeiro'],
  'contabilidade':            ['assistente contabil', 'analista contabil', 'auxiliar contabil'],
  'fiscal':                   ['assistente fiscal', 'analista fiscal'],
  'controladoria':            ['analista controladoria', 'assistente controladoria'],
  // ── Recursos Humanos ──────────────────────────────────────────────
  'recursos humanos':         ['assistente rh', 'analista rh', 'analista recrutamento'],
  'rh':                       ['analista rh', 'assistente recursos humanos', 'recrutamento selecao'],
  'recrutamento':             ['analista recrutamento', 'assistente recrutamento'],
  // ── Vendas / Comercial ────────────────────────────────────────────
  'vendas':                   ['assistente comercial', 'analista vendas', 'representante comercial', 'vendedor'],
  'comercial':                ['assistente comercial', 'analista comercial'],
  'marketing':                ['assistente marketing', 'analista marketing', 'analista midia'],
  'inside sales':             ['sdr', 'representante vendas'],
  // ── Logística / Operacional ───────────────────────────────────────
  'logistica':                ['assistente logistica', 'auxiliar logistica', 'analista logistica', 'operador logistica'],
  'supply chain':             ['analista supply chain', 'assistente suprimentos'],
  'compras':                  ['assistente compras', 'analista compras'],
  // ── Saúde ──────────────────────────────────────────────────────────
  'saude':                    ['tecnico enfermagem', 'auxiliar saude', 'assistente farmacia'],
  'enfermagem':               ['tecnico enfermagem', 'auxiliar enfermagem'],
  // ── Educação ──────────────────────────────────────────────────────
  'educacao':                 ['professor', 'instrutor', 'tutor'],
  'pedagogia':                ['professor', 'auxiliar de sala'],
  // ── Jurídico ──────────────────────────────────────────────────────
  'juridico':                 ['advogado', 'assistente juridico', 'analista juridico'],
  'direito':                  ['advogado', 'assistente juridico', 'analista juridico'],
  'advocacia':                ['advogado', 'advogado associado', 'advogado trabalhista'],
  'trabalhista':              ['advogado trabalhista', 'analista trabalhista'],
  'tributario':               ['advogado tributario', 'analista tributario'],
  'contratos':                ['analista contratos', 'advogado contratos'],
  'compliance':               ['analista compliance', 'assistente compliance'],
  'licitacoes':               ['analista licitacoes', 'assistente licitacoes'],
  'oab':                      ['advogado', 'advogado associado', 'advogado junior'],
  // ── Construção / Engenharia ────────────────────────────────────────
  'construcao':               ['auxiliar manutencao', 'tecnico manutencao', 'eletricista'],
  'engenharia civil':         ['engenheiro civil', 'tecnico edificacoes'],
  // ── Atendimento / Relacionamento ─────────────────────────────────
  'atendimento':              ['assistente atendimento', 'atendente', 'analista relacionamento'],
  'customer success':         ['analista customer success', 'customer success'],
  // ── Produto ───────────────────────────────────────────────────────
  'produto':                  ['analista produto', 'product manager'],
  // ── Genérico / fallback ───────────────────────────────────────────
  'estagio':                  ['estagiario administrativo', 'estagiario ti', 'estagio'],
  'trainee':                  ['trainee', 'programa trainee'],
};

/** Normalises a technology name for use in Brazilian job title queries.
 *  e.g. "JavaScript" → "desenvolvedor JavaScript",  "React" → "desenvolvedor React" */
function techToPortugueseQuery(tech: string): string {
  const skip = new Set(['web', 'api', 'open-source', 'linux', 'git', 'docker', 'cli', 'tool', 'library', 'framework']);
  if (skip.has(tech.toLowerCase())) return '';
  return `desenvolvedor ${tech}`;
}

/** Normaliza string para lookup no AREA_BR_EXPANSIONS (sem acento, lowercase) */
function normalizeKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Gera queries amplas a partir do perfil completo do usuário.
 * Substitui buildFallbackQueries quando há perfil de carreira disponível.
 *
 * Estratégia:
 *  1. Expande todas as desiredAreas (não só 2) via AREA_BR_EXPANSIONS
 *  2. Usa transitionTarget como sinal adicional
 *  3. Inclui hiddenSkills como queries diretas
 *  4. Adiciona "desenvolvedor X" para tech stack GitHub
 *  5. Nunca filtra demais — retorna até 10 queries diversas
 */
function buildProfileDefaultQueries(
  careerProfile?: CareerProfile,
  techStack: string[] = [],
  baseQueries: string[] = [],
): string[] {
  const queries = new Set<string>();

  // 1. Todas as desiredAreas com expansão completa
  for (const area of careerProfile?.desiredAreas ?? []) {
    const key = normalizeKey(area);
    const expanded = AREA_BR_EXPANSIONS[key];
    if (expanded) {
      expanded.slice(0, 2).forEach((e) => queries.add(e));
    } else {
      // Área não mapeada: usa como query direta (pode ser cargo específico)
      queries.add(area);
    }
  }

  // 2. transitionTarget como sinal forte
  if (careerProfile?.transitionTarget) {
    const key = normalizeKey(careerProfile.transitionTarget);
    const expanded = AREA_BR_EXPANSIONS[key];
    if (expanded) {
      expanded.slice(0, 2).forEach((e) => queries.add(e));
    } else {
      queries.add(careerProfile.transitionTarget);
    }
  }

  // 3. hiddenSkills técnicas como queries (ex: "análise de dados", "power bi")
  //    Exclui soft skills e frases longas que nunca aparecem em títulos de vagas
  const SOFT_SKILL_WORDS = /capacidade|habilidade|informal|liderança|comunic|trabalho em equipe|proativ|organiz|responsab|relacionamento/i;
  for (const skill of careerProfile?.hiddenSkills?.slice(0, 4) ?? []) {
    // Só inclui se: curto (≤ 25 chars), sem espaços múltiplos, sem palavras de soft skill
    if (skill.length <= 25 && skill.trim().split(/\s+/).length <= 3 && !SOFT_SKILL_WORDS.test(skill)) {
      queries.add(skill.trim());
    }
  }

  // 4. GitHub tech stack → "desenvolvedor X"
  for (const tech of techStack.slice(0, 3)) {
    const q = techToPortugueseQuery(tech);
    if (q) queries.add(q);
  }

  // 6. Base queries como fallback (só se queries ainda insuficientes)
  if (queries.size < 3) {
    for (const q of baseQueries.filter(Boolean)) {
      const key = normalizeKey(q);
      const expanded = AREA_BR_EXPANSIONS[key];
      if (expanded) expanded.slice(0, 2).forEach((e) => queries.add(e));
      else queries.add(q);
    }
  }

  // Garante ao menos uma query genérica se tudo falhou
  if (queries.size === 0) queries.add('analista junior');

  return [...queries].slice(0, 10);
}


// ── PT-BR language filter ─────────────────────────────────────────

/** Palavras que indicam título em inglês (não PT-BR) */
const EN_TITLE_WORDS = new Set([
  'engineer','manager','developer','designer','analyst','specialist',
  'coordinator','director','officer','lead','head','staff','principal',
  'associate','intern','consultant','architect','scientist','researcher',
  'accountant','recruiter','representative','executive','administrator',
]);

/**
 * Retorna true se o título da vaga parece estar em português.
 * Heurística: não contém palavras-chave exclusivamente em inglês,
 * OU tem pelo menos uma palavra claramente portuguesa.
 */
function isPtBrTitle(title: string): boolean {
  const words = title.toLowerCase().split(/\s+/);
  const hasPtWord = words.some((w) =>
    /^(analista|assistente|auxiliar|operador|supervisor|gerente|coordenador|técnico|desenvolvedor|programador|estagi|trainee|jovem|aprendiz|vendedor|atendente|motorista|enfermeiro|professor|contador|advogado|engenheiro|arquiteto|diretor|consultor|especialista|agente|recepcionista|almoxarife|fiscal)/.test(w)
  );
  if (hasPtWord) return true;

  const hasEnWord = words.some((w) => EN_TITLE_WORDS.has(w.replace(/[^a-z]/g, '')));
  return !hasEnWord; // se não tem palavra inglesa clara, aceita
}

// ── Level inference from job title ───────────────────────────────
/**
 * Infere o nível de senioridade a partir do título da vaga.
 * Retorna null quando o título não indica nível (usa o do perfil como fallback).
 */
function inferLevelFromTitle(title: string): 'Junior' | 'Pleno' | 'Senior' | null {
  const t = title.toLowerCase();

  // Senior keywords
  if (/\b(staff|principal|senior|sênior|sr\.?\s|lead|head|director|diretor|gerente|manager|vp\b|c-level|cto|coo|cfo|ceo|arquiteto|architect)\b/.test(t)) return 'Senior';

  // Pleno keywords
  if (/\b(pleno|pl\.?\s|mid[- ]?level|mid\b)\b/.test(t)) return 'Pleno';

  // Junior keywords
  if (/\b(junior|júnior|jr\.?\s|trainee|aprendiz|estagi[aá]rio|auxiliar|assistente)\b/.test(t)) return 'Junior';

  return null; // título não indica nível
}

// ── Direct job-board fallback (Remotive + Gupy, no AI) ────────────

/** Robust fallback used when both Claude and Gemini are unavailable.
 *  Builds smart queries from the career profile + GitHub tech stack,
 *  scores results by real skill overlap, and infers the candidate level
 *  automatically — no AI required. */
async function fetchDirectJobs(
  baseQueries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  careerProfile?: CareerProfile,
  githubUsername?: string | null,
  positions?: LinkedInPosition[],
  education?: LinkedInEducation[],
): Promise<ProfessionSearchResult> {
  // Fetch GitHub tech stack (fast, free, no quota)
  const github = githubUsername
    ? await fetchGithubData(githubUsername).catch(() => EMPTY_GITHUB)
    : EMPTY_GITHUB;

  const techStack = github.techStack;

  // Build smart queries using all available profile signals
  // buildProfileDefaultQueries usa TODO o perfil (todas as áreas, skills, transição)
  // para gerar até 10 queries amplas — não apenas as 2 primeiras desiredAreas
  const queries = buildProfileDefaultQueries(careerProfile, techStack, baseQueries);
  console.log('[fetchDirectJobs] queries geradas:', queries);

  // Infer level without AI
  const level = inferLevelFromProfile(careerProfile, positions);

  // Auto-infer user location from LinkedIn when not explicitly set.
  // Detected city is passed to Gupy's city filter for proximity-prioritised results.
  const userCtx = inferUserContext(positions ?? [], education ?? []);
  const effectivePreferences: UserPreferences | undefined = (() => {
    if (!userCtx.inferredCity || preferences?.location) return preferences;
    return { ...(preferences ?? { modality: 'any', location: '', salaryMin: '', salaryMax: '', level: 'any' }), location: userCtx.inferredCity };
  })();

  const wantRemote = preferences?.modality === 'remote';
  const allBlocked = [...(blockedKeywords ?? []), ...(careerProfile?.blockedAreas ?? [])];

  // Detecta perfil de TI para incluir Programathor (RSS de vagas tech BR)
  const isTechProfile = (careerProfile?.desiredAreas ?? [])
    .some((a) => /ti\b|tecnologia|software|dados|dev|front|back|full|mobile|devops/i.test(a));

  // Busca em todas as fontes em paralelo
  const [gupy, adzuna, jooble, sine, remotive, programathor] = await Promise.all([
    searchGupyJobs(queries, effectivePreferences).catch((e) => { console.error('[gupy]', e); return []; }),
    searchAdzunaJobs(queries, effectivePreferences, allBlocked).catch((e) => { console.error('[adzuna]', e); return []; }),
    searchJoobleJobs(queries, effectivePreferences, allBlocked).catch((e) => { console.error('[jooble]', e); return []; }),
    searchSineJobs(queries, effectivePreferences, allBlocked).catch((e) => { console.error('[sine]', e); return []; }),
    searchRemotiveJobs(queries, effectivePreferences).catch((e) => { console.error('[remotive]', e); return []; }),
    isTechProfile ? fetchProgramathorJobs().catch(() => []) : Promise.resolve([]),
  ]);

  // Remotive só quando usuário quer remoto ou fontes nacionais retornaram pouco
  const nationalCount = gupy.length + adzuna.length + jooble.length + sine.length + programathor.length;
  const remotiveCap = wantRemote
    ? remotive.length
    : nationalCount < 5
      ? Math.min(remotive.length, 3)
      : 0;

  const allRaw = [...gupy, ...adzuna, ...jooble, ...sine, ...programathor, ...remotive.slice(0, remotiveCap)];

  const ptBrOnly = preferences?.ptBrOnly ?? false;

  const jobs = allRaw
    .filter((j) => !isBlocked(j.title, allBlocked))
    .filter((j) => !isPcdExclusive(j.title))
    .filter((j) => !ptBrOnly || isPtBrTitle(j.title))
    .map((j) => {
      const match = scoreJobByProfile({ title: j.title, description: j.description }, techStack, careerProfile);
      const jobText = `${j.title} ${j.description}`.toLowerCase();
      const tags = techStack.filter((t) => jobText.includes(t.toLowerCase())).slice(0, 6);

      // Nível inferido do TÍTULO da vaga (não do perfil do candidato)
      // para evitar mostrar "Staff Engineer" como Júnior
      const jobLevel = inferLevelFromTitle(j.title) ?? level;

      return {
        title:       j.title,
        company:     j.company,
        level:       jobLevel,
        remote:      j.location?.toLowerCase().includes('remot') ?? false,
        location:    j.location ?? null,
        tags,
        description: j.description.slice(0, 200),
        salary:      j.salary ?? null,
        link:        j.link ?? null,
        match,
        ...(j.published_at ? { published_at: j.published_at } : {}),
      };
    })
    .filter((j) => !techStack.length || j.match >= 10)
    .sort((a, b) => b.match - a.match)
    .slice(0, 30);

  // Build a meaningful profile summary without "Em transição" language
  const techLabel  = techStack.slice(0, 3).join(', ');
  const levelLabel = level === 'Junior' ? 'Júnior' : level === 'Pleno' ? 'Pleno' : 'Sênior';
  const areaLabel  = careerProfile?.transitionTarget
    ?? careerProfile?.desiredAreas?.[0]
    ?? baseQueries[0]
    ?? 'Vagas';

  const summary = techLabel
    ? `${areaLabel} | ${levelLabel} | ${techLabel}`
    : `${areaLabel} | ${levelLabel}`;

  return { profileSummary: summary, jobs };
}

// ── Entry point ───────────────────────────────────────────────────

/** Applies blockedKeywords + careerProfile.blockedAreas hard filter to a result set.
 *  Used to sanitize Gemini fallback results that bypass the Claude-level filter. */
function applyBlockFilter(
  result: ProfessionSearchResult,
  blockedKeywords?: string[],
  careerProfile?: CareerProfile,
): ProfessionSearchResult {
  const allBlocked = [...(blockedKeywords ?? []), ...(careerProfile?.blockedAreas ?? [])];
  return {
    ...result,
    jobs: result.jobs
      .filter((job) => !isPcdExclusive(job.title))
      .filter((job) => !allBlocked.length || !isBlocked(job.title, allBlocked)),
  };
}

export async function findProfessionJobs(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
  blockedSources?: string[],
  likedSources?: string[],
  careerProfile?: CareerProfile,
  githubUsername?: string | null,
): Promise<ProfessionSearchResult> {
  const isTransition = !!(careerProfile?.transitionReady && careerProfile.transitionTarget);

  // Helper: when the LinkedIn-based search fails or returns 0 useful jobs,
  // fall back to a clean text-query search focused on the target area.
  // The last resort uses the smart script-based fallback with GitHub tech stack.
  async function fallback(): Promise<ProfessionSearchResult> {
    if (isTransition) {
      const target     = careerProfile!.transitionTarget as string;
      const allBlocked = [...(blockedKeywords ?? []), ...(careerProfile!.blockedAreas ?? [])];

      // Step 1: Try Claude text-query for the target area
      console.warn('[profession] fallback: Claude query para alvo de transição:', target);
      try {
        const qResult = await findJobsByQueryClaude(target, preferences, allBlocked, blockedSources, likedSources, careerProfile);
        if (qResult && qResult.jobs.length > 0) return qResult;
      } catch {
        // fall through
      }

      // Step 2: Try Gemini
      try {
        const geminiResult = await findJobsByQueryGemini(target, preferences);
        const filtered = applyBlockFilter(geminiResult, blockedKeywords, careerProfile);
        if (filtered.jobs.length > 0) return filtered;
        console.warn('[profession] Gemini retornou 0 vagas úteis (transition)');
      } catch (err) {
        console.warn('[profession] Gemini erro (transition):', (err as Error)?.message ?? err);
      }

      // Step 3: Smart script fallback — GitHub tech stack + career profile signals
      console.warn('[profession] fallback final: script com GitHub + perfil de carreira');
      return fetchDirectJobs(
        [target, ...(careerProfile!.desiredAreas ?? [])],
        preferences, allBlocked, careerProfile, githubUsername, positions, education,
      );
    }

    // Non-transition: try Gemini, then smart script fallback
    try {
      const result = applyBlockFilter(
        await findProfessionJobsGemini(positions, education, certifications, preferences),
        blockedKeywords, careerProfile,
      );
      if (result.jobs.length > 0) return result;
    } catch {
      // fall through
    }

    // Last resort: smart script fallback
    console.warn('[profession] fallback final non-transition: script com GitHub + perfil de carreira');
    const baseQuery = careerProfile?.desiredAreas?.[0] ?? positions[0]?.title ?? 'vagas';
    return fetchDirectJobs(
      [baseQuery],
      preferences, blockedKeywords, careerProfile, githubUsername, positions, education,
    );
  }

  // Se o usuário tem OAB, estágios/trainee são irrelevantes — filtra em todo resultado
  const userHasOAB = hasOAB(certifications, positions);
  function applyInternFilter(result: ProfessionSearchResult): ProfessionSearchResult {
    if (!userHasOAB) return result;
    const filtered = result.jobs.filter((j) => !isInternJob(j.title));
    if (filtered.length < result.jobs.length) {
      console.log(`[profession] OAB detectada → removidas ${result.jobs.length - filtered.length} vaga(s) de estágio/trainee`);
    }
    return { ...result, jobs: filtered };
  }

  const maxAgeDays = preferences?.maxAgeDays ?? 90;
  const levelPref   = preferences?.level ?? 'any';
  const ptBrOnly    = preferences?.ptBrOnly ?? false;

  function applyPreferenceFilters(result: ProfessionSearchResult): ProfessionSearchResult {
    let jobs = filterByMaxAge(result.jobs, maxAgeDays);
    jobs = filterByLevel(jobs, levelPref);
    jobs = filterByPtBr(jobs, ptBrOnly);
    if (jobs.length !== result.jobs.length)
      console.log(`[profession] pref-filters (age=${maxAgeDays}d level=${levelPref} ptBr=${ptBrOnly}) → ${result.jobs.length} → ${jobs.length}`);
    return { ...result, jobs };
  }

  try {
    const result = await findProfessionJobsClaude(positions, education, certifications, preferences, blockedKeywords, blockedSources, likedSources, careerProfile, githubUsername);
    if (result && result.jobs.length > 0) return applyPreferenceFilters(applyInternFilter(result));
    console.warn('[profession] Claude retornou 0 vagas úteis, ativando fallback...');
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[profession] Claude API error (${err.status}): ${err.message.slice(0, 200)}`);
    } else {
      console.error('[profession] Erro inesperado, ativando fallback:', (err as Error).message);
    }
  }
  return applyPreferenceFilters(applyInternFilter(await fallback()));
}
