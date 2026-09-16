import { Router, Response } from 'express';
import { db } from '../services/db';
import { requireAuth, optionalAuth, AuthRequest } from '../middleware/auth';
import { verifyLink, resolveJobLink } from '../services/linkVerifier';

const router = Router();

// Última busca por texto do usuário — alimenta o "Descobrir Vagas", que
// reaproveita o termo digitado anteriormente em vez de exigir CV.
router.get('/last-query', optionalAuth, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    res.json({ query: null, skills: [] });
    return;
  }

  const { data: rows, error } = await db(
    `SELECT query, skills FROM searches
      WHERE user_id = $1 AND query IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [req.userId],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: 'Erro ao carregar a última busca.' });
    return;
  }

  res.json({ query: data?.query ?? null, skills: data?.skills ?? [] });
});

router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  // scope=recent (usado no "organizar"): traz só a ÚLTIMA busca; se ela não
  // tiver vagas, cai para as buscas do último mês. Sem o param: histórico completo.
  const recent = req.query.scope === 'recent';

  // Step 1 — buscas do usuário (id + data, mais recentes primeiro)
  const { data: userSearches, error: searchesError } = await db(
    'SELECT id, created_at FROM searches WHERE user_id = $1 ORDER BY created_at DESC',
    [req.userId!],
  );

  if (searchesError) {
    res.status(500).json({ error: 'Erro ao carregar histórico de buscas.' });
    return;
  }

  const allSearches = (userSearches ?? []) as { id: string; created_at: string }[];
  if (allSearches.length === 0) {
    res.json({ jobs: [] });
    return;
  }

  // Helper: busca jobs (não descartados) para um conjunto de search IDs.
  const queryJobs = async (ids: string[]) =>
    db(
      `SELECT jobs.*, searches.github_username AS search_github_username
         FROM jobs
         JOIN searches ON searches.id = jobs.search_id
        WHERE jobs.search_id = ANY($1::uuid[])
          AND (jobs.dismissed = false OR jobs.dismissed IS NULL)
        ORDER BY jobs.created_at DESC
        LIMIT 300`,
      [ids],
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jobs: any[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any = null;

  if (recent) {
    // 1ª tentativa: só a última busca.
    ({ data: jobs, error } = await queryJobs([allSearches[0].id]));
    // Fallback: nenhuma vaga na última busca → buscas dos últimos 30 dias.
    if (!error && (!jobs || jobs.length === 0)) {
      const cutoff = Date.now() - 30 * 86400000;
      const monthIds = allSearches.filter((s) => new Date(s.created_at).getTime() >= cutoff).map((s) => s.id);
      if (monthIds.length > 0) ({ data: jobs, error } = await queryJobs(monthIds));
    }
  } else {
    ({ data: jobs, error } = await queryJobs(allSearches.map((s) => s.id)));
  }

  if (error) {
    res.status(500).json({ error: 'Erro ao carregar o histórico de buscas. Tente novamente.' });
    return;
  }

  const seen = new Set<string>();
  const rawFeed = (jobs ?? [])
    .map(({ search_github_username, ...job }) => ({
      ...job,
      github_username: (search_github_username as string | null) ?? null,
    }))
    .filter((job) => {
      const key = `${job.title.toLowerCase().trim()}::${job.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Re-verifica links do histórico em paralelo — substitui mortos por busca no Indeed
  const feed = await Promise.all(
    rawFeed.map(async (job) => {
      const status = await verifyLink(job.link ?? null);
      if (status === 'dead' || status === 'none') {
        return {
          ...job,
          link: resolveJobLink(null, job.title ?? '', job.company ?? ''),
          link_status: 'unverified',
        };
      }
      return job;
    })
  );

  res.json({ jobs: feed });
});

export default router;
