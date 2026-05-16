import { LinkStatus } from '../types';

const TRUSTED_DOMAINS = new Set([
  'linkedin.com',
  'glassdoor.com',
  'glassdoor.com.br',
  'indeed.com',
  'gupy.io',
  'vagas.com.br',
  'infojobs.com.br',
  'catho.com.br',
  'trampos.co',
  'programathor.com.br',
  'wellfound.com',
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'remote.com',
  'stackoverflow.com',
  'remotar.com.br',
  'kenoby.com',
  'bne.com.br',
  'empregos.com.br',
  'nerdin.com.br',
  'hipsters.jobs',
  'adzuna.com',
  'adzuna.com.br',
]);

const SEARCH_RESULT_PATTERNS = [
  /[?&](q|query|search|busca|keyword|s)=/i,
  /\/(jobs|vagas|emprego|search|buscar|results?)\/?$/i,
  /\/(jobs|vagas|emprego|search)\?/i,
];

function isSuspicious(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.gq'];
  return suspiciousTLDs.some((tld) => hostname.endsWith(tld));
}

function isSearchResultPage(url: string): boolean {
  return SEARCH_RESULT_PATTERNS.some((re) => re.test(url));
}

function isTrusted(hostname: string): boolean {
  const clean = hostname.replace(/^www\./, '');
  for (const domain of TRUSTED_DOMAINS) {
    if (clean === domain || clean.endsWith(`.${domain}`)) return true;
  }
  return false;
}

// Rejeita URLs sem path significativo (home da plataforma)
function isHomepage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' || pathname === '';
  } catch {
    return true;
  }
}

export function resolveJobLink(aiLink: string | null | undefined, title: string, company: string): string {
  if (aiLink) {
    try {
      const { hostname } = new URL(aiLink);
      // Aceita apenas URLs de domínio confiável que apontem para uma vaga específica —
      // rejeita homepages (ex: https://gupy.io/) e páginas de busca (ex: https://indeed.com/jobs?q=...)
      if (isTrusted(hostname) && !isHomepage(aiLink) && !isSearchResultPage(aiLink)) {
        return aiLink;
      }
    } catch {
      // URL inválida, ignora
    }
  }
  // Fallback: busca pelo título + empresa no Indeed
  const q = encodeURIComponent(`${title} ${company}`.trim());
  return `https://br.indeed.com/jobs?q=${q}&l=Brasil`;
}

export async function verifyLink(url: string | null): Promise<LinkStatus> {
  if (!url) return 'none';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'none';
  }

  if (parsed.protocol !== 'https:') return 'none';

  const hostname = parsed.hostname;

  if (isSuspicious(hostname)) return 'none';
  if (isTrusted(hostname)) return 'trusted';   // trusted antes de isSearchResultPage para aceitar URLs de busca em plataformas confiáveis
  if (isSearchResultPage(url)) return 'none';

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0)' },
    });
    clearTimeout(tid);
    // 403/429 = site bloqueia bots mas o link existe; 405 = HEAD não suportado mas link existe
    const liveStatuses = [403, 405, 429];
    return res.status < 400 || liveStatuses.includes(res.status) ? 'unverified' : 'dead';
  } catch {
    return 'dead';
  }
}
