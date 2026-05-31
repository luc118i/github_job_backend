import { UserPreferences } from '../types';
import { AdzunaJob } from './adzuna';

interface GupyRawJob {
  id: number;
  name: string;
  description: string | null;
  jobUrl: string;
  city: string | null;
  state: string | null;
  workplaceType: string;        // 'remote' | 'hybrid' | 'on-site'
  careerPageName?: string;      // nome da empresa (API pública usa este campo)
  company?: { name: string };   // mantido por compatibilidade, mas nem sempre presente
  publishedDate?: string | null; // campo real da API pública do Gupy
  publishedAt?: string | null;   // fallback
  applicationDeadline?: string | null;
}

interface GupyResponse {
  data: GupyRawJob[];
}

function formatGupyLocation(job: GupyRawJob): string {
  if (job.workplaceType === 'remote') return 'Remoto';
  const parts = [job.city, job.state].filter(Boolean).join(', ');
  if (job.workplaceType === 'hybrid') return parts ? `Híbrido — ${parts}` : 'Híbrido';
  return parts || 'Brasil';
}

// Siglas de estados brasileiros para detecção rápida
const BR_STATES = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
]);

/**
 * Extrai a sigla do estado (UF) de uma string de localização.
 * Exemplos:
 *   "São Sebastião, DF"  → "DF"
 *   "Brasília"           → "DF"
 *   "São Paulo, SP"      → "SP"
 *   "DF"                 → "DF"
 *   "Rio de Janeiro"     → "RJ"
 */
// Nome completo do estado → sigla
const STATE_NAME_TO_UF: Record<string, string> = {
  'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAPÁ': 'AP',
  'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE', 'CEARÁ': 'CE',
  'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'ESPÍRITO SANTO': 'ES',
  'GOIAS': 'GO', 'GOIÁS': 'GO', 'MARANHAO': 'MA', 'MARANHÃO': 'MA',
  'MATO GROSSO DO SUL': 'MS', 'MATO GROSSO': 'MT',
  'MINAS GERAIS': 'MG', 'PARA': 'PA', 'PARÁ': 'PA',
  'PARAIBA': 'PB', 'PARAÍBA': 'PB', 'PARANA': 'PR', 'PARANÁ': 'PR',
  'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'PIAUÍ': 'PI',
  'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN',
  'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RONDÔNIA': 'RO',
  'RORAIMA': 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SÃO PAULO': 'SP',
  'SERGIPE': 'SE', 'TOCANTINS': 'TO',
};

function extractState(location: string): string | null {
  if (!location) return null;
  const upper = location.toUpperCase().trim();

  // Remove prefixos de modalidade: "Híbrido — Campinas, São Paulo" → "Campinas, São Paulo"
  const clean = upper.replace(/^(híbrido|hibrido|hybrid|remoto|remote)\s*[–\-—]\s*/i, '').trim();

  // Procura sigla de 2 letras no final: "São Sebastião, DF" → "DF"
  const siglaMatch = clean.match(/[,\s]\s*([A-Z]{2})\s*$/);
  if (siglaMatch && BR_STATES.has(siglaMatch[1])) return siglaMatch[1];

  // A string inteira é uma sigla: "DF", "SP"
  if (BR_STATES.has(clean)) return clean;

  // Nome completo do estado após vírgula: "Campinas, São Paulo" → "SP"
  const partes = clean.split(',');
  if (partes.length >= 2) {
    const statePart = partes[partes.length - 1].trim();
    if (STATE_NAME_TO_UF[statePart]) return STATE_NAME_TO_UF[statePart];
  }

  // Nome completo sem vírgula: "Minas Gerais" → "MG"
  if (STATE_NAME_TO_UF[clean]) return STATE_NAME_TO_UF[clean];

  // Mapa de capitais/cidades conhecidas → UF
  const CITY_TO_STATE: Record<string, string> = {
    'BRASILIA': 'DF', 'BRASÍLIA': 'DF',
    'SAO PAULO': 'SP', 'SÃO PAULO': 'SP',
    'RIO DE JANEIRO': 'RJ', 'BELO HORIZONTE': 'MG',
    'CURITIBA': 'PR', 'PORTO ALEGRE': 'RS', 'SALVADOR': 'BA',
    'FORTALEZA': 'CE', 'MANAUS': 'AM', 'RECIFE': 'PE',
    'GOIANIA': 'GO', 'GOIÂNIA': 'GO', 'BELEM': 'PA', 'BELÉM': 'PA',
    'FLORIANOPOLIS': 'SC', 'FLORIANÓPOLIS': 'SC', 'MACEIO': 'AL', 'MACEIÓ': 'AL',
    'NATAL': 'RN', 'CAMPO GRANDE': 'MS', 'TERESINA': 'PI',
    'JOAO PESSOA': 'PB', 'JOÃO PESSOA': 'PB', 'ARACAJU': 'SE',
    'CUIABA': 'MT', 'CUIABÁ': 'MT', 'PORTO VELHO': 'RO',
    'MACAPA': 'AP', 'MACAPÁ': 'AP', 'BOA VISTA': 'RR',
    'PALMAS': 'TO', 'RIO BRANCO': 'AC', 'VITORIA': 'ES', 'VITÓRIA': 'ES',
  };

  const city = clean.split(',')[0].trim();
  if (CITY_TO_STATE[city]) return CITY_TO_STATE[city];

  return null;
}

