import Anthropic from '@anthropic-ai/sdk';
import { Job, JobSearchRequest } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  'Você é um especialista em recrutamento tech. Sempre responda APENAS com JSON válido, sem texto antes ou depois, sem markdown.';

const WEB_SEARCH_BETA = 'web-search-2025-03-05';

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

  return lines.filter(Boolean).join('\n');
}

function parseJobs(raw: string): Job[] {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed: unknown = JSON.parse(clean);
  return Array.isArray(parsed) ? (parsed as Job[]) : [];
}

export async function findJobs(profile: JobSearchRequest): Promise<Job[]> {
  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
      messages: [
        {
          role: 'user',
          content: `Analise este perfil e encontre 6 vagas de emprego reais e relevantes. Pesquise vagas atuais em sites como LinkedIn, Glassdoor, ou similar.

PERFIL:
${buildProfileSummary(profile)}

Retorne APENAS um JSON válido (sem markdown), array com exatamente 6 objetos:
[{
  "title": "título da vaga",
  "company": "empresa",
  "level": "Junior|Pleno|Senior",
  "remote": true/false,
  "skills": ["skill1", "skill2"],
  "description": "descrição em 2 linhas",
  "salary": "faixa salarial ou null",
  "link": "url da vaga ou null"
}]`,
        },
      ],
    },
    { headers: { 'anthropic-beta': WEB_SEARCH_BETA } }
  );

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return parseJobs(text);
}
