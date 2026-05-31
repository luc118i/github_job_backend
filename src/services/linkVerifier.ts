import { LinkStatus } from '../types';

const TRUSTED_DOMAINS = new Set([
  'gupy.io',
  'catho.com.br',
  'infojobs.com.br',
  'vagas.com.br',
  'trampos.co',
  'programathor.com.br',
  'geekhunter.com.br',
  '99jobs.com',
  'bne.com.br',
  'empregos.com.br',
  'nerdin.com.br',
  'hipsters.jobs',
  'remotar.com.br',
  'kenoby.com',
  'indeed.com',
  'glassdoor.com',
  'glassdoor.com.br',
  'linkedin.com',
  'wellfound.com',
  'remotive.com',
  'remote.com',
  'stackoverflow.com',
  'adzuna.com',
  'adzuna.com.br',
  'jusbrasil.com.br',
  'conjur.com.br',
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'recruitee.com',
  'bamboohr.com',
  'smartrecruiters.com',
  'ashbyhq.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
]);

// Domínios onde vagas expiradas retornam 200 com conteúdo indicando encerramento.
// Para esses, fazemos GET parcial além do HEAD.
const CONTENT_CHECK_DOMAINS = new Set(['gupy.io']);

// Strings que indicam vaga fechada no HTML da página
const CLOSED_PATTERNS = [
  /candidaturas?\s+encerradas?/i,
  /inscri[çc][õo]es?\s+encerradas?/i,
  /vaga\s+encerrada/i,
  /esta\s+vaga\s+(não\s+está\s+mais\s+dispon|foi\s+encerrada)/i,
  /job\s+is\s+no\s+longer\s+available/i,
  /position\s+has\s+been\s+filled/i,
  /this\s+job\s+is\s+not\s+available/i,
  /processo\s+seletivo\s+encerrado/i,
];

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

function needsContentCheck(hostname: string): boolean {
  const clean = hostname.replace(/^www\./, '');
  for (const domain of CONTENT_CHECK_DOMAINS) {
    if (clean === domain || clean.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isHomepage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' || pathname === '';
  } catch {
    return true;
  }
}

function isPlatformCategoryPage(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    const segs = pathname.split('/').filter(Boolean);

    if (host.endsWith('catho.com.br')) {
      if (segs[0] === 'vagas' && segs.length <= 2 && !/\d/.test(segs[1] ?? '')) return true;
    }
    if (host.endsWith('indeed.com') || host.endsWith('indeed.com.br')) {
      if (/^\/(rc|m|l|cmp)\//.test(pathname)) return true;
    }
    if (host.endsWith('glassdoor.com') || host.endsWith('glassdoor.com.br')) {
      if (/\/Jobs\/[^?#]*$/.test(pathname) && !/[A-Z]{2}\d{3,}/.test(pathname)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveJobLink(aiLink: string | null | undefined, title: string, company: string): string {
  if (aiLink) {
    try {
      const { hostname } = new URL(aiLink);
      if (
        isTrusted(hostname) &&
        !isHomepage(aiLink) &&
        !isSearchResultPage(aiLink) &&
        !isPlatformCategoryPage(aiLink)
      ) {
        return aiLink;
      }
    } catch {
      // URL inválida
    }
  }
  // Sanitiza title/company removendo caracteres que podem quebrar a URL
  const safeTitle = (title ?? '').replace(/[^\w\s\-áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ]/g, ' ').trim();
  const safeCompany = (company ?? '').replace(/[^\w\s\-áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ]/g, ' ').trim();
  const q = encodeURIComponent(`${safeTitle} ${safeCompany}`.trim());
  return `https://br.indeed.com/jobs?q=${q}&l=Brasil`;
}

/** Verifica se o HTML da página indica vaga encerrada */
async function isClosedContent(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-12000', // só os primeiros 12KB — suficiente para o título/status
      },
      signal: AbortSignal.timeout(7000),
    });
    if (res.status === 404) return true;
    const text = await res.text();
    return CLOSED_PATTERNS.some((re) => re.test(text));
  } catch {
    return false; // timeout ou erro → assume ativa (melhor falso negativo que falso positivo)
  }
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
  if (isSearchResultPage(url)) return 'none';

  const trusted = isTrusted(hostname);
  const contentCheck = needsContentCheck(hostname);
  const timeout = trusted ? 5000 : 6000;

  try {
    // HEAD rápido primeiro
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0)' },
    });
    clearTimeout(tid);

    // 404/410 = definitivamente morto
    if (res.status === 404 || res.status === 410) return 'dead';

    // Outros erros de servidor
    if (res.status >= 500) return 'dead';

    // 403/405/429 = site bloqueia bots mas link existe
    const botBlock = [403, 405, 429];
    if (!botBlock.includes(res.status) && res.status >= 400) return 'dead';

    // Para domínios como Gupy: fazer GET parcial para detectar "candidaturas encerradas"
    if (contentCheck) {
      const closed = await isClosedContent(url);
      if (closed) return 'dead';
    }

    return trusted ? 'trusted' : 'unverified';
  } catch {
    // Timeout ou erro de rede
    return trusted ? 'trusted' : 'dead';
  }
}
