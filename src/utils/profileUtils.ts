import { LinkedInPosition } from '../types';

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
