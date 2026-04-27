import { LinkStatus } from '../types';

const TRUSTED_DOMAINS = new Set([
  'linkedin.com',
  'glassdoor.com',
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
]);

function isSuspicious(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.gq'];
  return suspiciousTLDs.some((tld) => hostname.endsWith(tld));
}

function isTrusted(hostname: string): boolean {
  const clean = hostname.replace(/^www\./, '');
  for (const domain of TRUSTED_DOMAINS) {
    if (clean === domain || clean.endsWith(`.${domain}`)) return true;
  }
  return false;
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
  if (isTrusted(hostname)) return 'trusted';

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(tid);
    return res.status < 400 || res.status === 405 ? 'unverified' : 'dead';
  } catch {
    return 'dead';
  }
}
