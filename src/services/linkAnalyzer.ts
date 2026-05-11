import Anthropic from '@anthropic-ai/sdk';
import { LinkedInPosition, LinkedInEducation, LinkedInData } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
        required: ['title', 'company', 'level', 'remote', 'skills', 'description', 'atsKeywords', 'requirements'],
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
        `  - ${e.degree ?? 'Curso'}, ${e.school}${e.endDate ? ' (' + e.endDate + ')' : ''}`
      );
      lines.push('Formacao:\n' + edu.join('\n'));
    }
  }

  return lines.join('\n');
}

export async function analyzeJobLink(url: string, profile: CandidateProfile): Promise<LinkAnalysisResult> {
  const pageContent = await fetchPageContent(url);
  const profileText = formatProfile(profile);

  const hasProfile = !!(profile.skills?.length || profile.linkedIn?.positions?.length);

  const jobContext = pageContent.length > 200
    ? `CONTEUDO DA PAGINA DA VAGA:\n${pageContent}`
    : `URL da vaga (conteudo nao disponivel, infira pelo dominio e URL): ${url}`;

  const profileContext = hasProfile
    ? `PERFIL DO CANDIDATO:\n${profileText}`
    : 'PERFIL DO CANDIDATO: nao fornecido — calcule match como 0 e indique que o perfil precisa ser configurado.';

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `Voce e um especialista em recrutamento, ATS optimization e analise de carreira.
Sua funcao e analisar uma vaga e calcular o match com o perfil do candidato.
Regras:
- Seja direto, estrategico e especifico. Nunca use frases genericas.
- Calcule o score honestamente com base nos dados reais do perfil.
- Se o perfil estiver vazio, score = 0 e explique que o candidato precisa configurar LinkedIn e GitHub.
- Nunca invente experiencias ou tecnologias que o candidato nao possui.
- Identifique palavras-chave ATS precisas que aumentam a chance de passar por filtros automaticos.`,
    tools: [ANALYZE_JOB_TOOL],
    tool_choice: { type: 'tool', name: 'analyze_job' },
    messages: [{
      role: 'user',
      content: `${jobContext}\n\n${profileContext}\n\nAnalise a vaga, extraia todos os dados relevantes e calcule o match do candidato com esta posicao.`,
    }],
  });

  const toolBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'analyze_job'
  );

  if (!toolBlock) throw new Error('Não foi possível extrair os dados da vaga. Verifique se o link é válido e tente novamente.');

  return toolBlock.input as LinkAnalysisResult;
}
