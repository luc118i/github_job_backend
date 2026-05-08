import { JobSearchRequest } from '../types';

interface Rule {
  signals: string[];
  title: string;
  weight: number;
}

const RULES: Rule[] = [
  // Dados & IA
  { signals: ['machine-learning', 'deep-learning', 'tensorflow', 'pytorch', 'scikit-learn', 'llm', 'nlp', 'computer-vision'], title: 'Engenheiro de Machine Learning', weight: 10 },
  { signals: ['data-science', 'data-analysis', 'pandas', 'numpy', 'jupyter', 'statistics', 'analytics'], title: 'Cientista de Dados', weight: 9 },
  { signals: ['data-engineering', 'spark', 'airflow', 'dbt', 'kafka', 'etl', 'pipeline', 'data-pipeline'], title: 'Engenheiro de Dados', weight: 9 },
  { signals: ['bi', 'tableau', 'power-bi', 'looker', 'metabase', 'data-visualization'], title: 'Analista de BI', weight: 8 },

  // DevOps & Cloud
  { signals: ['devops', 'ci-cd', 'github-actions', 'jenkins', 'terraform', 'ansible', 'sre'], title: 'Engenheiro DevOps', weight: 10 },
  { signals: ['kubernetes', 'docker', 'helm', 'container'], title: 'Engenheiro de Infraestrutura', weight: 8 },
  { signals: ['aws', 'azure', 'gcp', 'cloud', 'serverless'], title: 'Engenheiro Cloud', weight: 8 },

  // Mobile
  { signals: ['android', 'kotlin', 'jetpack'], title: 'Desenvolvedor Android', weight: 10 },
  { signals: ['ios', 'swift', 'swiftui', 'xcode'], title: 'Desenvolvedor iOS', weight: 10 },
  { signals: ['react-native', 'flutter', 'mobile'], title: 'Desenvolvedor Mobile', weight: 9 },

  // Frontend
  { signals: ['react', 'nextjs', 'next.js'], title: 'Desenvolvedor React', weight: 9 },
  { signals: ['vue', 'vuejs', 'nuxt'], title: 'Desenvolvedor Vue.js', weight: 9 },
  { signals: ['angular'], title: 'Desenvolvedor Angular', weight: 9 },
  { signals: ['frontend', 'html', 'css', 'ux', 'ui'], title: 'Desenvolvedor Frontend', weight: 7 },

  // Backend por linguagem
  { signals: ['node', 'nodejs', 'express', 'nestjs', 'fastify'], title: 'Desenvolvedor Node.js', weight: 9 },
  { signals: ['django', 'fastapi', 'flask'], title: 'Desenvolvedor Python Backend', weight: 9 },
  { signals: ['spring', 'java', 'quarkus'], title: 'Desenvolvedor Java', weight: 9 },
  { signals: ['dotnet', '.net', 'csharp', 'c#', 'asp.net'], title: 'Desenvolvedor .NET', weight: 9 },
  { signals: ['rails', 'ruby'], title: 'Desenvolvedor Ruby on Rails', weight: 9 },
  { signals: ['golang', 'go'], title: 'Desenvolvedor Go', weight: 9 },
  { signals: ['rust'], title: 'Desenvolvedor Rust', weight: 9 },
  { signals: ['php', 'laravel', 'symfony'], title: 'Desenvolvedor PHP', weight: 9 },

  // Sistemas & Embarcado
  { signals: ['kernel', 'operating-system', 'linux-kernel', 'embedded', 'firmware'], title: 'Engenheiro de Sistemas', weight: 10 },
  { signals: ['arduino', 'raspberry-pi', 'iot', 'rtos'], title: 'Desenvolvedor Embarcado', weight: 9 },
  { signals: ['c', 'cpp', 'c++', 'assembly'], title: 'Desenvolvedor C/C++', weight: 7 },

  // Segurança
  { signals: ['security', 'cybersecurity', 'pentest', 'infosec', 'ctf', 'cryptography'], title: 'Analista de Segurança', weight: 10 },

  // Web3 / Blockchain
  { signals: ['blockchain', 'web3', 'solidity', 'ethereum', 'smart-contract'], title: 'Desenvolvedor Blockchain', weight: 10 },

  // Games
  { signals: ['game', 'unity', 'unreal', 'gamedev', 'game-development'], title: 'Desenvolvedor de Games', weight: 10 },

  // Backend genérico (baixo peso, só entra se nada mais casou)
  { signals: ['api', 'rest', 'graphql', 'microservices', 'backend'], title: 'Desenvolvedor Backend', weight: 5 },
  { signals: ['fullstack', 'full-stack', 'monorepo'], title: 'Desenvolvedor Full Stack', weight: 5 },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_]/g, '-');
}

export function buildSearchQueries(profile: JobSearchRequest): string[] {
  const signals = new Set<string>();

  for (const skill of profile.skills) signals.add(normalize(skill));
  for (const repo of profile.repoContext ?? []) {
    for (const topic of repo.topics) signals.add(normalize(topic));
    if (repo.description) {
      repo.description.toLowerCase().split(/\W+/).forEach((w) => w.length > 3 && signals.add(w));
    }
  }
  if (profile.bio) {
    profile.bio.toLowerCase().split(/\W+/).forEach((w) => w.length > 3 && signals.add(w));
  }

  const scored: { title: string; score: number }[] = [];
  for (const rule of RULES) {
    const hits = rule.signals.filter((s) => signals.has(s)).length;
    if (hits > 0) scored.push({ title: rule.title, score: hits * rule.weight });
  }

  scored.sort((a, b) => b.score - a.score);

  const queries = scored.slice(0, 4).map((r) => r.title);

  if (queries.length === 0) {
    const topSkill = profile.skills[0];
    return topSkill ? [`Desenvolvedor ${topSkill}`] : ['Desenvolvedor de Software'];
  }

  // Se temos frontend E backend separados, adiciona Full Stack como query combinada
  const hasFront = queries.some((q) => q.toLowerCase().includes('frontend') || q.toLowerCase().includes('react') || q.toLowerCase().includes('vue') || q.toLowerCase().includes('angular'));
  const hasBack = queries.some((q) => q.toLowerCase().includes('backend') || q.toLowerCase().includes('node') || q.toLowerCase().includes('python') || q.toLowerCase().includes('java'));
  if (hasFront && hasBack && !queries.includes('Desenvolvedor Full Stack')) {
    queries.push('Desenvolvedor Full Stack');
  }

  return [...new Set(queries)].slice(0, 5);
}
