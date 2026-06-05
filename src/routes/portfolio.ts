import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { PortfolioData, PortfolioProject, LinkedInData } from '../types';

const router = Router();

// ── Página pública (sem auth) ─────────────────────────────────────
// GET /portfolio/public/:username — dados públicos do portfólio, se publicado.
// Montado a partir do users + biblioteca de projetos + LinkedIn salvos.
router.get('/public/:username', async (req: Request, res: Response) => {
  const username = String(req.params.username ?? '').trim();
  if (!username) {
    res.status(400).json({ error: 'username é obrigatório.' });
    return;
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, github_username, linkedin_data, portfolio_published, portfolio_headline, portfolio_summary')
    .ilike('github_username', username) // case-insensitive
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  // 404 genérico tanto p/ inexistente quanto p/ não publicado (não vaza existência).
  if (!user || !user.portfolio_published) {
    res.status(404).json({ error: 'Portfólio não encontrado ou não publicado.' });
    return;
  }

  // Projetos da biblioteca do usuário (todos os curados são públicos).
  const { data: projects } = await supabase
    .from('projects')
    .select('title, description, tech, highlights, category, link, repo')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const portfolioProjects: PortfolioProject[] = (projects ?? []).map((p) => ({
    title: (p.title as string) ?? '',
    description: (p.description as string) ?? '',
    tech: Array.isArray(p.tech) ? (p.tech as string[]) : [],
    category: (p.category as string) ?? 'outro',
    link: (p.link as string | null) ?? null,
    repo: (p.repo as string | null) ?? null,
  }));

  const li = (user.linkedin_data as LinkedInData | null) ?? null;

  const payload: PortfolioData = {
    githubUsername: (user.github_username as string) ?? username,
    name: (user.name as string) ?? (user.github_username as string) ?? username,
    headline: (user.portfolio_headline as string | null) ?? null,
    summary: (user.portfolio_summary as string | null) ?? null,
    contactEmail: (user.email as string | null) ?? null,
    projects: portfolioProjects,
    positions: li?.positions ?? [],
    education: li?.education ?? [],
  };

  res.json(payload);
});

// ── Configurações (área autenticada) ──────────────────────────────
// GET /portfolio/settings — estado atual de publicação + textos curados.
router.get('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('portfolio_published, portfolio_headline, portfolio_summary')
    .eq('id', req.userId!)
    .maybeSingle();

  if (error || !user) {
    res.status(500).json({ error: error?.message ?? 'Usuário não encontrado.' });
    return;
  }
  res.json({
    published: Boolean(user.portfolio_published),
    headline: (user.portfolio_headline as string | null) ?? null,
    summary: (user.portfolio_summary as string | null) ?? null,
  });
});

// PATCH /portfolio/settings — liga/desliga e edita headline/resumo.
router.patch('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
  const { published, headline, summary } = req.body as {
    published?: boolean; headline?: string | null; summary?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (typeof published === 'boolean') patch.portfolio_published = published;
  if (headline !== undefined) patch.portfolio_headline = headline ? String(headline).trim() : null;
  if (summary !== undefined) patch.portfolio_summary = summary ? String(summary).trim() : null;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    return;
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.userId!)
    .select('portfolio_published, portfolio_headline, portfolio_summary')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    published: Boolean(data.portfolio_published),
    headline: (data.portfolio_headline as string | null) ?? null,
    summary: (data.portfolio_summary as string | null) ?? null,
  });
});

export default router;
