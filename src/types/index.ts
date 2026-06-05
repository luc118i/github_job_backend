export type LinkStatus = 'trusted' | 'unverified' | 'dead' | 'none';

export interface Job {
  title: string;
  company: string;
  level: 'Junior' | 'Pleno' | 'Senior';
  remote: boolean;
  location: string | null;
  skills: string[];
  description: string;
  salary: string | null;
  link: string | null;
  published_at?: string | null;
}

export interface JobRecord extends Job {
  id: string;
  search_id: string;
  link_status: LinkStatus;
  seen: boolean;
  created_at: string;
}

export interface SearchRecord {
  id: string;
  github_username: string | null;
  skills: string[];
  created_at: string;
  jobs: JobRecord[];
}

export interface UserPreferences {
  modality: 'any' | 'remote' | 'presencial' | 'hybrid';
  location: string;
  salaryMin: string;
  salaryMax: string;
  level: 'any' | 'Junior' | 'Pleno' | 'Senior';
  maxAgeDays?: number;
  /** Raio de busca em km. 0 = Nacional (sem filtro geográfico). */
  radiusKm?: number;
  /** Quando true, exibe apenas vagas com título/descrição em português. */
  ptBrOnly?: boolean;
}

export interface RepoContext {
  name: string;
  description: string | null;
  topics: string[];
}

export interface JobSearchRequest {
  username: string;
  name: string;
  bio: string | null;
  skills: string[];
  topRepos: string[];
  repoContext?: RepoContext[];
  followers: number;
  preferences?: UserPreferences;
  blockedKeywords?: string[];
  likedKeywords?: string[];
  blockedSources?: string[];
  likedSources?: string[];
}

export interface LinkedInPosition {
  company: string;
  title: string;
  description: string | null;
  location: string | null;
  startedOn: string;
  finishedOn: string | null;
}

