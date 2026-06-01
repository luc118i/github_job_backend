import { Router, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ProjectInput, ProjectCategory } from '../types';

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
