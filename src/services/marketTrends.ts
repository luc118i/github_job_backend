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

/**
 * Sugere termos de busca em alta no mercado BR para o perfil informado.
 * Resultado cacheado por 24h. Em caso de falha, retorna [] (o frontend faz
 * fallback para as sugestões do perfil declarado).
 */
export async function getTrendingSuggestions(profile: CareerProfile): Promise<string[]> {
  const key = profileSignature(profile);
  if (!key) return [];

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

  return [];
}
