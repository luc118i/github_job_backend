import { GoogleGenerativeAI } from '@google/generative-ai';
import { CareerProfile } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

// Ferramenta de busca do Google — ancora as tendências no mercado real,
// não só no conhecimento estático do modelo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GOOGLE_SEARCH_TOOL: any = { googleSearch: {} };

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

// Cache em memória — evita queimar créditos de IA a cada carregamento da tela.
// Chave = assinatura do perfil; TTL de 24h (tendência não muda de hora em hora).
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; suggestions: string[] }>();

function extractJsonArray(text: string): string[] {
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.map((s) => String(s).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function profileSignature(p: CareerProfile): string {
  return [
    ...(p.desiredAreas ?? []),
    p.transitionTarget ?? '',
    p.careerGoals ?? '',
    ...(p.hiddenSkills ?? []),
    ...(p.workStyle ?? []),
  ]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

function buildPrompt(p: CareerProfile): string {
  const areas = (p.desiredAreas ?? []).join(', ') || 'não informado';
  const target = p.transitionTarget ? `Quer migrar para: ${p.transitionTarget}` : '';
  const skills = (p.hiddenSkills ?? []).join(', ') || 'não informado';

  return `Com base na pesquisa do mercado de trabalho brasileiro ATUAL, sugira de 4 a 6 termos de busca de vagas EM ALTA e relevantes para o perfil abaixo. Os termos devem ser cargos ou áreas concretos que a pessoa digitaria num buscador de vagas (ex: "Analista de Dados", "Engenheiro de Software Pleno", "Product Owner"). Priorize funções com demanda crescente.

PERFIL:
Áreas de interesse: ${areas}
${target}
Objetivo de carreira: ${p.careerGoals || 'não informado'}
Habilidades: ${skills}

Retorne APENAS um array JSON de strings, sem texto antes ou depois. Cada string com no máximo 4 palavras. Exemplo: ["Analista de Dados", "Engenheiro de Dados", "Analista de BI"]`;
}

// Termos curados por área — usados quando o Gemini está indisponível.
const STATIC_TRENDS: Record<string, string[]> = {
  'ti':            ['Analista de TI', 'Analista de Suporte', 'Analista de Sistemas'],
  'tecnologia':    ['Analista de TI', 'Analista de Sistemas', 'Consultor de TI'],
  'dados':         ['Analista de Dados', 'Engenheiro de Dados', 'Analista de BI'],
  'data':          ['Analista de Dados', 'Data Scientist', 'Engenheiro de Dados'],
  'software':      ['Desenvolvedor de Software', 'Engenheiro de Software', 'Analista de Sistemas'],
  'dev':           ['Desenvolvedor Full Stack', 'Desenvolvedor Backend', 'Desenvolvedor Frontend'],
  'frontend':      ['Desenvolvedor Frontend', 'Engenheiro Frontend', 'UI Developer'],
  'backend':       ['Desenvolvedor Backend', 'Engenheiro Backend', 'API Developer'],
  'fullstack':     ['Desenvolvedor Full Stack', 'Engenheiro Full Stack'],
  'nodejs':        ['Desenvolvedor Node.js', 'Desenvolvedor Backend', 'Engenheiro Backend'],
  'python':        ['Desenvolvedor Python', 'Engenheiro de Dados', 'Cientista de Dados'],
  'javascript':    ['Desenvolvedor JavaScript', 'Desenvolvedor Frontend', 'Desenvolvedor React'],
  'react':         ['Desenvolvedor React', 'Desenvolvedor Frontend', 'Engenheiro Frontend'],
  'mobile':        ['Desenvolvedor Mobile', 'Desenvolvedor React Native', 'Engenheiro Mobile'],
  'devops':        ['Engenheiro DevOps', 'SRE', 'Engenheiro de Infraestrutura'],
  'cloud':         ['Engenheiro Cloud', 'Arquiteto de Nuvem', 'DevOps Engineer'],
  'segurança':     ['Analista de Segurança', 'Engenheiro de Segurança', 'Consultor em Cybersecurity'],
  'qa':            ['Analista de QA', 'Engenheiro de Testes', 'Analista de Qualidade'],
  'produto':       ['Product Manager', 'Product Owner', 'Analista de Produto'],
  'ux':            ['UX Designer', 'Product Designer', 'UX Researcher'],
  'ui':            ['UI Designer', 'Product Designer', 'Designer de Interface'],
  'ia':            ['Engenheiro de Machine Learning', 'Cientista de Dados', 'Desenvolvedor de IA'],
  'machine learning': ['Engenheiro de ML', 'Cientista de Dados', 'Engenheiro de IA'],
  'administrativo':['Assistente Administrativo', 'Analista Administrativo', 'Coordenador Administrativo'],
  'financeiro':    ['Analista Financeiro', 'Analista Contábil', 'Controller Financeiro'],
  'marketing':     ['Analista de Marketing', 'Coordenador de Marketing Digital', 'Gerente de Marketing'],
  'rh':            ['Analista de RH', 'Analista de Recursos Humanos', 'Business Partner RH'],
  'vendas':        ['Representante Comercial', 'Executivo de Vendas', 'Analista Comercial'],
  'logística':     ['Analista de Logística', 'Coordenador de Logística', 'Supervisor de Operações'],
  'jurídico':      ['Advogado', 'Analista Jurídico', 'Assessor Jurídico'],
};

function staticFallback(profile: CareerProfile): string[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  const areas = [...(profile.desiredAreas ?? []), profile.transitionTarget ?? ''].filter(Boolean);
  for (const area of areas) {
    const key = norm(area);
    for (const [term, titles] of Object.entries(STATIC_TRENDS)) {
      if (key.includes(term) || term.includes(key)) {
        for (const t of titles) {
          if (!seen.has(t)) { seen.add(t); out.push(t); }
          if (out.length >= 5) return out;
        }
      }
    }
  }
  return out;
}

/**
 * Sugere termos de busca em alta no mercado BR para o perfil informado.
 * Tenta Gemini (com cache 24h); se indisponível usa termos curados estáticos.
 */
export async function getTrendingSuggestions(profile: CareerProfile): Promise<string[]> {
  const key = profileSignature(profile);
  if (!key) return staticFallback(profile);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.suggestions;

  const prompt = buildPrompt(profile);

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [GOOGLE_SEARCH_TOOL] as any,
        systemInstruction:
          'Você é um analista do mercado de trabalho brasileiro. Responda APENAS com um array JSON de strings, sem texto antes ou depois.',
      });
      const result = await model.generateContent(prompt);
      const suggestions = extractJsonArray(result.response.text()).slice(0, 6);
      if (suggestions.length) {
        cache.set(key, { at: Date.now(), suggestions });
        return suggestions;
      }
    } catch (err) {
      console.warn(`[trends/gemini] ${modelName} falhou (${(err as Error).message}), tentando próximo...`);
    }
  }

  // Gemini indisponível — usa termos curados estáticos para o perfil
  const fallback = staticFallback(profile);
  console.log(`[trends] Gemini indisponível, usando fallback estático: ${fallback.join(', ')}`);
  return fallback;
}
