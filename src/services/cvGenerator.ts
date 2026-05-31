import { randomUUID } from 'crypto';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CvRequest, CvResponse, CvBlock, CvBlockType, LinkedInPosition, LinkedInEducation } from '../types';
import { supabase } from './supabase';

const geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Lazy init — evita instanciar antes do .env ser carregado (mesmo padrão de groq.ts)
let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// Motor primário: Groq (modelos abertos, rápidos e baratos). Fallback entre modelos
// na mesma ordem usada no career chat, caso algum seja descontinuado/indisponível.
const GROQ_CV_MODELS = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

const SYSTEM_PROMPT = `Você é um especialista em RH e otimização de currículos para ATS (Applicant Tracking System).
Gere currículos que:
1. Passem em filtros automáticos de ATS com alta taxa de aprovação
2. Sejam baseados APENAS em dados reais fornecidos — NUNCA invente experiências, empresas ou cursos
3. Usem keywords exatas da descrição da vaga no resumo profissional
4. Sejam escritos em português brasileiro
5. Retornem APENAS um objeto JSON válido (sem markdown de cerca de código, sem explicações)
6. NUNCA usem emojis, símbolos decorativos ou caracteres especiais — apenas texto puro e Markdown padrão (- **) dentro de cada bloco`;

// Tipos de bloco aceitos da IA. Mapeia type -> título padrão exibido.
const BLOCK_TITLES: Record<CvBlockType, string> = {
  resumo: 'RESUMO PROFISSIONAL',
  skills: 'HABILIDADES TÉCNICAS',
  experiencia: 'EXPERIÊNCIA PROFISSIONAL',
  projetos: 'PROJETOS RELEVANTES',
  formacao: 'FORMAÇÃO ACADÊMICA',
  certificacoes: 'CERTIFICAÇÕES',
  idiomas: 'IDIOMAS',
};
const VALID_TYPES = new Set(Object.keys(BLOCK_TITLES) as CvBlockType[]);

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]/gu;

