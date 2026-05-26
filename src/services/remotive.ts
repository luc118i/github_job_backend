import { UserPreferences } from '../types';
import { AdzunaJob } from './adzuna';

interface RemotiveRawJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location: string;
  description: string;
  salary: string;
  tags: string[];
  publication_date: string;
}

interface RemotiveResponse {
  'job-count': number;
  jobs: RemotiveRawJob[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchRemotiveJobs(
  queries: string[],
  preferences?: UserPreferences,
): Promise<AdzunaJob[]> {
  // Remotive only has remote jobs — skip if user wants strictly on-site
  if (preferences?.modality === 'presencial') return [];

  const topQueries = queries.slice(0, 2);
  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  const results = await Promise.allSettled(
    topQueries.map(async (q) => {
      const params = new URLSearchParams({ search: q, limit: '15' });
      const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Remotive HTTP ${res.status}`);
      return ((await res.json()) as RemotiveResponse).jobs ?? [];
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      if (!seen.has(job.url)) {
        seen.add(job.url);
        jobs.push({
          title: job.title,
          company: job.company_name,
          description: stripHtml(job.description).slice(0, 300),
          link: job.url,
          location: job.candidate_required_location || 'Remoto',
          salary: job.salary || undefined,
          source: 'Remotive',
        });
      }
    }
  }

  console.log(`[remotive] ${jobs.length} vagas encontradas`);
  return jobs.slice(0, 20);
}
