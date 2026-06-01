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
  link: string | null;
  /** Repositório GitHub de origem, quando importado. */
  repo: string | null;
  created_at: string;
  updated_at: string;
}

// Payload aceito ao criar/editar um projeto (sem campos do servidor).
export interface ProjectInput {
  title: string;
  description?: string;
  tech?: string[];
  highlights?: string[];
  link?: string | null;
  repo?: string | null;
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
