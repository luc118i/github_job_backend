import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { LinkedInPosition, LinkedInEducation, LinkedInData } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Lazy init — evita instanciar antes do .env ser carregado (mesmo padrão de resumeParser.ts)
let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
];

export interface CandidateProfile {
  name?: string;
  githubUsername?: string;
  githubBio?: string | null;
  skills?: string[];
  repos?: { name: string; description: string | null; topics: string[] }[];
  linkedIn?: LinkedInData | null;
}

export interface MatchAnalysis {
  score: number;
  level: 'baixo' | 'medio' | 'alto' | 'excelente';
  strengths: string[];
  gaps: string[];
  missingKeywords: string[];
  recommendations: string[];
  competitiveness: string;
  interviewChance: string;
}

export interface ExtractedJob {
  title: string;
  company: string;
  level: 'Junior' | 'Pleno' | 'Senior';
  remote: boolean;
  location: string | null;
  skills: string[];
  description: string;
  salary: string | null;
  atsKeywords: string[];
  requirements: string[];
  language: string | null;
  contactEmail: string | null;
}

export interface LinkAnalysisResult {
  job: ExtractedJob;
  match: MatchAnalysis;
}

const ANALYZE_JOB_TOOL: Anthropic.Tool = {
  name: 'analyze_job',
  description: 'Extrai os detalhes da vaga e calcula o match com o perfil do candidato.',
  input_schema: {
    type: 'object' as const,
    required: ['job', 'match'],
    properties: {
      job: {
        type: 'object',
        required: ['title', 'company', 'level', 'remote', 'skills', 'description', 'atsKeywords', 'requirements', 'contactEmail'],
        properties: {
          title:        { type: 'string' },
          company:      { type: 'string' },
          level:        { type: 'string', enum: ['Junior', 'Pleno', 'Senior'] },
          remote:       { type: 'boolean' },
          location:     { type: ['string', 'null'] },
          skills:       { type: 'array', items: { type: 'string' }, description: 'Stack tecnológica exigida' },
          description:  { type: 'string', description: 'Resumo estratégico da vaga em 2-3 frases' },
          salary:       { type: ['string', 'null'] },
          atsKeywords:  { type: 'array', items: { type: 'string' }, description: 'Palavras-chave ATS da vaga para otimização de currículo' },
          requirements: { type: 'array', items: { type: 'string' }, description: 'Requisitos principais listados na vaga' },
          language:     { type: ['string', 'null'], description: 'Idioma exigido, ex: Inglês avançado' },
          contactEmail: { type: ['string', 'null'], description: 'E-mail para envio de currículo/candidatura, SOMENTE se explicitamente mencionado no texto da vaga (ex: "envie currículo para..."). null se não houver.' },
        },
      },
      match: {
        type: 'object',
        required: ['score', 'level', 'strengths', 'gaps', 'missingKeywords', 'recommendations', 'competitiveness', 'interviewChance'],
        properties: {
          score:            { type: 'number', minimum: 0, maximum: 100 },
          level:            { type: 'string', enum: ['baixo', 'medio', 'alto', 'excelente'] },
          strengths:        { type: 'array', items: { type: 'string' }, description: 'Pontos fortes do candidato para esta vaga, específicos e diretos' },
          gaps:             { type: 'array', items: { type: 'string' }, description: 'Gaps técnicos identificados' },
          missingKeywords:  { type: 'array', items: { type: 'string' }, description: 'Palavras-chave ATS ausentes no perfil do candidato' },
          recommendations:  { type: 'array', items: { type: 'string' }, description: 'Sugestões concretas para aumentar aderência à vaga' },
          competitiveness:  { type: 'string', description: 'Ex: Alta, Média, Baixa' },
          interviewChance:  { type: 'string', description: 'Estimativa de chance de entrevista, ex: ~65%' },
        },
      },
    },
  },
};

const ANALYZE_JOB_TOOL_GROQ: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: ANALYZE_JOB_TOOL.name,
    description: ANALYZE_JOB_TOOL.description,
    parameters: ANALYZE_JOB_TOOL.input_schema as Record<string, unknown>,
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchPageContent(url: string): Promise<string> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(tid);
    if (!res.ok) return '';
    const html = await res.text();
    const text = stripHtml(html);
    return text.slice(0, 12000);
  } catch {
    clearTimeout(tid);
    return '';
  }
}