/** Extrai a cidade de uma string de localização. Ex: "São Sebastião, DF" → "São Sebastião" */
function extractCity(location: string): string {
  return location.split(',')[0].trim();
}

async function fetchGupyJobs(
  queries: string[],
  preferences?: UserPreferences,
  stateOverride?: string | null,   // null = sem filtro, undefined = usa preferences
): Promise<AdzunaJob[]> {
  const topQueries = queries.slice(0, 6);
  const seen = new Set<string>();
  const jobs: AdzunaJob[] = [];

  // Estado inferido da localização do usuário (ex: "São Sebastião, DF" → "DF")
  const state = stateOverride !== undefined
    ? stateOverride
    : extractState(preferences?.location ?? '');

  const results = await Promise.allSettled(
    topQueries.map(async (q) => {
      const params = new URLSearchParams({ jobName: q, limit: '15' });

      // Raio ≤ 50 km → filtra por cidade (mais próximas). Raio maior → nacional.
      // Gupy API pública não suporta state; cidade é o único filtro geo disponível.
      if (stateOverride === undefined && (preferences?.radiusKm ?? 0) > 0 && (preferences?.radiusKm ?? 0) <= 50) {
        const city = extractCity(preferences?.location ?? '');
        if (city) params.set('city', city);
      }
      void state;

      if (preferences?.modality === 'remote')     params.set('workplaceType', 'remote');
      else if (preferences?.modality === 'presencial') params.set('workplaceType', 'on-site');
      else if (preferences?.modality === 'hybrid') params.set('workplaceType', 'hybrid');

      const res = await fetch(`https://portal.api.gupy.io/api/v1/jobs?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Gupy HTTP ${res.status}`);
      return ((await res.json()) as GupyResponse).data ?? [];
    })
  );

  // Log de falhas individuais para diagnóstico
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[gupy] query[${i}] falhou:`, r.reason);
  });

  // ATENÇÃO: A API pública do Gupy retorna vagas históricas (280-1200 dias).
  // Filtrar por data aqui eliminaria TODOS os resultados.
  // A triagem de vagas expiradas é feita pelo verifyLink (detecta "candidaturas encerradas").
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const job of result.value) {
      if (!job.jobUrl || seen.has(job.jobUrl)) continue;

      const dateStr = job.publishedDate ?? job.publishedAt ?? null;

      seen.add(job.jobUrl);
      jobs.push({
        title:       job.name,
        company:     job.careerPageName ?? job.company?.name ?? 'Empresa não informada',
        description: (job.description ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300),
        link:        job.jobUrl,
        location:    formatGupyLocation(job),
        source:      'Gupy',
        published_at: dateStr ?? undefined,
      });
    }
  }

  return jobs;
}

export async function searchGupyJobs(
  queries: string[],
  preferences?: UserPreferences,
): Promise<AdzunaJob[]> {
  // Gupy API pública não suporta filtro por estado (UF).
  // Buscamos nacional e filtramos pós-fetch quando o usuário não selecionou "Nacional" (radiusKm > 0).
  const jobs = await fetchGupyJobs(queries, preferences);

  const userState = extractState(preferences?.location ?? '');
  const wantRemote = preferences?.modality === 'remote';

  // Filtra por estado sempre que o usuário informou localização (independente do raio).
  // Para busca nacional, basta deixar o campo de localização em branco.
  if (userState && !wantRemote) {
    const filtered = jobs.filter((job) => {
      const loc = job.location ?? '';
      if (/^remoto$/i.test(loc.trim())) return true;
      const jobState = extractState(loc);
      return jobState === userState;
    });
    console.log(`[gupy] ${jobs.length} raw → ${filtered.length} após filtro estado=${userState}`);
    return filtered.slice(0, 40);
  }

  console.log(`[gupy] ${jobs.length} vagas encontradas (nacional)`);
  return jobs.slice(0, 40);
}
