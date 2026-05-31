import { UserPreferences } from '../types';
import { isBlocked } from '../utils/inferCategory';

interface AdzunaRawJob {
  id: string;
  title: string;
  company: { display_name: string };
  description: string;
  redirect_url: string;
  location: { display_name: string };
  created: string;
  salary_min?: number;
  salary_max?: number;
}

interface AdzunaResponse {
  results: AdzunaRawJob[];
}

export interface AdzunaJob {
  title: string;
  company: string;
  description: string;
  link: string;
  location: string;
  salary?: string;
  source?: string;
  published_at?: string;
}

// Mapa UF sigla → nome completo que o Adzuna entende
const UF_TO_FULL: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

const BR_STATES_SET = new Set(Object.keys(UF_TO_FULL));

/**
 * Mapa de cidades conhecidas (sem acento, lowercase) → UF.
 * Cobre capitais e grandes cidades onde o LinkedIn costuma registrar localização
 * sem incluir a sigla do estado.
 */
const CITY_TO_UF: Record<string, string> = {
  'brasilia': 'DF', 'brasília': 'DF', 'taguatinga': 'DF', 'ceilandia': 'DF', 'samambaia': 'DF',
  'sao paulo': 'SP', 'são paulo': 'SP', 'campinas': 'SP', 'guarulhos': 'SP', 'santo andre': 'SP',
  'rio de janeiro': 'RJ', 'niteroi': 'RJ', 'petropolis': 'RJ',
  'belo horizonte': 'MG', 'uberlandia': 'MG', 'contagem': 'MG',
  'salvador': 'BA', 'feira de santana': 'BA',
  'fortaleza': 'CE',
  'recife': 'PE', 'olinda': 'PE', 'caruaru': 'PE',
  'porto alegre': 'RS', 'caxias do sul': 'RS', 'pelotas': 'RS',
  'curitiba': 'PR', 'londrina': 'PR', 'maringa': 'PR',
  'manaus': 'AM',
  'belem': 'PA', 'belém': 'PA',
  'goiania': 'GO', 'goiânia': 'GO', 'anapolis': 'GO',
  'florianopolis': 'SC', 'florianópolis': 'SC', 'joinville': 'SC', 'blumenau': 'SC',
  'natal': 'RN',
  'maceio': 'AL', 'maceió': 'AL',
  'teresina': 'PI',
  'campo grande': 'MS',
  'cuiaba': 'MT', 'cuiabá': 'MT',
  'porto velho': 'RO',
  'macapa': 'AP', 'macapá': 'AP',
  'boa vista': 'RR',
  'palmas': 'TO',
  'vitoria': 'ES', 'vitória': 'ES', 'vila velha': 'ES',
  'sao luis': 'MA', 'são luís': 'MA',
  'aracaju': 'SE',
  'joao pessoa': 'PB', 'joão pessoa': 'PB',
  'rio branco': 'AC',
  'macei': 'AL',
};

/**
 * Extrai o nome de estado por extenso que o Adzuna aceita no campo "where".
 * "São Sebastião, DF" → "Distrito Federal"
 * "São Paulo, SP"     → "São Paulo" (estado)
 * "DF"                → "Distrito Federal"
 * "Brasília"          → "Distrito Federal" (lookup por cidade)
 */
function extractAdzunaState(location: string): string | null {
  if (!location) return null;
  const upper = location.toUpperCase().trim();

  // "..., UF" ou "... - UF"
  const match = upper.match(/[,\-–]\s*([A-Z]{2})\s*$/);
  if (match && BR_STATES_SET.has(match[1])) return UF_TO_FULL[match[1]];

  // A string inteira é uma UF
  if (BR_STATES_SET.has(upper)) return UF_TO_FULL[upper];

  // Lookup por cidade (sem acento, lowercase) — cobre casos como "Brasília" sem UF
  const cityKey = location.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s*,.*$/, ''); // tira tudo após vírgula
  const uf = CITY_TO_UF[cityKey] ?? CITY_TO_UF[location.toLowerCase().trim()];
  if (uf) return UF_TO_FULL[uf];

  return null;
}

function formatSalary(min?: number, max?: number): string | undefined {
  if (!min && !max) return undefined;
  const fmt = (n: number) => `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `A partir de ${fmt(min)}`;
  return undefined;
}

async function fetchAdzunaJobs(
  query: string,
  preferences?: UserPreferences,
): Promise<AdzunaJob[]> {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('ADZUNA_APP_ID ou ADZUNA_APP_KEY não configurados');

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: query,
    results_per_page: '15',
    sort_by: 'date',
  });

  if (preferences?.maxAgeDays) params.set('max_days_old', String(preferences.maxAgeDays));

  // Adzuna "where" só funciona com nome de estado por extenso.
  // "São Sebastião, DF" → "Distrito Federal" ✅  |  "São Sebastião, DF" direto → 1 resultado ❌
  if (preferences?.location) {
    const state = extractAdzunaState(preferences.location);
    if (state) params.set('where', state);
    // Se não conseguir extrair o estado, não filtra (busca nacional — melhor que 0 resultados)
  }
  // Não usa what_exclude — filtragem feita no pós-fetch via isBlocked para evitar over-blocking

  const url = `https://api.adzuna.com/v1/api/jobs/br/search/1?${params}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Adzuna error ${res.status}`);

  const data = (await res.json()) as AdzunaResponse;

  return (data.results ?? []).map((job) => ({
    title:       job.title,
    company:     job.company?.display_name ?? 'Empresa não informada',
    description: job.description.slice(0, 300),
    link:        `https://www.adzuna.com.br/details/${job.id}`,
    location:    job.location.display_name,
    salary:      formatSalary(job.salary_min, job.salary_max),
    source:      'Adzuna',
    published_at: job.created ?? undefined,
  }));
}

/**
 * Busca vagas no Adzuna para múltiplas queries em paralelo.
 * Aceita qualquer área profissional (não filtra só TI).
 * Retorna até 40 vagas deduplicadas.
 */
export async function searchAdzunaJobs(
  queries: string[],
  preferences?: UserPreferences,
  blockedKeywords?: string[],
): Promise<AdzunaJob[]> {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.warn('[adzuna] Chaves não configuradas — pulando');
    return [];
  }

  const topQueries = queries.slice(0, 5);
  const results = await Promise.allSettled(
    topQueries.map((q) => fetchAdzunaJobs(q, preferences))
  );

  // Log de diagnóstico por query
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[adzuna] query[${i}] falhou:`, r.reason?.message ?? r.reason);
    else console.log(`[adzuna] query[${i}] "${topQueries[i]}" → ${r.value.length} vagas`);
  });

  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      const key = job.link;
      if (!seen.has(key)) {
        seen.add(key);
        jobs.push(job);
      }
    }
  }

  if (blockedKeywords?.length) {
    const filtered = jobs.filter((j) => !isBlocked(j.title, blockedKeywords));
    console.log(`[adzuna] ${jobs.length} raw → ${filtered.length} após filtro de bloqueados`);
    return filtered.slice(0, 40);
  }

  console.log(`[adzuna] ${jobs.length} vagas encontradas`);
  return jobs.slice(0, 40);
}

/** Alias para compatibilidade com claude.ts e legalJobs.ts */
export const searchAllQueries = searchAdzunaJobs;
