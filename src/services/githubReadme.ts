// Busca o README de um repositório do GitHub (para o match por IA).
// Roda no backend: 1 IP só e usa GITHUB_TOKEN (se houver) → 5.000 req/h
// em vez dos ~60/h da API pública. O conteúdo é cacheado no banco pelo
// chamador, então normalmente só buscamos uma vez por projeto.

const README_MAX = 4000; // chars — o suficiente para o contexto da IA, sem estourar tokens.

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    // Accept "raw" → a API devolve o README já em texto, sem base64.
    Accept: 'application/vnd.github.raw+json',
    'User-Agent': 'github-job-finder',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Extrai { owner, repo } de uma URL do GitHub (https://github.com/owner/repo).
 * Retorna null se não for um link reconhecível.
 */
export function parseGithubUrl(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

/**
 * Busca o README do repo e devolve o texto truncado, ou null se não houver
 * (repo sem README, 404, rate limit). Best-effort: nunca lança.
 */
export async function fetchRepoReadme(owner: string, repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      console.warn(`[readme] ${owner}/${repo} → HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    const clean = text.trim();
    if (!clean) return null;
    return clean.length > README_MAX ? clean.slice(0, README_MAX) : clean;
  } catch (e) {
    console.warn(`[readme] falha ao buscar ${owner}/${repo}:`, (e as Error).message);
    return null;
  }
}
