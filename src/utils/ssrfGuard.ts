import dns from 'node:dns/promises';

// Bloqueia acesso a rede interna quando o backend busca uma URL fornecida pelo usuário
// (ex: link de vaga colado). Sem isso, um usuário poderia apontar para localhost, a rede
// interna do host (Koyeb) ou o endpoint de metadata de cloud (169.254.169.254) e o backend
// faria a requisição por ele, potencialmente vazando o conteúdo de volta na resposta.

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, inclui metadata de cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast/reservado
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7)); // IPv4-mapped
  return false;
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isPrivateIp(hostname)) throw new Error('URL aponta para um endereço de rede interno, não permitido.');

  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (records.length === 0) throw new Error('Não foi possível resolver o domínio da URL.');
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error('URL aponta para um endereço de rede interno, não permitido.');
  }
}

/** Valida que a URL é http(s) pública e não resolve para rede interna. Lança erro caso contrário. */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas URLs http/https são permitidas.');
  }
  await assertPublicHost(parsed.hostname);
  return parsed;
}

/**
 * fetch() que valida a URL (e cada redirect) contra endereços de rede interna antes de segui-los,
 * já que o `fetch` nativo seguiria redirects automaticamente sem revalidar o destino.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let currentUrl = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const parsed = await assertSafeUrl(currentUrl);
    const res = await fetch(parsed, { ...init, redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      currentUrl = new URL(location, parsed).toString();
      continue;
    }
    return res;
  }
  throw new Error('Número máximo de redirects excedido.');
}
