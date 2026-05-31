// Espelho de jobPreferences.inferCategory do frontend — mantidos em sincronia
const CATEGORY_PATTERNS: [RegExp, string][] = [
  // Logística — inclui todos os cargos operacionais correlacionados
  [/logíst|logist|armazém|armazem|warehouse|supply.?chain|transporta|estoque|estoquista|almoxarife|almoxarifado|conferente|separador\b|expedidor|recebimento|recebedor|movimentador|carregador|descarregador|montador.*frete|fretista|operador.*logíst|auxiliar.*estoque|assistente.*logist|analista.*logist|coordenador.*logist|gestor.*logist|supervisor.*logist/i, 'logística'],
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
  [/vendas|comercial|sales|vendedor|representante.*venda|consultor.*venda|promotor.*venda/i, 'vendas'],
  [/financ|contab|fiscal|tesouraria|contador\b/i, 'finanças'],
  [/rh\b|recursos.?human|people|recrutamento|seleção|dp\b|departamento.?pessoal/i, 'recursos humanos'],
  [/operador.*produção|produção|manufatura|linha.*montagem|montador\b|operador.*máquin/i, 'produção'],
  [/limpeza|zeladoria|portaria\b|segurança.?patrimonial|vigilante|recepção|recepcionista/i, 'serviços gerais'],
  [/construção|obras|engenharia.?civil|pedreiro|eletricista|hidráulico|manutenção\b/i, 'construção'],
  [/enfermagem|enfermeiro|técnico.?saúde|farmácia|hospitalar|clínica\b/i, 'saúde'],
  [/docente|professor|pedagogia|educação|ensino|tutor\b|instrutor\b/i, 'educação'],
  [/marketing|publicidade|propaganda|mídia|branding|seo\b|tráfego.?pago/i, 'marketing'],
  [/jurídico|advogado|advogada|direito\b|paralegal|jurista|contencioso/i, 'jurídico'],
  [/compras|procurement|suprimentos|comprista|analista.*compras/i, 'compras'],
  [/atendimento|callcenter|call.?center|sac\b|telemarketing|relacionamento.?cliente/i, 'atendimento'],
  [/ti\b|tecnologia.*informação|t\.i\.|infraestrutura.*ti/i, 'T.I'],
  [/desenvolvedor|developer|programador|engenheiro.*software|software.*engineer/i, 'desenvolvimento'],
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
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Returns true when a job is exclusively for Pessoas com Deficiência (PCD). */
export function isPcdExclusive(title: string): boolean {
  return /\bpcd\b|pessoa\s+com\s+defici[eê]ncia/i.test(title);
}

// ── Mapa de expansão semântica ───────────────────────────────────────
// Quando um usuário bloqueia uma área, todos os termos relacionados
// também são considerados bloqueados — mesmo sem aparecer no título exato.
const SEMANTIC_EXPANSIONS: Record<string, string[]> = {
  'logistica': [
    'estoque', 'estoquista', 'almoxarife', 'almoxarifado', 'conferente',
    'separador', 'expedidor', 'recebimento', 'recebedor', 'movimentador',
    'carregador', 'descarregador', 'operador logistico', 'auxiliar estoque',
    'assistente logistico', 'analista logistico', 'coordenador logistico',
    'warehouse', 'armazem', 'supply chain', 'transporte', 'frete',
    'entregador', 'motorista entrega', 'distribuicao', 'expedicao',
  ],
  'vendas': [
    'vendedor', 'comercial', 'consultor de vendas', 'representante',
    'promotor', 'inside sales', 'pre-venda', 'prospeccao', 'closer',
    'hunter', 'account executive', 'sdr',
  ],
  'financas': [
    'financeiro', 'contabil', 'fiscal', 'tesouraria', 'contabilidade',
    'contador', 'controladoria', 'contas a pagar', 'contas a receber',
    'conciliacao bancaria', 'auditoria',
  ],
  'recursos humanos': [
    'rh', 'recrutamento', 'selecao', 'departamento pessoal', 'dp',
    'treinamento', 'desenvolvimento humano', 'people', 'talent acquisition',
    'remuneracao', 'cargos e salarios',
  ],
  'producao': [
    'operador de producao', 'linha de montagem', 'montador', 'manufatura',
    'operador de maquina', 'auxiliar de producao', 'qualidade industrial',
  ],
  'servicos gerais': [
    'limpeza', 'zeladoria', 'portaria', 'vigilante', 'seguranca patrimonial',
    'recepcionista', 'auxiliar de servicos gerais', 'copeira', 'faxineiro',
  ],
  'construcao': [
    'pedreiro', 'eletricista', 'encanador', 'hidraulico', 'manutencao',
    'marceneiro', 'pintor', 'servente', 'carpinteiro', 'soldador',
  ],
  'atendimento': [
    'atendente', 'callcenter', 'call center', 'sac', 'telemarketing',
    'operador de telefonia', 'chat', 'relacionamento com cliente',
  ],
};

// ── isBlocked ───────────────────────────────────────────────────────
/**
 * Retorna true se o cargo pertence a uma área bloqueada.
 * Verifica 3 camadas:
 *  1. Categoria inferida pelo título (ex: "Estoquista" → "logística")
 *  2. Substring direta do título (ex: título contém "logistic")
 *  3. Expansão semântica: termos relacionados à área bloqueada
 */
export function isBlocked(title: string, blockedKeywords: string[]): boolean {
  if (!blockedKeywords.length) return false;

  const category = normalizeStr(inferCategory(title));
  const titleNorm = normalizeStr(title);

  return blockedKeywords.some((kw) => {
    const kwNorm = normalizeStr(kw);

    // 1. Categoria inferida bate exatamente com o bloqueio
    if (category === kwNorm) return true;

    // 2. Título contém a palavra bloqueada como substring
    if (titleNorm.includes(kwNorm)) return true;

    // 3. Expansão semântica: termos relacionados
    const expansion = SEMANTIC_EXPANSIONS[kwNorm];
    if (expansion?.some((exp) => titleNorm.includes(exp))) return true;

    return false;
  });
}

/**
 * Expande uma lista de bloqueios com os termos semânticos relacionados.
 * Usado nos prompts de IA para instruir Claude/Gemini com mais precisão.
 */
export function expandBlockedTerms(blockedKeywords: string[]): string[] {
  const all = new Set(blockedKeywords.map((k) => k.toLowerCase()));
  for (const kw of blockedKeywords) {
    const kwNorm = kw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const expansion = SEMANTIC_EXPANSIONS[kwNorm];
    if (expansion) expansion.forEach((t) => all.add(t));
  }
  return [...all];
}
