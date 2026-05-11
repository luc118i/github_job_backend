import { Router, Response } from 'express';
import { analyzeJobLink, CandidateProfile } from '../services/linkAnalyzer';
import { verifyLink } from '../services/linkVerifier';
import { supabase } from '../services/supabase';
import { optionalAuth, AuthRequest } from '../middleware/auth';
import { LinkedInData } from '../types';

const router = Router();

router.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  const {
    url,
    githubUsername,
    githubBio,
    skills,
    repos,
    linkedIn,
  } = req.body as {
    url: string;
    githubUsername?: string;
    githubBio?: string | null;
    skills?: string[];
    repos?: { name: string; description: string | null; topics: string[] }[];
    linkedIn?: LinkedInData | null;
  };

  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'URL invalida' });
    return;
  }

  try {
    const profile: CandidateProfile = { githubUsername, githubBio, skills, repos, linkedIn };
    const { job, match } = await analyzeJobLink(url, profile);

    const linkStatus = await verifyLink(url);

    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({ github_username: githubUsername ?? null, skills: job.skills, user_id: req.userId ?? null })
      .select()
      .single();

    if (searchError) throw new Error(searchError.message);

    const { data: savedJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        search_id: search.id,
        title: job.title,
        company: job.company,
        level: job.level,
        remote: job.remote,
        location: job.location ?? null,
        skills: job.skills,
        description: job.description,
        salary: job.salary,
        link: url,
        link_status: linkStatus === 'none' ? 'unverified' : linkStatus,
        seen: true,
      })
      .select()
      .single();

    if (jobError) throw new Error(jobError.message);

    res.json({
      job: savedJob,
      match,
      atsKeywords: job.atsKeywords,
      requirements: job.requirements,
      language: job.language,
    });
  } catch (err) {
    console.error('[analyze-link] erro:', err);
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('quota') || msg.includes('429')) {
      res.status(503).json({ error: 'Limite de IA atingido. Tente novamente em alguns minutos.' });
    } else {
      res.status(500).json({ error: msg || 'Erro ao analisar vaga. Tente novamente.' });
    }
  }
});

export default router;
