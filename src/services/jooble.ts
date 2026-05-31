import { AdzunaJob } from './adzuna';
import { UserPreferences } from '../types';
import { isBlocked } from '../utils/inferCategory';

interface JoobleRawJob {
  title: string;
  location: string;
  snippet: string;        // descrição resumida
  salary: string;
  source: string;
  type: string;
  link: string;
  company: string;
  updated: string;        // data de atualização ISO
}

interface JoobleResponse {
  totalCount: number;
  jobs: JoobleRawJob[];
}

async function fetchJoobleJobs(
  query: string,
  location: string,
): Promise<AdzunaJob[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) throw new Error('JOOBLE_API_KEY não configurada');

  const body = JSON.stringify({
    keywords: query,
    location,
    page: '1',
    resultsOnPage: '15',
  });

  const res = await fetch(`https://br.jooble.org/api/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 403) {
    console.warn('[jooble] Chave inválida ou expirada (403) — regenere em https://jooble.org/api/about');
    return [];
  }
  if (!res.ok) throw new Error(`Jooble error ${res.status}`);

  const data = (await res.json()) as JoobleResponse;

  return (data.jobs ?? []).map((job) => ({
    title:        job.title,
    company:      job.company || 'Empresa não informada',
    description:  job.snippet?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
    link:         job.link,
    location:     job.location || 'Brasil',
    salary:       job.salary || undefined,
    source:       'Jooble',
    published_at: job.updated ?? undefined,
  }));
}

/**
 * Busca vagas no Jooble para múltiplas queries em paralelo.
 * Jooble agrega vagas de Indeed, Catho, InfoJobs, Vagas.com.br e outros — boa cobertura BR.
 * Retorna até 40 vagas deduplicadas.
 */
export async function searchJoobleJobs(
  queries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
): Promise<AdzunaJob[]> {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    console.warn('[jooble] JOOBLE_API_KEY não configurada — pulando');
    return [];
  }

  // Localização: usa estado/cidade do usuário ou vazio (nacional)
  const location = preferences?.location ?? '';
  const topQueries = queries.slice(0, 5);

  const results = await Promise.allSettled(
    topQueries.map((q) => fetchJoobleJobs(q, location))
  );

  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      if (!seen.has(job.link)) {
        seen.add(job.link);
        jobs.push(job);
      }
    }
  }

  const filtered = blockedKeywords?.length
    ? jobs.filter((j) => !isBlocked(j.title, blockedKeywords))
    : jobs;

  console.log(`[jooble] ${filtered.length} vagas encontradas`);
  return filtered.slice(0, 40);
}
