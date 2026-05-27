import { Router, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  // Step 1 — get all search IDs belonging to this user
  const { data: userSearches, error: searchesError } = await supabase
    .from('searches')
    .select('id')
    .eq('user_id', req.userId!);

  if (searchesError) {
    res.status(500).json({ error: 'Erro ao carregar histórico de buscas.' });
    return;
  }

  const searchIds = (userSearches ?? []).map((s: { id: string }) => s.id);

  if (searchIds.length === 0) {
    res.json({ jobs: [] });
    return;
  }

  // Step 2 — get jobs for those searches
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*, searches(github_username)')
    .in('search_id', searchIds)
    .or('dismissed.eq.false,dismissed.is.null')
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    res.status(500).json({ error: 'Erro ao carregar o histórico de buscas. Tente novamente.' });
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
