import { AdzunaJob } from './adzuna';

// API pública sem autenticação — limite generoso para uso não comercial
const API_BASE = 'https://remotive.com/api/remote-jobs';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  tags: string[];
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

interface RemotiveResponse {
  'job-count': number;
  jobs: RemotiveJob[];
}

// Categorias da Remotive relevantes para TI
const TECH_CATEGORIES = [
  'software-dev',
  'devops-sysadmin',
  'data',
  'qa',
  'backend',
  'frontend',
];

// Remove tags HTML e trunca — a Remotive manda descrição completa em HTML
function cleanDescription(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

export async function fetchRemotiveJobs(skills: string[]): Promise<AdzunaJob[]> {
  // Busca pela categoria principal + skills do perfil
  const search = skills.slice(0, 3).join(' ');
  const jobs: AdzunaJob[] = [];

  // Faz no máximo 2 categorias em paralelo para não sobrecarregar
  const categories = TECH_CATEGORIES.slice(0, 2);

  const results = await Promise.allSettled(
    categories.map(async (cat) => {
      const url = `${API_BASE}?category=${cat}&search=${encodeURIComponent(search)}&limit=15`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0; +https://job-ideal.vercel.app)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as RemotiveResponse;
      return data.jobs ?? [];
    })
  );

  const seen = new Set<number>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const j of r.value) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      jobs.push({
        title:       j.title,
        company:     j.company_name,
        description: cleanDescription(j.description),
        link:        j.url,
        location:    j.candidate_required_location || 'Remoto',
        salary:      j.salary || undefined,
      });
    }
  }

  console.log(`[remotive] ${jobs.length} vagas encontradas`);
  return jobs;
}
