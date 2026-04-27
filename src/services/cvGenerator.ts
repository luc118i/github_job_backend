import Anthropic from '@anthropic-ai/sdk';
import { CvRequest, CvResponse, LinkedInPosition, LinkedInEducation } from '../types';
import { supabase } from './supabase';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um especialista em RH e otimização de currículos para ATS (Applicant Tracking System).
Gere currículos que:
1. Passem em filtros automáticos de ATS com alta taxa de aprovação
2. Sejam baseados APENAS em dados reais fornecidos — NUNCA invente experiências, empresas ou cursos
3. Usem keywords exatas da descrição da vaga no resumo profissional
4. Sejam escritos em português brasileiro
5. Retornem APENAS o Markdown do currículo, sem explicações adicionais
6. NUNCA usem emojis, símbolos decorativos ou caracteres especiais — apenas texto puro e Markdown padrão (# ## - **)`;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]/gu;

function stripEmojis(text: string): string {
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPositions(positions: LinkedInPosition[]): string {
  if (positions.length === 0) return '[PREENCHER]';
  return positions.slice(0, 4).map((p) => {
    const end = p.finishedOn ?? 'atual';
    const loc = p.location ? ` | ${p.location}` : '';
    const desc = p.description ? `\n  ${p.description.slice(0, 150)}` : '';
    return `- **${p.title}** @ ${p.company} (${p.startedOn} – ${end})${loc}${desc}`;
  }).join('\n');
}

function formatEducation(education: LinkedInEducation[]): string {
  if (education.length === 0) return '[PREENCHER]';
  return education.map((e) => {
    const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
    const notes = e.notes ? ` — ${e.notes.slice(0, 80)}` : '';
    return `- **${e.degree ?? 'Curso'}** @ ${e.school}${period ? ` (${period})` : ''}${notes}`;
  }).join('\n');
}

function buildPrompt(req: CvRequest): string {
  const { job, candidate } = req;

  const shortDesc = job.description.length > 600
    ? job.description.slice(0, 600) + '...'
    : job.description;

  const topRepos = candidate.repos
    .filter((r) => !r.fork)
    .slice(0, 3)
    .map((r) => {
      const stars = r.stargazers_count > 0 ? ` (${r.stargazers_count} stars)` : '';
      const lang = r.language ? ` | ${r.language}` : '';
      const desc = r.description ? ` — ${r.description.slice(0, 80)}` : '';
      return `- **${r.name}**${lang}${stars}${desc} | ${r.html_url}`;
    })
    .join('\n');

  const bio = candidate.githubBio ? `Bio: ${candidate.githubBio}` : '';

  return `Gere um currículo ATS-otimizado em Markdown. Retorne APENAS o Markdown, sem explicações.

VAGA: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remoto' : 'Presencial'}
Skills: ${job.skills.join(', ')}
Descrição: ${shortDesc}

CANDIDATO: ${candidate.name} | ${candidate.email ?? '[email]'} | github.com/${candidate.githubLogin}
${bio}
Linguagens GitHub: ${candidate.skills.join(', ')}
Repos: ${topRepos || '(nenhum)'}

EXPERIÊNCIA PROFISSIONAL (dados reais do LinkedIn):
${formatPositions(candidate.positions)}

FORMAÇÃO ACADÊMICA (dados reais do LinkedIn):
${formatEducation(candidate.education)}

ESTRUTURA OBRIGATÓRIA:
# ${candidate.name.toUpperCase()}
[contato]

## RESUMO PROFISSIONAL
[use keywords exatas: "${job.title}", "${job.skills.slice(0, 3).join('", "')}"]

## HABILIDADES TÉCNICAS
**Linguagens:** ... | **Ferramentas:** Git, GitHub, ...

## EXPERIÊNCIA PROFISSIONAL
[use os dados reais acima; se [PREENCHER], mantenha assim]

## PROJETOS RELEVANTES
[repos reais acima]

## FORMAÇÃO ACADÊMICA
[use os dados reais acima; se [PREENCHER], mantenha assim]

Regras: nunca invente dados; bullet points com verbos de ação; sem tabelas.`;
}

export async function generateCv(req: CvRequest): Promise<CvResponse> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(req) }],
  });

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const content = stripEmojis(raw);

  const { data, error } = await supabase
    .from('cvs')
    .insert({ job_id: req.job.id, content })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { cvId: data.id as string, content };
}
