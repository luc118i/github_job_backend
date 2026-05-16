import { UserPreferences } from '../types';
import { isBlocked } from '../utils/inferCategory';

interface AdzunaRawJob {
  id: string;
  title: string;
  company: { display_name: string };
  description: string;
  redirect_url: string;
  location: { display_name: string };
  created: string;
  salary_min?: number;
  salary_max?: number;
}

interface AdzunaResponse {
  results: AdzunaRawJob[];
}

export interface AdzunaJob {
  title: string;
  company: string;
  description: string;
  link: string;
  location: string;
  salary?: string;
}

function formatSalary(min?: number, max?: number): string | undefined {
  if (!min && !max) return undefined;
  const fmt = (n: number) => `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `A partir de ${fmt(min)}`;
  return undefined;
}

export async function fetchAdzunaJobs(
  query: string,
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<AdzunaJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('ADZUNA_APP_ID ou ADZUNA_APP_KEY não configurados');

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: query,
    results_per_page: '10',
    sort_by: 'date',
  });

  if (preferences?.maxAgeDays) params.set('max_days_old', String(preferences.maxAgeDays));
  if (preferences?.location) params.set('where', preferences.location);
  if (blockedKeywords?.length) params.set('what_exclude', blockedKeywords.join(' '));

  const url = `https://api.adzuna.com/v1/api/jobs/br/search/1?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) throw new Error(`Adzuna error ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as AdzunaResponse;

  return (data.results ?? []).map((job) => ({
    title: job.title,
    company: job.company?.display_name ?? 'Empresa não informada',
    description: job.description.slice(0, 300),
    link: `https://www.adzuna.com.br/details/${job.id}`,
    location: job.location.display_name,
    salary: formatSalary(job.salary_min, job.salary_max),
  }));
}

const TECH_TITLE_KEYWORDS = [
  'desenvolvedor', 'developer', 'programador', 'programmer',
  'engenheiro de software', 'software engineer', 'engenheiro de sistemas',
  'analista de sistemas', 'analista de ti', 'analista de dados', 'analista de segurança',
  'cientista de dados', 'data scientist', 'engenheiro de dados', 'data engineer',
  'devops', 'sre', 'cloud', 'devsecops',
  'frontend', 'front-end', 'backend', 'back-end', 'fullstack', 'full stack', 'full-stack',
  'mobile', 'android', 'ios',
  'machine learning', 'inteligência artificial',
  'arquiteto de software', 'tech lead', 'líder técnico',
  'qa engineer', 'quality assurance', 'tester',
  'segurança da informação', 'cybersecurity',
  'blockchain', 'embedded', 'embarcado',
];

function isTechJob(job: AdzunaJob): boolean {
  const title = job.title.toLowerCase();
  return TECH_TITLE_KEYWORDS.some((kw) => title.includes(kw));
}

export async function searchAllQueries(
  queries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<AdzunaJob[]> {
  const results = await Promise.allSettled(
    queries.map((q) => fetchAdzunaJobs(q, preferences, blockedKeywords))
  );

  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      if (!isTechJob(job)) continue;
      const id = job.link.split('/').pop() ?? job.link;
      if (!seen.has(id)) {
        seen.add(id);
        jobs.push(job);
      }
    }
  }

  // Filtra categorias bloqueadas usando o mesmo mapa de inferência do frontend
  if (blockedKeywords?.length) {
    return jobs.filter((j) => !isBlocked(j.title, blockedKeywords));
  }

  return jobs;
}
