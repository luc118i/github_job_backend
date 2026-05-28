import { LinkedInPosition, LinkedInEducation } from '../types';

// ── User context inference ────────────────────────────────────────

/** Brazilian state abbreviations (two-letter codes). */
const BR_STATES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Tokens that indicate a Brazilian educational institution. */
const BR_SCHOOL_TOKENS = [
  'usp', 'unicamp', 'ufrj', 'ufmg', 'ufsc', 'ufsm', 'unifesp', 'ufba',
  'puc', 'mackenzie', 'fatec', 'senac', 'senai', 'anhanguera',
  'estácio', 'kroton', 'unip', 'faculdade', 'universidade federal',
  'universidade estadual', 'cefet', 'ifsp', 'ifrj', 'fiap', 'unicesumar',
];

export interface UserContext {
  /** True when we can detect the user is in Brazil. */
  isBrazilian: boolean;
  /** City name to use as Gupy `city` filter, extracted from the LinkedIn location string.
   *  Null when no city can be reliably determined. */
  inferredCity: string | null;
}

/** Extracts the city from a LinkedIn location string like "São Paulo, SP, Brasil" → "São Paulo". */
function extractCity(location: string): string | null {
  // Skip non-physical modalities
  if (/^(remot|híbrid|hybrid|home.?office)/i.test(location.trim())) return null;
  const first = location.split(',')[0]?.trim();
  return first || null;
}

/** Returns true if the location string contains a Brazilian state code or "Brasil". */
function hasBRSignal(location: string): boolean {
  if (/brasil/i.test(location)) return true;
  // Check each comma-delimited part against state codes
  return location
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .some((p) => BR_STATES.has(p));
}

/** Infers whether the candidate is Brazilian and, if so, which city they are in.
 *  Signals checked (in order of reliability):
 *  1. Position `location` fields (most recent position first)
 *  2. Education at a recognisably Brazilian institution */
export function inferUserContext(
  positions: LinkedInPosition[],
  education: LinkedInEducation[],
): UserContext {
  // Most recent positions carry the strongest signal
  for (const pos of positions) {
    if (!pos.location) continue;
    if (hasBRSignal(pos.location)) {
      return { isBrazilian: true, inferredCity: extractCity(pos.location) };
    }
  }

  // Fall back to education at Brazilian schools (no city available here)
  const schoolText = education.map((e) => e.school.toLowerCase()).join(' ');
  if (BR_SCHOOL_TOKENS.some((t) => schoolText.includes(t))) {
    return { isBrazilian: true, inferredCity: null };
  }

  return { isBrazilian: false, inferredCity: null };
}

const LAW_TITLE_RE = /advogad|jurídic|procurad|promotor|defensor|magistrado|juiz\b|paralegal|compliance|notário|cartório|oab\b|assessor.{0,10}jur|gestor.{0,10}jur|analista.{0,10}jur|coordenador.{0,10}jur/i;

// Mapa de especialidades jurídicas detectadas por palavras-chave no título/descrição
const LAW_AREAS: [RegExp, string][] = [
  [/trabalhist|clT\b|empregado|sindicat/i,           'trabalhista'],
  [/civil|família|divórcio|inventário|sucessão/i,    'civil'],
  [/penal|criminal|crime|réu|defesa criminal/i,      'penal'],
  [/empresarial|societário|M&A|fusão|aquisição/i,    'empresarial'],
  [/tributári|fiscal|impost|ICMS|ISS|IR\b|IRPJ/i,   'tributário'],
  [/ambiental/i,                                      'ambiental'],
  [/previdenciári|INSS|aposentadoria/i,              'previdenciário'],
  [/consumidor|CDC\b/i,                              'consumidor'],
  [/imobiliári|imóvel|locação|construtora/i,         'imobiliário'],
  [/compliance|lgpd|GDPR|privacidade|proteção.{0,10}dado/i, 'compliance/LGPD'],
  [/contratos|contratual/i,                           'contratos'],
  [/licitaç|público|administrativo/i,                'direito público'],
  [/internacional|arbitragem/i,                      'internacional'],
  [/startup|venture|fintech|tecnologia/i,            'direito digital'],
];

export function isLawProfile(positions: LinkedInPosition[]): boolean {
  return positions.some((p) => LAW_TITLE_RE.test(p.title));
}

// Retorna as áreas de especialização encontradas no histórico profissional
export function extractLawSpecialties(positions: LinkedInPosition[]): string[] {
  const found = new Set<string>();
  for (const p of positions) {
    const text = `${p.title} ${p.description ?? ''}`;
    for (const [re, area] of LAW_AREAS) {
      if (re.test(text)) found.add(area);
    }
  }
  return Array.from(found);
}

// Gera queries de busca jurídicas com base no perfil
export function buildLawQueries(positions: LinkedInPosition[], specialties: string[]): string[] {
  const queries = new Set<string>(['advogado', 'analista jurídico', 'assessor jurídico']);

  // Queries específicas por especialidade
  for (const s of specialties) {
    queries.add(`advogado ${s}`);
  }

  // Cargo mais recente como query direta
  if (positions.length > 0) {
    const lastTitle = positions[0].title.toLowerCase().trim();
    if (lastTitle.length <= 40) queries.add(lastTitle);
  }

  return Array.from(queries).slice(0, 6);
}
