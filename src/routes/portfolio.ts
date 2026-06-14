import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { PortfolioData, PortfolioProject, PortfolioRecruiter, PortfolioTemplate, LinkedInData, CareerProfile, UserPreferences } from '../types';

const router = Router();

const VALID_TEMPLATES = new Set<PortfolioTemplate>(['executivo', 'especialista', 'criativo', 'tech']);
function normalizeTemplate(v: unknown): PortfolioTemplate {
  const t = String(v ?? '').trim().toLowerCase();
  return VALID_TEMPLATES.has(t as PortfolioTemplate) ? (t as PortfolioTemplate) : 'especialista';
}

const MODALITY_LABEL: Record<string, string> = {
  remote: 'Aceita remoto', presencial: 'Presencial', hybrid: 'Híbrido',
};

// Monta o resumo do recrutador a partir de preferências + perfil de carreira.
function buildRecruiter(prefs: UserPreferences | null, career: CareerProfile | null): PortfolioRecruiter {
  const level = prefs?.level && prefs.level !== 'any' ? prefs.level : null;
  const area = career?.desiredAreas?.[0] ?? career?.transitionTarget ?? null;
  const location = prefs?.location?.trim() || null;
  const remote = prefs?.modality && prefs.modality !== 'any' ? (MODALITY_LABEL[prefs.modality] ?? null) : null;
  const min = prefs?.salaryMin?.trim();
  const max = prefs?.salaryMax?.trim();
  const salary = min || max ? `${min ? `R$ ${min}` : ''}${min && max ? ' - ' : ''}${max ? `R$ ${max}` : ''}`.trim() : null;
  return { level, area, location, remote, salary };
}

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
    .select('id, name, email, github_username, linkedin_data, preferences, career_profile, portfolio_published, portfolio_headline, portfolio_summary, portfolio_template')
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
    .select('title, description, tech, competencies, highlights, category, link, repo, portfolio_score')
    .eq('user_id', user.id)
    .order('portfolio_score', { ascending: false, nullsFirst: false });

  const portfolioProjects: PortfolioProject[] = (projects ?? []).map((p) => ({
    title: (p.title as string) ?? '',
    description: (p.description as string) ?? '',
    tech: Array.isArray(p.tech) ? (p.tech as string[]) : [],
    competencies: Array.isArray(p.competencies) ? (p.competencies as string[]) : [],
    highlights: Array.isArray(p.highlights) ? (p.highlights as string[]) : [],
    category: (p.category as string) ?? 'outro',
    link: (p.link as string | null) ?? null,
    repo: (p.repo as string | null) ?? null,
  }));

  // Competências agregadas (dedup, preservando ordem por relevância).
  const seen = new Set<string>();
  const competencies: string[] = [];
  for (const p of portfolioProjects) {
    for (const c of p.competencies) {
      const k = c.toLowerCase();
      if (!seen.has(k)) { seen.add(k); competencies.push(c); }
    }
  }

  const li = (user.linkedin_data as LinkedInData | null) ?? null;

  const payload: PortfolioData = {
    githubUsername: (user.github_username as string) ?? username,
    name: (user.name as string) ?? (user.github_username as string) ?? username,
    headline: (user.portfolio_headline as string | null) ?? null,
    summary: (user.portfolio_summary as string | null) ?? null,
    template: normalizeTemplate(user.portfolio_template),
    contactEmail: (user.email as string | null) ?? null,
    projects: portfolioProjects,
    positions: li?.positions ?? [],
    education: li?.education ?? [],
    competencies: competencies.slice(0, 16),
    certifications: li?.certifications ?? [],
    recruiter: buildRecruiter(
      (user.preferences as UserPreferences | null) ?? null,
      (user.career_profile as CareerProfile | null) ?? null,
    ),
  };

  res.json(payload);
});

// ── Configurações (área autenticada) ──────────────────────────────
// GET /portfolio/settings — estado atual de publicação + textos curados.
router.get('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('portfolio_published, portfolio_headline, portfolio_summary, portfolio_template')
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
    template: normalizeTemplate(user.portfolio_template),
  });
});

// PATCH /portfolio/settings — liga/desliga e edita headline/resumo/template.
router.patch('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
  const { published, headline, summary, template } = req.body as {
    published?: boolean; headline?: string | null; summary?: string | null; template?: string;
  };

  const patch: Record<string, unknown> = {};
  if (typeof published === 'boolean') patch.portfolio_published = published;
  if (headline !== undefined) patch.portfolio_headline = headline ? String(headline).trim() : null;
  if (summary !== undefined) patch.portfolio_summary = summary ? String(summary).trim() : null;
  if (template !== undefined) patch.portfolio_template = normalizeTemplate(template);

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    return;
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.userId!)
    .select('portfolio_published, portfolio_headline, portfolio_summary, portfolio_template')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    published: Boolean(data.portfolio_published),
    headline: (data.portfolio_headline as string | null) ?? null,
    summary: (data.portfolio_summary as string | null) ?? null,
    template: normalizeTemplate(data.portfolio_template),
  });
});

export default router;