export interface LinkedInEducation {
  school: string;
  degree: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

export interface LinkedInCertification {
  name: string;
  authority: string | null;
  licenseNumber: string | null;
  startedOn: string | null;
  finishedOn: string | null;
}

export interface LinkedInData {
  name: string | null;
  email: string | null;
  phone: string | null;
  positions: LinkedInPosition[];
  education: LinkedInEducation[];
  certifications: LinkedInCertification[];
}

export interface GitHubRepoEnriched {
  name: string;
  language: string | null;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  fork: boolean;
}

export interface ProfessionJob {
  title: string;
  company: string;
  level: 'Junior' | 'Pleno' | 'Senior';
  remote: boolean;
  tags: string[];
  description: string;
  salary: string | null;
  link: string | null;
  match: number;
  published_at?: string | null;
}

export interface ProfessionSearchResult {
  profileSummary: string;
  jobs: ProfessionJob[];
}

export interface CvRequest {
  job: {
    id: string;
    title: string;
    company: string;
    level: 'Junior' | 'Pleno' | 'Senior';
    remote: boolean;
    skills: string[];
    description: string;
  };
  candidate: {
    name: string;
    email: string | null;
    phone: string | null;
    githubLogin: string;
    githubBio: string | null;
    githubFollowers: number;
    githubPublicRepos: number;
    skills: string[];
    repos: GitHubRepoEnriched[];
    positions: LinkedInPosition[];
    education: LinkedInEducation[];
  };
}

// ── CV em blocos (Career Studio M1) ───────────────────────────────
// Modelo nativo do editor: cada seção do currículo é um bloco
// independente (mover/editar/ocultar/duplicar/excluir). Tudo a jusante
// (ATS, Adaptar p/ vaga, versionamento, portfólio) lê/escreve estes
// blocos — por isso o JSON é a fonte da verdade, e o Markdown é derivado.
export type CvBlockType =
  | 'resumo'
  | 'skills'
  | 'experiencia'
  | 'projetos'
  | 'formacao'
  | 'certificacoes'
  | 'idiomas';

export interface CvBlock {
  id: string;
  type: CvBlockType;
  /** Título exibido da seção, ex: "RESUMO PROFISSIONAL". */
  title: string;
  /** Corpo em Markdown (parágrafo ou bullets "- "). */
  content: string;
  /** Oculto não entra no Markdown derivado nem no PDF. */
  visible: boolean;
}

export interface CvResponse {
  cvId: string;
  /** Markdown derivado dos blocos visíveis (PDF / retrocompat). */
  content: string;
  blocks: CvBlock[];
}

// Origem de uma versão do currículo (Career Studio M2).
export type CvVersionSource = 'initial' | 'manual' | 'adapted';

export interface CvVersion {
  id: string;
  cv_id: string;
  content: string;
  content_blocks: CvBlock[] | null;
  label: string;
  source: CvVersionSource;
  created_at: string;
}

// ── Biblioteca de Projetos (Career Studio M5) ─────────────────────
// Coleção curada de projetos do usuário. Reusada nos CVs e ranqueada
// por relevância à vaga via match determinístico (sem IA/embeddings).
// Categoria do projeto — base dos filtros do print (Frontend/Backend/etc).
export type ProjectCategory = 'frontend' | 'backend' | 'fullstack' | 'data' | 'mobile' | 'outro';

export interface Project {
  id: string;
  user_id: string;
  title: string;
  /** Descrição em texto/Markdown. */
  description: string;
  /** Stack/tecnologias — base do match com as skills da vaga. */
  tech: string[];
  /** Conquistas/destaques em bullets (entram no bloco "projetos"). */
  highlights: string[];
  /** Categoria para os filtros (inferida do repo ou definida pelo usuário). */
  category: ProjectCategory;
  link: string | null;
  /** Repositório GitHub de origem, quando importado (chave de dedupe). */
  repo: string | null;
  /** README do repo, cacheado para o match por IA. */
  readme?: string | null;
  created_at: string;
  updated_at: string;
}

// Payload aceito ao criar/editar um projeto (sem campos do servidor).
export interface ProjectInput {
  title: string;
  description?: string;
  tech?: string[];
  highlights?: string[];
  category?: ProjectCategory;
  link?: string | null;
  repo?: string | null;
}

// ── Match projeto↔vaga por IA (lê o README) ───────────────────────
/** Vaga enviada pelo front para o match semântico por IA. */
export interface ProjectMatchJob {
  title: string;
  skills: string[];
  description: string;
}

/** Score semântico de um projeto para a vaga, com justificativa curta. */
export interface ProjectAiMatch {
  id: string;
  /** 0-100 — relevância considerando transferência de competências. */
  score: number;
  /** 1 frase explicando o porquê do score (pt-BR). */
  reason: string;
}

// ── Cartas/Mensagens (Career Studio M6) ───────────────────────────
// Textos gerados por IA e personalizados para a vaga. Persistidos por
// usuário+vaga para revisita/edição posterior (padrão do CV).
export type MessageType = 'cover_letter' | 'recruiter_dm' | 'email' | 'follow_up';

export interface Message {
  id: string;
  user_id: string;
  job_id: string;
  type: MessageType;
  /** Assunto — usado no e-mail; null nos demais tipos. */
  subject: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Resultado efêmero da geração (antes de salvar). */
export interface MessageDraft {
  subject: string | null;
  content: string;
}

/** Payload de criação/edição de uma mensagem persistida. */
export interface MessageInput {
  job_id: string;
  type: MessageType;
  subject?: string | null;
  content: string;
}

// Controles de geração (M6+): ajustam tom, tamanho e idioma da saída.
export type MessageTone = 'formal' | 'balanced' | 'casual';
export type MessageLength = 'short' | 'medium' | 'long';
export type MessageLanguage = 'pt' | 'en';

/** Contexto enviado pelo front para a IA gerar a mensagem. */
export interface MessageGenRequest {
  type: MessageType;
  job: {
    title: string;
    company: string;
    level: 'Junior' | 'Pleno' | 'Senior';
    remote: boolean;
    skills: string[];
    description: string;
  };
  candidate: {
    name: string;
    bio?: string | null;
    skills?: string[];
    /** Cargo atual/último, p/ contextualizar (ex.: do LinkedIn). */
    currentRole?: string | null;
    /** Resumo do candidato (ex.: bloco "resumo" do CV), opcional. */
    summary?: string | null;
  };
  /** Tom da mensagem (default: balanced). */
  tone?: MessageTone;
  /** Comprimento (default: medium). */
  length?: MessageLength;
  /** Idioma de saída (default: pt). */
  language?: MessageLanguage;
  /** Quantas versões gerar de uma vez, 1-3 (default: 1). */
  variations?: number;
}

// ── Interview Studio (Career Studio M7) ───────────────────────────
// Preparação para entrevista por vaga: perguntas prováveis (com resposta
// sugerida em STAR), perguntas para o recrutador e simulação interativa.

/** Vaga usada como contexto da preparação (mesma forma das mensagens). */
export interface InterviewJob {
  title: string;
  company: string;
  level: 'Junior' | 'Pleno' | 'Senior';
  remote: boolean;
  skills: string[];
  description: string;
}

/** Candidato usado como contexto (perfil + projetos reais). */
export interface InterviewCandidate {
  name: string;
  bio?: string | null;
  skills?: string[];
  /** Cargo atual/último (ex.: do LinkedIn). */
  currentRole?: string | null;
  /** Resumo profissional (ex.: bloco "resumo" do CV). */
  summary?: string | null;
  /** Títulos de projetos relevantes, p/ ancorar as respostas STAR. */
  projects?: string[];
}

export type InterviewQCategory = 'tecnica' | 'comportamental';

/** Pergunta provável + resposta sugerida no método STAR. */
export interface InterviewQuestion {
  category: InterviewQCategory;
  question: string;
  /** Rascunho de resposta (STAR) baseado no perfil real do candidato. */
  suggestedAnswer: string;
}

/** Resultado da geração (efêmero, antes de salvar). */
export interface InterviewPrepDraft {
  questions: InterviewQuestion[];
  recruiterQuestions: string[];
}

/** Preparação persistida por usuário+vaga. */
export interface InterviewPrep extends InterviewPrepDraft {
  id: string;
  user_id: string;
  job_id: string;
  created_at: string;
  updated_at: string;
}

/** Payload de criação/atualização (upsert por vaga). */
export interface InterviewPrepInput {
  job_id: string;
  questions: InterviewQuestion[];
  recruiterQuestions: string[];
}

/** Pedido de geração da preparação. */
export interface InterviewGenRequest {
  job: InterviewJob;
  candidate: InterviewCandidate;
}

/** Turno do chat de simulação. */
export interface InterviewChatTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

/** Pedido de um turno da simulação interativa (chat). */
export interface InterviewChatRequest {
  job: InterviewJob;
  candidate: InterviewCandidate;
  /** Conversa até agora; vazio = início (IA faz a 1ª pergunta). */
  history: InterviewChatTurn[];
}

// ── Career Profile ─────────────────────────────────────────────────

export type WorkStyle = 'analytical' | 'creative' | 'operational' | 'relational';
export type TechLiteracy = 'basic' | 'intermediate' | 'advanced';
export type LeadershipLevel = 'low' | 'medium' | 'high';

export interface CareerProfile {
  techLiteracy: TechLiteracy;
  leadershipLevel: LeadershipLevel;
  workStyle: WorkStyle[];
  desiredAreas: string[];
  blockedAreas: string[];
  hiddenSkills: string[];
  careerGoals: string;
  transitionReady: boolean;
  transitionTarget: string | null;
  personalitySummary: string;
  potentialSummary: string;
}

export interface CareerChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Portfólio Público (Career Studio M8) ──────────────────────────
// Página pública /p/<github_username>, montada a partir do GitHub +
// biblioteca de projetos + LinkedIn. Aqui ficam só os controles curados.

/** Configurações editáveis pelo dono (área autenticada). */
export interface PortfolioSettings {
  published: boolean;
  headline: string | null;
  summary: string | null;
}

/** Projeto exposto no portfólio público (subset do Project). */
export interface PortfolioProject {
  title: string;
  description: string;
  tech: string[];
  category: string;
  link: string | null;
  repo: string | null;
}

// ── Job Pipeline CRM (MVC v4.0) ───────────────────────────────────
export type PipelineStatus =
  | 'salvas' | 'preparar' | 'aplicadas' | 'em_analise' | 'entrevista' | 'proposta' | 'contratado';

/** Metadados de uma candidatura no pipeline (por usuário+vaga). */
export interface PipelineEntry {
  id: string;
  user_id: string;
  job_id: string;
  status: PipelineStatus;
  favorite: boolean;
  notes: string;
  next_step: string | null;
  next_step_date: string | null;
  cv_id: string | null;
  moved_at: string;
  created_at: string;
  updated_at: string;
}

/** Campos editáveis no upsert de uma entrada do pipeline. */
export interface PipelineEntryInput {
  status?: PipelineStatus;
  favorite?: boolean;
  notes?: string;
  next_step?: string | null;
  next_step_date?: string | null;
  cv_id?: string | null;
}

/** Payload público da página /p/<username> (sem dados sensíveis). */
export interface PortfolioData {
  githubUsername: string;
  name: string;
  headline: string | null;
  summary: string | null;
  /** E-mail de contato (CTA); o dono opta por publicar. */
  contactEmail: string | null;
  projects: PortfolioProject[];
  positions: LinkedInPosition[];
  education: LinkedInEducation[];
}
