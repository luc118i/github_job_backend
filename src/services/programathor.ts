import { AdzunaJob } from './adzuna';

// RSS de vagas TI brasileiras — atualizado diariamente
const FEED_URL = 'https://programathor.com.br/feed/vagas';

// Extrai o conteúdo de uma tag XML/RSS, suportando CDATA e entidades básicas
function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, ' ')  // strip HTML dentro de CDATA
    .replace(/\s+/g, ' ')
    .trim();
}

// Programathor usa <link> como tag vazia seguida de texto — trata os dois formatos:
// Formato A: <link>https://...</link>
// Formato B: <link/>\nhttps://...   (caso atom:link misturado)
function extractLink(block: string): string {
  const tagMatch = block.match(/<link[^/]?>(https?:\/\/[^<]+)<\/link>/i);
  if (tagMatch) return tagMatch[1].trim();
  // fallback: primeiro href= no bloco
  const hrefMatch = block.match(/href="(https?:\/\/[^"]+)"/i);
  return hrefMatch ? hrefMatch[1] : '';
}

function parseItems(xml: string): AdzunaJob[] {
  const jobs: AdzunaJob[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link  = extractLink(block) || extractTag(block, 'link');
    if (!title || !link) continue;

    const description = extractTag(block, 'description').slice(0, 400);
    // Programathor publica o nome da empresa em <author> ou <dc:creator>
    const company  = extractTag(block, 'dc:creator') || extractTag(block, 'author') || 'Empresa não informada';
    const location = extractTag(block, 'city') || extractTag(block, 'location') || 'Brasil';

    jobs.push({ title, company, description, link, location });
  }

  return jobs;
}

export async function fetchProgramathorJobs(): Promise<AdzunaJob[]> {
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0; +https://job-ideal.vercel.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const jobs = parseItems(xml);
    console.log(`[programathor] ${jobs.length} vagas encontradas`);
    return jobs;
  } catch (err) {
    console.warn('[programathor] falhou, ignorando fonte:', (err as Error).message);
    return [];
  }
}