function stripEmojis(text: string): string {
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPositions(positions: LinkedInPosition[]): string {
  if (positions.length === 0) return '[PREENCHER]';
  return positions.slice(0, 4).map((p) => {
    const end = p.finishedOn ?? 'atual';
    const loc = p.location ? ` | ${p.location}` : '';
    const desc = p.description ? `\n  ${p.description.slice(0, 150)}` : '';
    return `- **${p.title}** @ ${p.company} (${p.startedOn} – ${end})${loc}${desc}`;
  }).join('\n');
}

function formatEducation(education: LinkedInEducation[]): string {
  if (education.length === 0) return '[PREENCHER]';
  return education.map((e) => {
    const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
    const notes = e.notes ? ` — ${e.notes.slice(0, 80)}` : '';
    return `- **${e.degree ?? 'Curso'}** @ ${e.school}${period ? ` (${period})` : ''}${notes}`;
  }).join('\n');
}

function buildPrompt(req: CvRequest): string {
  const { job, candidate } = req;

  const shortDesc = job.description.length > 600
    ? job.description.slice(0, 600) + '...'
    : job.description;

  const topRepos = candidate.repos
    .filter((r) => !r.fork)
    .slice(0, 3)
    .map((r) => {
      const stars = r.stargazers_count > 0 ? ` (${r.stargazers_count} stars)` : '';
      const lang = r.language ? ` | ${r.language}` : '';
      const desc = r.description ? ` — ${r.description.slice(0, 80)}` : '';
      return `- **${r.name}**${lang}${stars}${desc} | ${r.html_url}`;
    })
    .join('\n');

  const bio = candidate.githubBio ? `Bio: ${candidate.githubBio}` : '';

  const contactParts = [
    candidate.email,
    candidate.phone,
    candidate.githubLogin ? `github.com/${candidate.githubLogin}` : null,
  ].filter(Boolean);
  const contactLine = contactParts.length ? contactParts.join(' | ') : '[contato]';

  return `Gere um currículo ATS-otimizado e retorne APENAS um objeto JSON (sem cercas de código).

VAGA: ${job.title} @ ${job.company} | ${job.level} | ${job.remote ? 'Remoto' : 'Presencial'}
Skills: ${job.skills.join(', ')}
Descrição: ${shortDesc}

CANDIDATO: ${candidate.name}
Contato: ${contactLine}
${bio}
${candidate.skills.length ? `Linguagens GitHub: ${candidate.skills.join(', ')}` : ''}
${topRepos ? `Repos: ${topRepos}` : ''}

EXPERIÊNCIA PROFISSIONAL (dados reais do LinkedIn):
${formatPositions(candidate.positions)}

FORMAÇÃO ACADÊMICA (dados reais do LinkedIn):
${formatEducation(candidate.education)}

FORMATO DE SAÍDA (JSON):
{
  "blocks": [
    { "type": "resumo", "content": "<parágrafo único usando keywords exatas: \\"${job.title}\\", \\"${job.skills.slice(0, 3).join('\\", \\"')}\\">" },
    { "type": "skills", "content": "**Linguagens:** ...\\n**Ferramentas:** Git, GitHub, ..." },
    { "type": "experiencia", "content": "<bullets '- ' com verbos de ação a partir dos dados reais; se vazio, '- [PREENCHER]'>" },
    { "type": "projetos", "content": "<bullets '- ' dos repos reais acima, com tecnologia e link>" },
    { "type": "formacao", "content": "<bullets '- ' a partir dos dados reais; se vazio, '- [PREENCHER]'>" }
  ]
}

Regras:
- "type" só pode ser: resumo, skills, experiencia, projetos, formacao, certificacoes, idiomas.
- "content" é texto/Markdown (use '- ' para listas, '**' para negrito). Sem títulos '#' dentro do content.
- Inclua certificacoes/idiomas APENAS se houver dados reais para isso.
- NUNCA invente dados. Sem tabelas. Sem emojis.`;
}

// ── Parsing/serialização de blocos ─────────────────────────────────

/** Extrai o objeto JSON da resposta da IA, tolerando cercas ```json. */
function parseBlocks(raw: string): CvBlock[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Recorta do primeiro { ao último } — descarta prefácios eventuais.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou JSON de blocos');
  const parsed = JSON.parse(text.slice(start, end + 1)) as { blocks?: unknown };

  if (!Array.isArray(parsed.blocks)) throw new Error('JSON sem array "blocks"');

  const blocks: CvBlock[] = [];
  for (const item of parsed.blocks) {
    const b = item as { type?: string; title?: string; content?: unknown };
    const type = b.type as CvBlockType;
    if (!VALID_TYPES.has(type)) continue; // ignora tipos desconhecidos
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (!content) continue;
    blocks.push({
      id: randomUUID(),
      type,
      title: b.title?.trim() || BLOCK_TITLES[type],
      content: stripEmojis(content),
      visible: true,
    });
  }
  if (blocks.length === 0) throw new Error('Nenhum bloco válido no JSON');
  return blocks;
}

/** Markdown derivado (header + blocos visíveis) para PDF/retrocompat. */
function blocksToMarkdown(req: CvRequest, blocks: CvBlock[]): string {
  const { candidate } = req;
  const contactParts = [
    candidate.email,
    candidate.phone,
    candidate.githubLogin ? `github.com/${candidate.githubLogin}` : null,
  ].filter(Boolean);
  const contactLine = contactParts.length ? contactParts.join(' | ') : '[contato]';

  const header = `# ${candidate.name.toUpperCase()}\n${contactLine}`;
  const body = blocks
    .filter((b) => b.visible)
    .map((b) => `## ${b.title}\n${b.content.trim()}`)
    .join('\n\n');
  return `${header}\n\n${body}`.trim();
}

async function generateCvGroq(req: CvRequest): Promise<CvBlock[]> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(req) },
  ];

  let lastErr: unknown;
  for (const model of GROQ_CV_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages,
      });

      const raw = response.choices[0]?.message.content ?? '';
      if (!raw.trim()) throw new Error('Groq retornou CV vazio');

      return parseBlocks(raw);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
      const retryable =
        status === 429 || status === 503 || status === 404 ||
        code === 'model_decommissioned' || code === 'model_not_found' ||
        msg.includes('vazio') || msg.includes('JSON') || msg.includes('blocos') ||
        msg.includes('bloco');
      if (retryable) {
        console.warn(`[cv/groq] ${model} falhou (${msg}), tentando próximo modelo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const GEMINI_CV_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

async function generateCvGemini(req: CvRequest): Promise<CvBlock[]> {
  let lastErr: unknown;
  for (const modelName of GEMINI_CV_MODELS) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(buildPrompt(req));
      return parseBlocks(result.response.text());
    } catch (err) {
      const status = (err as { status?: number }).status;
      const msg = (err as Error).message ?? '';
      const retryable =
        status === 503 || status === 429 ||
        msg.includes('JSON') || msg.includes('blocos') || msg.includes('bloco');
      if (retryable) {
        console.warn(`[cv] Gemini ${modelName} falhou (${status ?? msg}), tentando próximo modelo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function generateCv(req: CvRequest): Promise<CvResponse> {
  let blocks: CvBlock[];

  // Motor primário: Groq. Se todos os modelos Groq falharem, cai pro Gemini.
  try {
    blocks = await generateCvGroq(req);
  } catch (err) {
    console.warn(`[cv] Groq indisponível (${(err as Error).message}), caindo pro Gemini...`);
    blocks = await generateCvGemini(req);
  }

  // Markdown derivado dos blocos — fonte para PDF e retrocompatibilidade.
  const content = blocksToMarkdown(req, blocks);

  const { data, error } = await supabase
    .from('cvs')
    .insert({ job_id: req.job.id, content, content_blocks: blocks })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  const cvId = data.id as string;

  // M2: registra a versão inicial automaticamente (histórico começa aqui).
  // Best-effort: se a tabela ainda não existir, não derruba a geração do CV.
  const { error: vErr } = await supabase
    .from('cv_versions')
    .insert({ cv_id: cvId, content, content_blocks: blocks, label: 'Versão inicial', source: 'initial' });
  if (vErr) console.warn(`[cv] falha ao salvar versão inicial: ${vErr.message}`);

  return { cvId, content, blocks };
}
