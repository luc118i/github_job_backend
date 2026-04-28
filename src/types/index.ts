export type LinkStatus = 'trusted' | 'unverified' | 'dead' | 'none';

export interface Job {
  title: string;
  company: string;
  level: 'Junior' | 'Pleno' | 'Senior';
  remote: boolean;
  skills: string[];
  description: string;
  salary: string | null;
  link: string | null;
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

export interface JobSearchRequest {
  username: string;
  name: string;
  bio: string | null;
  skills: string[];
  topRepos: string[];
  followers: number;
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

export interface LinkedInData {
  positions: LinkedInPosition[];
  education: LinkedInEducation[];
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
