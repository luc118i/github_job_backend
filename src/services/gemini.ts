import { GoogleGenerativeAI } from '@google/generative-ai';
import { Job, JobSearchRequest, LinkedInPosition, LinkedInEducation, ProfessionSearchResult, UserPreferences } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOOGLE_SEARCH_TOOL: any = { googleSearch: {} };

function extractJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('Gemini não retornou JSON válido');
  return JSON.parse(match[0]);
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
  return lines.length ? '\n\nPREFERÊNCIAS (priorize):\n' + lines.join('\n') : '';
}

export async function findJobsGemini(profile: JobSearchRequest): Promise<Job[]> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [GOOGLE_SEARCH_TOOL] as any,
    systemInstruction:
      'Você é um especialista em recrutamento tech. Sempre responda APENAS com JSON válido, sem texto antes ou depois.',
  });

  const result = await model.generateContent(
    `Pesquise 6 vagas de emprego reais publicadas nos últimos 30 dias compatíveis com o perfil abaixo no LinkedIn, Glassdoor ou similar. Ignore vagas com mais de 30 dias. Depois retorne APENAS o JSON.

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
  "link": "url da vaga ou null"
}]`
  );

  const text = result.response.text();
  console.log('[jobs/gemini] resposta:', text.slice(0, 200));

  const parsed = extractJson(text);
  if (Array.isArray(parsed)) return parsed as Job[];
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.jobs) ? (obj.jobs as Job[]) : [];
}

export async function findProfessionJobsGemini(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
  preferences?: UserPreferences
): Promise<ProfessionSearchResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [GOOGLE_SEARCH_TOOL] as any,
    systemInstruction:
      'Você é um especialista em recrutamento para todas as áreas profissionais. Sempre responda APENAS com JSON válido, sem texto antes ou depois.',
  });

  const formattedPositions = positions.length
    ? positions.slice(0, 3).map((p) => `${p.title}, ${p.company} (${p.startedOn}–${p.finishedOn ?? 'atual'})`).join('; ')
    : 'Sem experiência';

  const formattedEducation = education.length
    ? education.slice(0, 2).map((e) => `${e.degree ?? 'Curso'}, ${e.school}`).join('; ')
    : 'Sem formação';

  const result = await model.generateContent(
    `Pesquise 6 vagas reais publicadas nos últimos 30 dias compatíveis com o perfil abaixo no LinkedIn, Catho ou InfoJobs. Ignore vagas com mais de 30 dias. Depois retorne APENAS o JSON.

Experiência: ${formattedPositions}
Formação: ${formattedEducation}${buildPrefsBlock(preferences)}

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
    "link": null,
    "match": 85
  }]
}`
  );

  const text = result.response.text();
  console.log('[profession/gemini] resposta:', text.slice(0, 200));

  const parsed = extractJson(text) as Record<string, unknown>;
  return {
    profileSummary: (parsed.profileSummary as string) ?? '',
    jobs: Array.isArray(parsed.jobs) ? (parsed.jobs as ProfessionSearchResult['jobs']) : [],
  };
}
