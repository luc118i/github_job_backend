import { AdzunaJob } from './adzuna';
import { UserPreferences } from '../types';

// Vagas.com.br — scraping do site público (HTML parsing)
// URL pattern: https://www.vagas.com.br/vagas-de-{slug}
// Location format returned: "Cidade / UF" (e.g. "Brasília / DF")

const BASE_URL = 'https://www.vagas.com.br';

const BR_STATES = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
]);

function slugify(query: string): string {
  return query
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export function extractUfFromLocation(loc: string): string | null {
  // Format: "Cidade / UF" or "Cidade / Estado"
  const m = loc.match(/\/\s*([A-Z]{2})\s*$/);
  if (m && BR_STATES.has(m[1])) return m[1];
  return null;
}

function parseJobBlocks(html: string): AdzunaJob[] {
  const jobs: AdzunaJob[] = [];
  // Split on job card boundaries
  const blocks = html.split(/class="vaga (?:odd|even)/);

  for (const block of blocks.slice(1)) {
    const titleM = block.match(/title="([^"]+)"[^>]*href="(\/vagas\/[^"]+)"/);
    if (!titleM) continue;

    const title   = titleM[1].trim();
    const url     = BASE_URL + titleM[2].trim();

    const companyM  = block.match(/class="emprVaga"\s*>\s*([^\n<]+)/);
    const company   = companyM ? companyM[1].trim() : 'Empresa não informada';

    const descM     = block.match(/<p>([\s\S]*?)<\/p>/);
    const desc      = descM ? stripHtml(descM[1]).slice(0, 300) : '';

    const locationM = block.match(/class="vaga-local"[\s\S]*?<\/i>\s*([^\n<]+)/);
    const location  = locationM ? locationM[1].trim() : 'Brasil';

    jobs.push({ title, company, description: desc, link: url, location, source: 'Vagas.com.br' });
  }

  return jobs;
}

async function fetchPage(query: string, page = 1): Promise<AdzunaJob[]> {
  const slug = slugify(query);
  const url  = `${BASE_URL}/vagas-de-${slug}${page > 1 ? `?pagina=${page}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[vagas.com.br] HTTP ${res.status} for "${query}"`);
      return [];
    }
    return parseJobBlocks(await res.text());
  } catch (err) {
    console.warn(`[vagas.com.br] falhou para "${query}":`, (err as Error).message);
    return [];
  }
}

export async function searchVagasComBr(
  queries: string[],
  _preferences?: UserPreferences,
): Promise<AdzunaJob[]> {
  const topQueries = queries.slice(0, 4);
  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  const results = await Promise.allSettled(topQueries.map((q) => fetchPage(q)));

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const job of r.value) {
      if (seen.has(job.link)) continue;
      seen.add(job.link);
      jobs.push(job);
    }
  }

  // Localização não é filtrada aqui — filterByLocation em applyPreferenceFilters
  // faz o split matched/outOfArea, permitindo que vagas fora do filtro apareçam
  // na seção "compatíveis com o perfil".
  console.log(`[vagas.com.br] ${jobs.length} vagas encontradas`);
  return jobs.slice(0, 60);
}

