import { Router, Response } from 'express';
import { db, insertRows } from '../services/db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ProjectInput, ProjectCategory, ProjectMatchJob } from '../types';
import { matchProjects, MatchProject } from '../services/projectMatcher';
import { fetchRepoReadme, parseGithubUrl } from '../services/githubReadme';
import { enrichProject } from '../services/projectEnricher';

const router = Router();

// Todas as rotas exigem login — a biblioteca é por usuário.
router.use(requireAuth);

const VALID_CATEGORIES = new Set<ProjectCategory>([
  'frontend', 'backend', 'fullstack', 'data', 'mobile', 'outro',
]);

function normalizeCategory(v: unknown): ProjectCategory {
  const c = String(v ?? '').trim().toLowerCase();
  return VALID_CATEGORIES.has(c as ProjectCategory) ? (c as ProjectCategory) : 'outro';
}

// Normaliza o corpo recebido para um payload seguro de insert/update.
// Arrays viram sempre string[]; strings em branco viram null onde faz sentido.
function sanitize(body: ProjectInput) {
  const toStrArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

  return {
    title: typeof body.title === 'string' ? body.title.trim() : '',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    tech: toStrArray(body.tech),
    highlights: toStrArray(body.highlights),
    category: normalizeCategory(body.category),
    link: body.link ? String(body.link).trim() : null,
    repo: body.repo ? String(body.repo).trim() : null,
  };
}

// GET /projects — lista os projetos do usuário (mais recentes primeiro).
const PROJECT_SELECT = 'id, user_id, title, description, tech, highlights, category, link, repo, competencies, portfolio_score, created_at, updated_at';

