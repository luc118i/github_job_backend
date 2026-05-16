import { AdzunaJob, searchAllQueries } from './adzuna';
import { UserPreferences } from '../types';

// RSS de empregos jurídicos — Jusbrasil é o maior portal jurídico do Brasil
const JUSBRASIL_RSS = 'https://www.jusbrasil.com.br/empregos/feed';

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractLink(block: string): string {
  const m = block.match(/<link[^/]?>(https?:\/\/[^<]+)<\/link>/i);
  if (m) return m[1].trim();
  const h = block.match(/href="(https?:\/\/[^"]+)"/i);
  return h ? h[1] : '';
}

async function fetchJusbrasilJobs(): Promise<AdzunaJob[]> {
  try {
    const res = await fetch(JUSBRASIL_RSS, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0; +https://job-ideal.vercel.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const jobs: AdzunaJob[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;

    while ((m = itemRe.exec(xml)) !== null) {
      const block = m[1];
      const title = extractTag(block, 'title');
      const link  = extractLink(block) || extractTag(block, 'link');
      if (!title || !link) continue;

      jobs.push({
        title,
        company:     extractTag(block, 'dc:creator') || extractTag(block, 'author') || 'Empresa não informada',
        description: extractTag(block, 'description').slice(0, 400),
        link,
        location:    extractTag(block, 'city') || extractTag(block, 'location') || 'Brasil',
      });
    }

    console.log(`[jusbrasil] ${jobs.length} vagas encontradas`);
    return jobs;
  } catch (err) {
    console.warn('[jusbrasil] falhou, ignorando fonte:', (err as Error).message);
    return [];
  }
}

// Busca no Adzuna com queries jurídicas geradas a partir do perfil
async function fetchLegalAdzunaJobs(
  queries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<AdzunaJob[]> {
  const jobs = await searchAllQueries(queries, preferences, blockedKeywords);
  // Adzuna retorna vagas de todas as áreas — filtra por relevância jurídica
  const LAW_RE = /advogad|jurídic|direito|procurad|promotor|magistrado|paralegal|compliance|cartório|notário|licitaç/i;
  return jobs.filter((j) => LAW_RE.test(j.title) || LAW_RE.test(j.description));
}

export async function fetchLegalJobs(
  queries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[]
): Promise<AdzunaJob[]> {
  const [jusbrasil, adzuna] = await Promise.all([
    fetchJusbrasilJobs(),
    fetchLegalAdzunaJobs(queries, preferences, blockedKeywords),
  ]);

  console.log(`[legal] jusbrasil: ${jusbrasil.length} | adzuna jurídico: ${adzuna.length}`);

  // Deduplica por link
  const seen = new Set<string>();
  return [...jusbrasil, ...adzuna].filter((j) => {
    if (seen.has(j.link)) return false;
    seen.add(j.link);
    return true;
  });
}
