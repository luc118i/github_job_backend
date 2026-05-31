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

export interface CvResponse {
  cvId: string;
  content: string;
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
