import { Router, Request, Response } from 'express';
import { findJobs } from '../services/claude';
import { supabase } from '../services/supabase';
import { verifyLink } from '../services/linkVerifier';
import { JobSearchRequest } from '../types';
import { optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  const profile = req.body as JobSearchRequest;

  if (!profile.username) {
    res.status(400).json({ error: 'Perfil inválido' });
    return;
  }

  try {
    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({
        github_username: profile.username,
        skills: profile.skills,
        user_id: req.userId ?? null,
      })
      .select()
      .single();

    if (searchError) {
      console.error('Supabase insert error:', JSON.stringify(searchError));
      throw new Error(searchError.message || searchError.code || 'Supabase insert failed');
    }

    const rawJobs = await findJobs(profile);

    const verifiedJobs = await Promise.all(
      rawJobs.map(async (job) => ({
        search_id: search.id,
        title: job.title,
        company: job.company,
        level: job.level,
        remote: job.remote,
        location: job.location ?? null,
        skills: job.skills,
        description: job.description,
        salary: job.salary,
        link: job.link || null,
        link_status: await verifyLink(job.link || null),
        seen: false,
      }))
    );

    const { data: savedJobs, error: jobsError } = await supabase
      .from('jobs')
      .insert(verifiedJobs)
      .select();

    if (jobsError) throw new Error(jobsError.message);

    res.json({ jobs: savedJobs ?? [], searchId: search.id });
  } catch (err) {
    console.error('Error finding jobs:', err);
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

router.patch('/:id/seen', async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('jobs')
    .update({ seen: true })
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ error: 'Erro ao marcar vaga' });
    return;
  }

  res.json({ ok: true });
});

router.patch('/:id/dismiss', async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('jobs')
    .update({ dismissed: true })
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ error: 'Erro ao descartar vaga' });
    return;
  }

  res.json({ ok: true });
});

export default router;
