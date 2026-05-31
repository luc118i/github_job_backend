import { GoogleGenerativeAI } from '@google/generative-ai';
import { Job, JobSearchRequest, LinkedInPosition, LinkedInEducation, LinkedInCertification, ProfessionSearchResult, UserPreferences, CareerChatMessage, CareerProfile } from '../types';
import { resolveJobLink } from './linkVerifier';
import { buildPrefsBlock } from '../utils/buildPrefsBlock';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

// Ferramenta de busca do Google — necessária para o Gemini acessar vagas em tempo real
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOOGLE_SEARCH_TOOL: any = { googleSearch: {} };

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

function extractJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  if (!clean) throw new Error('Gemini retornou resposta vazia');
  const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini não retornou JSON válido');
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Gemini retornou JSON malformado: ${(e as Error).message}`);
  }
}

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 503 || status === 429) return true;
  const msg = (err as Error).message ?? '';
  return msg.includes('vazia') || msg.includes('JSON válido') || msg.includes('JSON.parse') || msg.includes('Unexpected token');
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

  let lastErr: unknown = new Error('Gemini: todos os modelos falharam');
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

  let lastErr: unknown = new Error('Gemini: todos os modelos falharam');
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

  let lastErr: unknown = new Error('Gemini: todos os modelos falharam');
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

// ── Career chat fallback ──────────────────────────────────────────
//
// Gemini doesn't support Anthropic tool-use format, so we use a
// text marker: the model outputs ##PROFILE_DONE## followed by JSON
// when it has enough info to finalise the profile.

const PROFILE_DONE_MARKER = '##PROFILE_DONE##';

const CAREER_DONE_INSTRUCTION = `

Para finalizar a análise: quando tiver coberto os temas necessários, termine sua mensagem normalmente e na linha seguinte coloque exatamente (sem texto depois do JSON):
##PROFILE_DONE##
{"techLiteracy":"basic","leadershipLevel":"low","workStyle":["analytical"],"desiredAreas":[],"blockedAreas":[],"hiddenSkills":[],"careerGoals":"objetivo","transitionReady":false,"transitionTarget":null,"personalitySummary":"resumo","potentialSummary":"potencial"}`;

export async function sendCareerMessageGemini(
  messages: CareerChatMessage[],
  systemPrompt: string,
): Promise<{ message?: string; profile?: CareerProfile; done: boolean }> {
  if (!messages.length) throw new Error('messages não pode ser vazio');

  let lastErr: unknown = new Error('Gemini: todos os modelos falharam');
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt + CAREER_DONE_INSTRUCTION,
      });

      // All messages except the last become chat history
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content }],
      }));

      const chat = model.startChat({ history });
      const lastMsg = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMsg.content);
      const text = result.response.text().trim();

      console.log(`[career/gemini] ${modelName} resposta:`, text.slice(0, 120));

      // Check if model signalled profile completion
      const doneIdx = text.indexOf(PROFILE_DONE_MARKER);
      if (doneIdx !== -1) {
        const jsonStr = text.slice(doneIdx + PROFILE_DONE_MARKER.length).trim();
        let profile: CareerProfile;
        try {
          profile = JSON.parse(jsonStr) as CareerProfile;
        } catch {
          // JSON malformado — continua sem perfil, trata como mensagem normal
          console.warn('[career/gemini] perfil JSON malformado, ignorando marker');
          return { done: false, message: text.slice(0, doneIdx).trim() || text };
        }
        // Human-readable closing message before the marker
        const closingMsg = text.slice(0, doneIdx).trim();
        console.log(`[career/gemini] perfil finalizado via ${modelName}`);
        return { done: true, profile, message: closingMsg || undefined };
      }

      return { done: false, message: text };
    } catch (err) {
      if (isRetryableError(err)) {
        console.warn(`[career/gemini] ${modelName} falhou (${(err as Error).message}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
