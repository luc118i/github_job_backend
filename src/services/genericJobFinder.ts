import Anthropic from '@anthropic-ai/sdk';
import { LinkedInPosition, LinkedInEducation, LinkedInCertification, ProfessionSearchResult, UserPreferences } from '../types';
import { findProfessionJobsGemini } from './gemini';
import { resolveJobLink } from './linkVerifier';
import { isBlocked } from '../utils/inferCategory';
import { isLawProfile, extractLawSpecialties, buildLawQueries } from '../utils/profileUtils';
import { fetchLegalJobs } from './legalJobs';

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
            link:        { type: 'string', description: 'URL da página da vaga encontrada via web_search em plataforma confiável (Gupy, Indeed, Glassdoor, Catho, InfoJobs). Use apenas links reais encontrados na pesquisa — nunca invente. Se não encontrou o link exato, retorne string vazia.' },
            match:       { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
  },
};

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

async function findProfessionJobsClaude(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<ProfessionSearchResult> {
  const lawProfile = isLawProfile(positions);
  const specialties = lawProfile ? extractLawSpecialties(positions) : [];

  const blockedNote = blockedKeywords?.length
    ? ` NÃO inclua vagas das categorias: ${blockedKeywords.join(', ')}.`
    : '';

  // Prompt e plataformas adaptados para perfil jurídico
  const systemPrompt = lawProfile
    ? `Você é um especialista em recrutamento jurídico.${blockedNote} Use web_search para encontrar vagas reais em plataformas jurídicas brasileiras: Jusbrasil Empregos (jusbrasil.com.br/empregos), Conjur (conjur.com.br), Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia e departamentos jurídicos de empresas. No campo link, coloque apenas URLs reais encontradas — nunca invente. NUNCA use links do LinkedIn.`
    : `Você é um especialista em recrutamento para todas as áreas profissionais.${blockedNote} Use web_search para encontrar vagas reais. No campo link, coloque apenas URLs reais encontradas em plataformas como Gupy, Indeed, Glassdoor, Catho, InfoJobs — nunca invente um link. Se não encontrar a URL exata, deixe o campo link vazio. NUNCA use links do LinkedIn.`;

  const specialtiesNote = specialties.length
    ? `\nÁreas de especialização identificadas: ${specialties.join(', ')}. Priorize vagas nessas áreas.`
    : '';

  const platformNote = lawProfile
    ? 'Jusbrasil Empregos, Conjur, Catho área jurídica, InfoJobs área jurídica, sites de escritórios de advocacia'
    : 'Glassdoor, Catho, InfoJobs, Gupy, Indeed ou site direto da empresa';

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
          content: `Pesquise 6 vagas reais publicadas nos últimos ${preferences?.maxAgeDays ?? 90} dias compatíveis com o perfil abaixo em: ${platformNote}. NÃO use links do LinkedIn. Para cada vaga inclua a URL real no campo link. Chame return_jobs com os resultados.${specialtiesNote}

Experiência: ${formatPositions(positions)}
Formação: ${formatEducation(education)}${formatCertifications(certifications)}${buildProfessionPrefsBlock(preferences)}`,
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
  const rawJobs = Array.isArray(result.jobs) ? result.jobs : [];
  const aiJobs = rawJobs
    .map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }))
    .filter((job) => !isBlocked(job.title, blockedKeywords ?? []));

  // Para perfis jurídicos, busca fontes especializadas em paralelo com o resultado da IA
  if (lawProfile) {
    const lawQueries = buildLawQueries(positions, specialties);
    const legalSourceJobs = await fetchLegalJobs(lawQueries, preferences, blockedKeywords);

    // Converte para o formato ProfessionJob para incluir no resultado
    const legalProfJobs = legalSourceJobs
      .filter((j) => !rawJobs.some((ai) => ai.link === j.link)) // evita duplicatas com IA
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
        match:       50, // score neutro — será re-ranqueado pelo cliente se necessário
      }));

    console.log(`[profession/law] claude: ${aiJobs.length} | fontes especializadas: ${legalProfJobs.length}`);
    return {
      profileSummary: result.profileSummary ?? '',
      jobs: [...aiJobs, ...legalProfJobs],
    };
  }

  return { profileSummary: result.profileSummary ?? '', jobs: aiJobs };
}

export async function findProfessionJobs(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<ProfessionSearchResult> {
  try {
    return await findProfessionJobsClaude(positions, education, certifications, preferences, blockedKeywords);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[profession] Claude API error (${err.status}), switching to Gemini...`);
      return findProfessionJobsGemini(positions, education, certifications, preferences);
    }
    throw err;
  }
}
