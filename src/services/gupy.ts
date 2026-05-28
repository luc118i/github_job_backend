import { UserPreferences } from '../types';
import { AdzunaJob } from './adzuna';

interface GupyRawJob {
  id: number;
  name: string;
  description: string | null;
  jobUrl: string;
  city: string | null;
  state: string | null;
  workplaceType: string; // 'remote' | 'hybrid' | 'on-site'
  company: { name: string };
  publishedAt?: string | null;
}

interface GupyResponse {
  data: GupyRawJob[];
}

function formatGupyLocation(job: GupyRawJob): string {
  if (job.workplaceType === 'remote') return 'Remoto';
  const city = [job.city, job.state].filter(Boolean).join(', ');
  if (job.workplaceType === 'hybrid') return city ? `Híbrido — ${city}` : 'Híbrido';
  return city || 'Brasil';
}

async function fetchGupyJobs(
  queries: string[],
  preferences?: UserPreferences,
  locationOverride?: string,
): Promise<AdzunaJob[]> {
  const topQueries = queries.slice(0, 3);
  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];
  const city = locationOverride !== undefined ? locationOverride : preferences?.location;

  const results = await Promise.allSettled(
    topQueries.map(async (q) => {
      const params = new URLSearchParams({ jobName: q, limit: '10' });
      if (city) params.set('city', city);
      if (preferences?.modality === 'remote') params.set('workplaceType', 'remote');
      else if (preferences?.modality === 'presencial') params.set('workplaceType', 'on-site');
      else if (preferences?.modality === 'hybrid') params.set('workplaceType', 'hybrid');

      const res = await fetch(`https://portal.api.gupy.io/api/v1/jobs?${params}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Gupy HTTP ${res.status}`);
      return ((await res.json()) as GupyResponse).data ?? [];
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      if (job.jobUrl && !seen.has(job.jobUrl)) {
        seen.add(job.jobUrl);
        jobs.push({
          title: job.name,
          company: job.company?.name ?? 'Empresa não informada',
          description: (job.description ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300),
          link: job.jobUrl,
          location: formatGupyLocation(job),
          source: 'Gupy',
          published_at: job.publishedAt ?? undefined,
        });
      }
    }
  }

  return jobs;
}

export async function searchGupyJobs(
  queries: string[],
  preferences?: UserPreferences,
): Promise<AdzunaJob[]> {
  // When a city is set (explicitly by the user or inferred from LinkedIn), try it first.
  // Gupy's city filter is strict and many cities return 0 results, so fall back to a
  // national search when the city-filtered pass comes up empty.
  const jobs = await fetchGupyJobs(queries, preferences);

  if (jobs.length === 0 && preferences?.location) {
    console.log(`[gupy] 0 vagas em "${preferences.location}", buscando nacional...`);
    const national = await fetchGupyJobs(queries, preferences, '');
    console.log(`[gupy] ${national.length} vagas encontradas (nacional)`);
    return national.slice(0, 20);
  }

  console.log(`[gupy] ${jobs.length} vagas encontradas`);
  return jobs.slice(0, 20);
}