function formatProfile(profile: CandidateProfile): string {
  const lines: string[] = [];

  if (profile.githubUsername) lines.push(`GitHub: ${profile.githubUsername}`);
  if (profile.name) lines.push(`Nome: ${profile.name}`);
  if (profile.githubBio) lines.push(`Bio: ${profile.githubBio}`);
  if (profile.skills?.length) lines.push(`Tecnologias (GitHub): ${profile.skills.slice(0, 8).join(', ')}`);

  if (profile.repos?.length) {
    const repoLines = profile.repos
      .filter((r) => !!(r.description || r.topics.length))
      .slice(0, 5)
      .map((r) => {
        const parts = [r.name];
        if (r.description) parts.push(`(${r.description})`);
        if (r.topics.length) parts.push(`[${r.topics.join(', ')}]`);
        return '  - ' + parts.join(' ');
      });
    if (repoLines.length) lines.push('Projetos GitHub:\n' + repoLines.join('\n'));
  }

  const li = profile.linkedIn;
  if (li) {
    if (li.name) lines.push(`Nome completo: ${li.name}`);
    if (li.positions?.length) {
      const positions = li.positions.slice(0, 4).map((p: LinkedInPosition) => {
        const end = p.finishedOn ?? 'atual';
        return `  - ${p.title}, ${p.company} (${p.startedOn}–${end})${p.description ? ': ' + p.description.slice(0, 120) : ''}`;
      });
      lines.push('Experiencia profissional:\n' + positions.join('\n'));
    }
    if (li.education?.length) {
      const edu = li.education.slice(0, 2).map((e: LinkedInEducation) =>
        `  - ${[e.degree, e.fieldOfStudy].filter(Boolean).join(' em ') || 'Curso'}, ${e.school}${e.endDate ? ' (' + e.endDate + ')' : ''}`
      );
      lines.push('Formacao:\n' + edu.join('\n'));
    }
    if (li.skills?.length) {
      lines.push(`Habilidades declaradas: ${li.skills.slice(0, 12).join(', ')}`);
    }
    if (li.languages?.length) {
      lines.push('Idiomas: ' + li.languages.slice(0, 4).map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`).join(', '));
    }
    if (li.objective) {
      lines.push(`Objetivo profissional: ${li.objective}`);
    }
  }

  return lines.join('\n');
}

const ANALYZE_JOB_SYSTEM = `Voce e um especialista em recrutamento, ATS optimization e analise de carreira.
Sua funcao e analisar uma vaga e calcular o match com o perfil do candidato.
Regras:
- Seja direto, estrategico e especifico. Nunca use frases genericas.
- Calcule o score honestamente com base nos dados reais do perfil.
- Se o perfil estiver vazio, score = 0 e explique que o candidato precisa configurar LinkedIn e GitHub.
- Nunca invente experiencias ou tecnologias que o candidato nao possui.
- Identifique palavras-chave ATS precisas que aumentam a chance de passar por filtros automaticos.
- CRITICO — relevancia por area: antes de listar qualquer coisa em "strengths", verifique se aquela habilidade/experiencia do perfil e de fato relevante para ESTA vaga especifica. Nunca liste tecnologias ou skills do perfil (ex: linguagens de programacao, frameworks) como ponto forte de uma vaga de outra area (ex: almoxarife, vendas, administrativo) so porque estao no perfil — isso e ruido, nao forca.
- Se o perfil do candidato for de uma area totalmente diferente da vaga (ex: desenvolvedor de software analisando vaga de almoxarife), seja honesto: score baixo, aponte a falta de aderencia de area diretamente nos gaps, e so cite como "strengths" competencias transferiveis genuinas (ex: organizacao, atencao a detalhes, se realmente evidentes no perfil) — nunca competencias tecnicas fora do dominio da vaga.
- "missingKeywords" deve conter só termos ATS da propria vaga que o perfil realmente nao cobre — nunca misture com jargao tecnico do perfil que nao aparece na vaga.
- Inferencia razoavel por experiencia: se o perfil descreve anos de atuacao numa area diretamente relacionada a um requisito da vaga (ex: "4 anos trabalhando com logistica" para uma vaga que pede "conhecimento em sistemas de gestao logistica"), considere isso como evidencia real de familiaridade — nao trate como gap so porque o candidato nao citou o nome exato de um sistema/ferramenta. Só marque como gap quando a experiencia relevante realmente nao existe no perfil.
- "contactEmail": extraia o e-mail de candidatura APENAS se estiver explicitamente escrito no texto da vaga (ex: "envie currículo para..."). Nunca invente ou deduza um e-mail — se não houver menção explícita, retorne null.`;

function buildAnalyzeJobPrompt(jobContext: string, profileContext: string): string {
  return `${jobContext}\n\n${profileContext}\n\nAnalise a vaga, extraia todos os dados relevantes e calcule o match do candidato com esta posicao.`;
}

async function analyzeJobLinkClaude(jobContext: string, profileContext: string): Promise<LinkAnalysisResult> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: ANALYZE_JOB_SYSTEM,
    tools: [ANALYZE_JOB_TOOL],
    tool_choice: { type: 'tool', name: 'analyze_job' },
    messages: [{ role: 'user', content: buildAnalyzeJobPrompt(jobContext, profileContext) }],
  });

  const toolBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'analyze_job'
  );

  if (!toolBlock) throw new Error('Não foi possível extrair os dados da vaga. Verifique se o link é válido e tente novamente.');

  return toolBlock.input as LinkAnalysisResult;
}

async function analyzeJobLinkGroq(jobContext: string, profileContext: string): Promise<LinkAnalysisResult> {
  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await getGroq().chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: ANALYZE_JOB_SYSTEM },
          { role: 'user', content: buildAnalyzeJobPrompt(jobContext, profileContext) },
        ],
        tools: [ANALYZE_JOB_TOOL_GROQ],
        tool_choice: { type: 'function', function: { name: 'analyze_job' } },
      });

      const toolCall = response.choices[0]?.message.tool_calls?.find(
        (tc) => tc.function.name === 'analyze_job'
      );
      if (!toolCall) throw new Error('Groq não retornou analyze_job');

      return JSON.parse(toolCall.function.arguments) as LinkAnalysisResult;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || status === 503 || status === 404 ||
        msg.includes('JSON') || msg.includes('analyze_job') || msg.includes('tool_use_failed') || msg.includes('did not call a tool');
      if (retryable) {
        console.warn(`[link-analyzer/groq] ${model} falhou (${msg}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Motor primário: Claude. Se falhar (quota, crédito, indisponibilidade), cai pro Groq.
 *  Aceita ou uma URL (raspa a página) ou o texto da vaga colado diretamente — útil quando
 *  o site bloqueia acesso automático (ex: Indeed retorna 403 pra scrapers). */
export async function analyzeJobLink(
  input: { url?: string; text?: string },
  profile: CandidateProfile
): Promise<LinkAnalysisResult> {
  const pastedText = input.text?.trim().slice(0, 12000);
  const pageContent = pastedText || (input.url ? await fetchPageContent(input.url) : '');

  // Sem conteúdo real da página, a IA inventa dados (título, empresa, skills) em vez de
  // avisar que não conseguiu ler a vaga — melhor recusar aqui do que salvar um resultado falso.
  if (pageContent.length <= 200) {
    throw new Error('Não foi possível ler o conteúdo dessa vaga — o site pode estar bloqueando o acesso automático. Tente outro link (Gupy, vagas.com.br, LinkedIn ou site da empresa costumam funcionar) ou cole a descrição da vaga no campo de texto.');
  }

  const profileText = formatProfile(profile);

  const hasProfile = !!(profile.skills?.length || profile.linkedIn?.positions?.length || profile.linkedIn?.skills?.length);

  const jobContext = `CONTEUDO DA PAGINA DA VAGA:\n${pageContent}`;

  const profileContext = hasProfile
    ? `PERFIL DO CANDIDATO:\n${profileText}`
    : 'PERFIL DO CANDIDATO: nao fornecido — calcule match como 0 e indique que o perfil precisa ser configurado.';

  try {
    return await analyzeJobLinkClaude(jobContext, profileContext);
  } catch (err) {
    console.warn(`[link-analyzer] Claude falhou (${(err as Error).message}), tentando Groq...`);
    return analyzeJobLinkGroq(jobContext, profileContext);
  }
}
