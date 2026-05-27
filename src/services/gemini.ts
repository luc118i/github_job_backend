import { GoogleGenerativeAI } from '@google/generative-ai';
import { Job, JobSearchRequest, LinkedInPosition, LinkedInEducation, LinkedInCertification, ProfessionSearchResult, UserPreferences } from '../types';
import { resolveJobLink } from './linkVerifier';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOOGLE_SEARCH_TOOL: any = { googleSearch: {} };

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

function extractJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  if (!clean) throw new Error('Gemini retornou resposta vazia');
  const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini não retornou JSON válido');
  return JSON.parse(match[0]);
}

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 503 || status === 429) return true;
  const msg = (err as Error).message ?? '';
  return msg.includes('vazia') || msg.includes('JSON válido') || msg.includes('JSON.parse') || msg.includes('Unexpected token');
}

function buildPrefsBlock(prefs: UserPreferences | undefined): string {
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
  return lines.length ? '\n\nPREFERÊNCIAS (priorize):\n' + lines.join('\n') : '';
}

export async function findJobsGemini(profile: JobSearchRequest): Promise<Job[]> {
  const maxAge = profile.preferences?.maxAgeDays ?? 90;
  const platforms = 'Gupy, Indeed, Glassdoor, Catho, InfoJobs, Remotive, GeekHunter, Programathor, Trampos.co, LinkedIn Jobs, X/Twitter (#vagastech #hiringBR), Facebook (grupos públicos de vagas), Instagram (recrutadores tech), site direto da empresa';
  const prompt = `Pesquise 6 vagas de emprego reais publicadas nos últimos ${maxAge} dias compatíveis com o perfil abaixo nos seguintes canais: ${platforms}. Para vagas de redes sociais, priorize o link direto de candidatura. Ignore vagas com mais de ${maxAge} dias. Depois retorne APENAS o JSON.

PERFIL:
GitHub: ${profile.username}
Nome: ${profile.name}
${profile.bio ? `Bio: ${profile.bio}` : ''}
Linguagens: ${profile.skills.slice(0, 6).join(', ')}
Repositórios: ${profile.topRepos.join(', ')}${buildPrefsBlock(profile.preferences)}

Retorne APENAS um array JSON com 6 objetos (sem nenhum texto fora do JSON):
[{
  "title": "título da vaga",
  "company": "empresa",
  "level": "Junior|Pleno|Senior",
  "remote": true,
  "location": "Remoto ou Cidade, UF ou Híbrido - Cidade, UF",
  "skills": ["skill1", "skill2"],
  "description": "descrição em 2 linhas",
  "salary": null,
  "link": "URL real encontrada na pesquisa em Gupy/Indeed/Glassdoor/Catho/InfoJobs, ou string vazia se não encontrou"
}]`;

  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [GOOGLE_SEARCH_TOOL] as any,
        systemInstruction:
          'Você é um especialista em recrutamento tech. Sempre responda APENAS com JSON válido, sem texto antes ou depois. No campo link, coloque apenas URLs reais encontradas na pesquisa — nunca invente. Se não encontrou o link exato, deixe como string vazia.',
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log(`[jobs/gemini] ${modelName} resposta:`, text.slice(0, 200));
      const parsed = extractJson(text);
      const rawJobs: Job[] = Array.isArray(parsed)
        ? (parsed as Job[])
        : Array.isArray((parsed as Record<string, unknown>).jobs)
          ? ((parsed as Record<string, unknown>).jobs as Job[])
          : [];
      return rawJobs.map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) }));
    } catch (err) {
      if (isRetryableError(err)) {
        console.warn(`[jobs/gemini] ${modelName} falhou (${(err as Error).message}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function formatCertificationsGemini(certifications: LinkedInCertification[]): string {
  if (!certifications.length) return '';
  const items = certifications.map((c) => {
    const parts = [c.name];
    if (c.authority) parts.push(`(${c.authority})`);
    if (c.licenseNumber) parts.push(`nº ${c.licenseNumber}`);
    return parts.join(' ');
  });
  return '\nCertificações e habilitações profissionais: ' + items.join('; ');
}

export async function findProfessionJobsGemini(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  certifications: LinkedInCertification[],
  preferences?: UserPreferences
): Promise<ProfessionSearchResult> {
  const formattedPositions = positions.length
    ? positions.slice(0, 3).map((p) => `${p.title}, ${p.company} (${p.startedOn}–${p.finishedOn ?? 'atual'})`).join('; ')
    : 'Sem experiência';

  const formattedEducation = education.length
    ? education.slice(0, 2).map((e) => `${e.degree ?? 'Curso'}, ${e.school}`).join('; ')
    : 'Sem formação';

  const maxAge = preferences?.maxAgeDays ?? 90;
  const platforms2 = 'Gupy, Indeed, Glassdoor, Catho, InfoJobs, Remotive, GeekHunter, Programathor, Trampos.co, LinkedIn Jobs, X/Twitter (#vagastech #hiringBR), Facebook (grupos públicos de vagas), Instagram (recrutadores), site direto da empresa';
  const prompt = `Pesquise 6 vagas reais publicadas nos últimos ${maxAge} dias compatíveis com o perfil nos seguintes canais: ${platforms2}. Para vagas de redes sociais, priorize o link direto de candidatura. Ignore vagas com mais de ${maxAge} dias. Depois retorne APENAS o JSON.

Experiência: ${formattedPositions}
Formação: ${formattedEducation}${formatCertificationsGemini(certifications)}${buildPrefsBlock(preferences)}

Retorne APENAS este JSON (sem nenhum texto fora do JSON):
{
  "profileSummary": "Profissão | Nível | Destaque principal",
  "jobs": [{
    "title": "título real da vaga",
    "company": "empresa real",
    "level": "Junior|Pleno|Senior",
    "remote": false,
    "location": "Cidade, UF ou Remoto ou Híbrido - Cidade, UF",
    "tags": ["área de atuação"],
    "description": "descrição concisa em 1-2 linhas",
    "salary": null,
    "link": "URL real encontrada na pesquisa em Gupy/Indeed/Glassdoor/Catho/InfoJobs, ou string vazia se não encontrou",
    "match": 85
  }]
}`;

  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [GOOGLE_SEARCH_TOOL] as any,
        systemInstruction:
          'Você é um especialista em recrutamento para todas as áreas profissionais. Sempre responda APENAS com JSON válido, sem texto antes ou depois. No campo link, coloque apenas URLs reais encontradas na pesquisa — nunca invente. Se não encontrou o link exato, deixe como string vazia.',
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log(`[profession/gemini] ${modelName} resposta:`, text.slice(0, 200));
      const parsed = extractJson(text) as Record<string, unknown>;
      const rawJobs = Array.isArray(parsed.jobs) ? (parsed.jobs as ProfessionSearchResult['jobs']) : [];
      return {
        profileSummary: (parsed.profileSummary as string) ?? '',
        jobs: rawJobs.map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) })),
      };
    } catch (err) {
      if (isRetryableError(err)) {
        console.warn(`[profession/gemini] ${modelName} falhou (${(err as Error).message}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function findJobsByQueryGemini(
  query: string,
  preferences?: UserPreferences,
): Promise<ProfessionSearchResult> {
  const maxAge = preferences?.maxAgeDays ?? 90;
  const platforms = 'Gupy, Indeed, Glassdoor, Catho, InfoJobs, Remotive, GeekHunter, Programathor, Trampos.co, LinkedIn Jobs, X/Twitter (#vagastech #hiringBR), Facebook (grupos públicos de vagas), site direto da empresa';
  const prompt = `Pesquise 6 vagas reais publicadas nos últimos ${maxAge} dias para a busca: "${query}". Canais: ${platforms}.${buildPrefsBlock(preferences)}

Retorne APENAS este JSON (sem nenhum texto fora do JSON):
{
  "profileSummary": "Busca: ${query}",
  "jobs": [{
    "title": "título real da vaga",
    "company": "empresa real",
    "level": "Junior|Pleno|Senior",
    "remote": false,
    "location": "Cidade, UF ou Remoto",
    "tags": ["skill1", "skill2"],
    "description": "descrição concisa em 1-2 linhas",
    "salary": null,
    "link": "URL real encontrada na pesquisa, ou string vazia",
    "match": 80
  }]
}`;

  let lastErr: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [GOOGLE_SEARCH_TOOL] as any,
        systemInstruction:
          'Você é um especialista em recrutamento para todas as áreas profissionais. Sempre responda APENAS com JSON válido, sem texto antes ou depois. No campo link, coloque apenas URLs reais encontradas na pesquisa — nunca invente.',
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      console.log(`[query/gemini] ${modelName} resposta:`, text.slice(0, 200));
      const parsed = extractJson(text) as Record<string, unknown>;
      const rawJobs = Array.isArray(parsed.jobs) ? (parsed.jobs as ProfessionSearchResult['jobs']) : [];
      return {
        profileSummary: (parsed.profileSummary as string) ?? `Busca: ${query}`,
        jobs: rawJobs.map((job) => ({ ...job, link: resolveJobLink(job.link, job.title, job.company) })),
      };
    } catch (err) {
      if (isRetryableError(err)) {
        console.warn(`[query/gemini] ${modelName} falhou (${(err as Error).message}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
