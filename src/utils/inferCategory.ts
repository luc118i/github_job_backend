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

// Retorna true se o título pertence a uma categoria bloqueada
export function isBlocked(title: string, blockedKeywords: string[]): boolean {
  if (!blockedKeywords.length) return false;
  return blockedKeywords.includes(inferCategory(title));
}
