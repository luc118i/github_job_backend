import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*, searches(github_username)')
    .or('dismissed.eq.false,dismissed.is.null')
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
    return;
  }

  const seen = new Set<string>();
  const feed = (jobs ?? [])
    .map(({ searches: search, ...job }) => ({
      ...job,
      github_username: (search as { github_username: string | null } | null)?.github_username ?? null,
    }))
    .filter((job) => {
      const key = `${job.title.toLowerCase().trim()}::${job.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  res.json({ jobs: feed });
});

export default router;