router.get('/', async (req: AuthRequest, res: Response) => {
  const { data, error } = await db(
    `SELECT ${PROJECT_SELECT} FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId!],
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

// POST /projects — cria um projeto na biblioteca.
router.post('/', async (req: AuthRequest, res: Response) => {
  const payload = sanitize(req.body as ProjectInput);
  if (!payload.title) {
    res.status(400).json({ error: 'O título do projeto é obrigatório.' });
    return;
  }

  const { data: rows, error } = await db(
    `INSERT INTO projects (title, description, tech, highlights, category, link, repo, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${PROJECT_SELECT}`,
    [payload.title, payload.description, JSON.stringify(payload.tech), JSON.stringify(payload.highlights), payload.category, payload.link, payload.repo, req.userId!],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

// PATCH /projects/:id — edita um projeto (só do próprio usuário).
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const payload = sanitize(req.body as ProjectInput);
  if (!payload.title) {
    res.status(400).json({ error: 'O título do projeto é obrigatório.' });
    return;
  }

  const { data: rows, error } = await db(
    `UPDATE projects
        SET title = $1, description = $2, tech = $3, highlights = $4, category = $5, link = $6, repo = $7, updated_at = now()
      WHERE id = $8 AND user_id = $9
      RETURNING ${PROJECT_SELECT}`,
    [payload.title, payload.description, JSON.stringify(payload.tech), JSON.stringify(payload.highlights), payload.category, payload.link, payload.repo, req.params.id, req.userId!],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Projeto não encontrado.' });
    return;
  }
  res.json(data);
});

// POST /projects/import — importa vários projetos do GitHub de uma vez.
// Deduplica pelo nome do repo (não recria o que já existe na biblioteca).
router.post('/import', async (req: AuthRequest, res: Response) => {
  const { projects } = req.body as { projects?: ProjectInput[] };
  if (!Array.isArray(projects) || projects.length === 0) {
    res.status(400).json({ error: 'Envie os projetos a importar.' });
    return;
  }

  // Repos já presentes na biblioteca do usuário (evita duplicar).
  const { data: existing, error: exErr } = await db<{ repo: string }>(
    'SELECT repo FROM projects WHERE user_id = $1 AND repo IS NOT NULL',
    [req.userId!],
  );

  if (exErr) {
    res.status(500).json({ error: exErr.message });
    return;
  }
  const have = new Set((existing ?? []).map((r) => (r.repo as string).toLowerCase()));

  const rows = projects
    .map(sanitize)
    .filter((p) => p.title && p.repo && !have.has(p.repo.toLowerCase()))
    .map((p) => ({ ...p, user_id: req.userId! }));

  if (rows.length === 0) {
    res.json([]); // nada novo a importar
    return;
  }

  const { data, error } = await insertRows('projects', rows);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data ?? []);
});

// POST /projects/match-ai — ranqueia os projetos do usuário para uma vaga
// usando IA (lê o README de cada repo). README é cacheado no banco: só
// buscamos no GitHub os que ainda não têm. Custo: 1 chamada de IA p/ todos.
router.post('/match-ai', async (req: AuthRequest, res: Response) => {
  const { job } = req.body as { job?: ProjectMatchJob };
  if (!job || typeof job.title !== 'string' || !job.title.trim()) {
    res.status(400).json({ error: 'Informe a vaga (job.title) para o match.' });
    return;
  }

  // Projetos do usuário (inclui readme cacheado + link p/ buscar o que falta).
  const { data: projects, error } = await db(
    'SELECT id, title, description, tech, link, repo, readme FROM projects WHERE user_id = $1',
    [req.userId!],
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!projects || projects.length === 0) {
    res.json([]); // biblioteca vazia — nada a ranquear
    return;
  }

  // Completa o README dos que ainda não têm cache (best-effort, em paralelo).
  await Promise.all(
    projects.map(async (p) => {
      if (p.readme != null) return; // já cacheado (string vazia inclusive)
      const gh = parseGithubUrl(p.link as string | null);
      if (!gh) return;
      const readme = await fetchRepoReadme(gh.owner, gh.repo);
      p.readme = readme ?? '';
      // Persiste o cache (não bloqueia a resposta se falhar).
      await db('UPDATE projects SET readme = $1 WHERE id = $2 AND user_id = $3', [p.readme, p.id, req.userId!]);
    }),
  );

  const matchInput: MatchProject[] = projects.map((p) => ({
    id: p.id as string,
    title: (p.title as string) ?? '',
    description: (p.description as string) ?? '',
    tech: Array.isArray(p.tech) ? (p.tech as string[]) : [],
    readme: (p.readme as string | null) ?? null,
  }));

  try {
    const matches = await matchProjects(
      { title: job.title, skills: Array.isArray(job.skills) ? job.skills : [], description: job.description ?? '' },
      matchInput,
    );
    res.json(matches);
  } catch (e) {
    const msg = (e as Error).message ?? 'Falha no match por IA.';
    console.error('[projects/match-ai]', msg);
    res.status(503).json({ error: 'O serviço de IA está indisponível agora. Tente novamente em instantes.' });
  }
});

// Enriquece uma linha de projeto: garante README, gera competências (IA) e
// calcula o Portfolio Score; persiste e devolve o projeto atualizado.
const ENRICH_SELECT = 'id, user_id, title, description, tech, highlights, category, link, repo, competencies, portfolio_score, created_at, updated_at';
async function enrichRow(userId: string, row: Record<string, unknown>) {
  let readme = (row.readme as string | null) ?? null;
  if (readme == null) {
    const gh = parseGithubUrl(row.link as string | null);
    if (gh) readme = await fetchRepoReadme(gh.owner, gh.repo);
  }
  const { competencies, score } = await enrichProject({
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? '',
    tech: Array.isArray(row.tech) ? (row.tech as string[]) : [],
    readme: readme ?? '',
  });
  const { data: rows } = await db(
    `UPDATE projects SET competencies = $1, portfolio_score = $2, readme = $3, updated_at = now()
      WHERE id = $4 AND user_id = $5
      RETURNING ${ENRICH_SELECT}`,
    [JSON.stringify(competencies), score, readme ?? '', row.id as string, userId],
  );
  return rows[0];
}

// POST /projects/:id/enrich — analisa 1 projeto com IA (competências + score).
router.post('/:id/enrich', async (req: AuthRequest, res: Response) => {
  const { data: rows, error } = await db(
    'SELECT id, title, description, tech, link, repo, readme FROM projects WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId!],
  );
  const row = rows[0];
  if (error || !row) {
    res.status(404).json({ error: 'Projeto não encontrado.' });
    return;
  }
  try {
    res.json(await enrichRow(req.userId!, row));
  } catch (e) {
    console.error('[projects/enrich]', e);
    res.status(503).json({ error: 'A IA está indisponível agora. Tente novamente em instantes.' });
  }
});

// POST /projects/enrich-all — analisa todos os projetos ainda sem score.
router.post('/enrich-all', async (req: AuthRequest, res: Response) => {
  const { data: rows, error } = await db(
    'SELECT id, title, description, tech, link, repo, readme, portfolio_score FROM projects WHERE user_id = $1 AND portfolio_score IS NULL',
    [req.userId!],
  );
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const pending = (rows ?? []).slice(0, 20); // limita p/ não estourar custo/tempo
  const updated = [];
  for (const row of pending) {
    try { updated.push(await enrichRow(req.userId!, row)); }
    catch (e) { console.warn('[projects/enrich-all] falha em', row.id, (e as Error).message); }
  }
  res.json(updated);
});

// DELETE /projects/:id — remove um projeto (só do próprio usuário).
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { error } = await db('DELETE FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.userId!]);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
