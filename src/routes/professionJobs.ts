import { Router, Request, Response } from 'express';
import { findProfessionJobs } from '../services/genericJobFinder';
import { verifyLink } from '../services/linkVerifier';
import { supabase } from '../services/supabase';
import { LinkedInData, UserPreferences } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { linkedIn, preferences } = req.body as { linkedIn: LinkedInData; preferences?: UserPreferences };

  if (!linkedIn?.positions?.length && !linkedIn?.education?.length) {
    res.status(400).json({ error: 'Perfil LinkedIn necessário' });
    return;
  }

  try {
    const result = await findProfessionJobs(linkedIn.positions, linkedIn.education, preferences);

    const rawJobs = Array.isArray(result.jobs) ? result.jobs : [];

    const verifiedJobs = await Promise.all(
      rawJobs.map(async (job) => ({
        title: job.title ?? '',
        company: job.company ?? '',
        level: (['Junior', 'Pleno', 'Senior'].includes(job.level) ? job.level : 'Pleno') as 'Junior' | 'Pleno' | 'Senior',
        remote: job.remote ?? false,
        location: (job as { location?: string | null }).location ?? null,
        skills: Array.isArray(job.tags) ? job.tags : [],
        description: job.description ?? '',
        salary: job.salary ?? null,
        link: job.link ?? null,
        match: typeof job.match === 'number' ? job.match : 0,
        link_status: await verifyLink(job.link ?? null),
      }))
    );

    const skills = [...new Set(verifiedJobs.flatMap((j) => j.skills))].slice(0, 10);

    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({ github_username: null, skills })
      .select()
      .single();

    if (searchError) throw new Error(searchError.message);

    const { data: savedJobs, error: jobsError } = await supabase
      .from('jobs')
      .insert(verifiedJobs.map(({ match: _match, ...j }) => ({ ...j, search_id: search.id, seen: false })))
      .select();

    if (jobsError) throw new Error(jobsError.message);

    // Re-attach match scores for the live response (not stored in DB)
    const jobs = (savedJobs ?? []).map((saved, i) => ({
      ...saved,
      match: verifiedJobs[i].match,
    }));

    res.json({ jobs, profileSummary: result.profileSummary });
  } catch (err) {
    console.error('Error finding profession jobs:', err);
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('quota') || msg.includes('too many requests') || msg.includes('429')) {
      res.status(503).json({ error: 'Limite de requisições atingido nos dois serviços de IA. Tente novamente em alguns minutos.' });
    } else if (msg.includes('credit') || msg.includes('balance') || msg.includes('billing')) {
      res.status(503).json({ error: 'Serviço de IA temporariamente indisponível. Tente novamente mais tarde.' });
    } else if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('high demand')) {
      res.status(503).json({ error: 'Serviços de IA sobrecarregados. Tente novamente em instantes.' });
    } else {
      res.status(500).json({ error: 'Erro ao buscar vagas. Tente novamente.' });
    }
  }
});

export default router;
