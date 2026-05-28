// Espelho de jobPreferences.inferCategory do frontend — mantidos em sincronia
const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/logíst|logist|armazém|warehouse|supply.?chain|transporta/i, 'logística'],
  [/machine.?learn|aprendiz.?maquin|ml\s+eng/i, 'machine learning'],
  [/data.?scien|cientist.+dado/i, 'data science'],
  [/data.?eng|engenhei.+dado/i, 'engenharia de dados'],
  [/front.?end|interface|ui.?dev/i, 'frontend'],
  [/back.?end/i, 'backend'],
  [/full.?stack/i, 'full stack'],
  [/devops|sre\b|site.?reliab/i, 'devops'],
  [/mobile|android|ios\b|flutter|react.?native/i, 'mobile'],
  [/segurança|security|pentest|infosec/i, 'segurança'],
  [/dados|analista.+dado|data.?analys/i, 'análise de dados'],
  [/produto|product.?manag/i, 'produto'],
  [/design|ux\b|ui\b/i, 'design'],
  [/suporte|helpdesk|support/i, 'suporte'],
  [/vendas|comercial|sales/i, 'vendas'],
  [/financ|contab|fiscal/i, 'finanças'],
  [/rh\b|recursos.?human|people/i, 'recursos humanos'],
];

export function inferCategory(title: string): string {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  const words = title.split(/\s+/).filter((w) => w.length > 3);
  return (words[words.length - 1] ?? title).toLowerCase();
}

// Strip combining diacritics (accents) and lowercase — safe for accent-insensitive comparison
function normalizeStr(s: string): string {
  // NFD splits accented chars into base + combining mark; then strip all combining marks (U+0300–U+036F)
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Returns true when a job is exclusively for Pessoas com Deficiência (PCD).
 *  Under Brazilian law (Lei de Cotas), quota positions are reserved for registered PWDs.
 *  Non-PCD candidates cannot apply, so these jobs should not appear in general results. */
export function isPcdExclusive(title: string): boolean {
  return /\bpcd\b|pessoa\s+com\s+defici[eê]ncia/i.test(title);
}

// Retorna true se o título pertence a uma categoria bloqueada.
// Compara sem acentos e sem diferença de maiúsculas/minúsculas para cobrir variações
// como "logistica" (digitado pelo usuário) vs "logística" (categoria inferida).
export function isBlocked(title: string, blockedKeywords: string[]): boolean {
  if (!blockedKeywords.length) return false;
  const category = normalizeStr(inferCategory(title));
  const titleNorm = normalizeStr(title);
  return blockedKeywords.some((kw) => {
    const kwNorm = normalizeStr(kw);
    // Matches either the inferred category name OR a substring of the raw job title
    return category === kwNorm || titleNorm.includes(kwNorm);
  });
}
