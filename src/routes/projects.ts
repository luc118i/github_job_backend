import { Router, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ProjectInput, ProjectCategory, ProjectMatchJob } from '../types';
import { matchProjects, MatchProject } from '../services/projectMatcher';
import { fetchRepoReadme, parseGithubUrl } from '../services/githubReadme';

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
router.get('/', async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, user_id, title, description, tech, highlights, category, link, repo, created_at, updated_at')
    .eq('user_id', req.userId!)
    .order('created_at', { ascending: false });

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

  const { data, error } = await supabase
    .from('projects')
    .insert({ ...payload, user_id: req.userId! })
    .select('id, user_id, title, description, tech, highlights, category, link, repo, created_at, updated_at')
    .single();

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

  const { data, error } = await supabase
    .from('projects')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.userId!)
    .select('id, user_id, title, description, tech, highlights, category, link, repo, created_at, updated_at')
    .maybeSingle();

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
  const { data: existing, error: exErr } = await supabase
    .from('projects')
    .select('repo')
    .eq('user_id', req.userId!)
    .not('repo', 'is', null);

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

  const { data, error } = await supabase
    .from('projects')
    .insert(rows)
    .select('id, user_id, title, description, tech, highlights, category, link, repo, created_at, updated_at');

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
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, description, tech, link, repo, readme')
    .eq('user_id', req.userId!);

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
      await supabase.from('projects').update({ readme: p.readme }).eq('id', p.id).eq('user_id', req.userId!);
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

// DELETE /projects/:id — remove um projeto (só do próprio usuário).
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId!);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
