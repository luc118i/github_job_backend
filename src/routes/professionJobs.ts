import { Router, Response } from 'express';
import { findProfessionJobs, findJobsByQuery } from '../services/genericJobFinder';
import { verifyLink, resolveJobLink } from '../services/linkVerifier';
import { supabase } from '../services/supabase';
import { CareerProfile, LinkedInData, UserPreferences } from '../types';
import { optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

/** Strips fields that aren't yet in the DB schema before inserting.
 *  `published_at` is kept in-memory and returned in the API response
 *  but the column needs to be added via migration before persisting it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInsertRow(vj: Record<string, unknown>, searchId: string): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { match: _match, published_at: _pa, ...rest } = vj;
  return { ...rest, search_id: searchId, seen: false };
}

router.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  const { linkedIn, preferences, blockedKeywords, blockedSources, likedSources, careerProfile, query, githubUsername } = req.body as {
    linkedIn?: LinkedInData;
    preferences?: UserPreferences;
    blockedKeywords?: string[];
    blockedSources?: string[];
    likedSources?: string[];
    careerProfile?: CareerProfile;
    query?: string;
    githubUsername?: string | null;
  };

  // Certifications do LinkedIn — usadas para filtrar estágios quando usuário tem OAB
  const certifications = linkedIn?.certifications ?? [];

  // ── Route A: text-query search (no LinkedIn required) ──
  if (query) {
    try {
      const result = await findJobsByQuery(query, preferences, blockedKeywords, blockedSources, likedSources, careerProfile, githubUsername, certifications, linkedIn);

      const rawJobs    = Array.isArray(result.jobs)      ? result.jobs      : [];
      const rawBonus   = Array.isArray(result.bonusJobs) ? result.bonusJobs : [];

      // Prepara bonusJobs (sem salvar no DB — são suplementares)
      const prepareBonus = (jobs: typeof rawBonus) =>
        jobs.map((job) => {
          const link = job.link || resolveJobLink(null, job.title ?? '', job.company ?? '');
          return {
            id: `bonus-${Math.random().toString(36).slice(2)}`,
            title:       job.title ?? '',
            company:     job.company ?? '',
            level:       (['Junior', 'Pleno', 'Senior'].includes(job.level) ? job.level : 'Pleno') as 'Junior' | 'Pleno' | 'Senior',
            remote:      job.remote ?? false,
            location:    (job as { location?: string | null }).location ?? null,
            skills:      Array.isArray(job.tags) ? job.tags : [],
            description: job.description ?? '',
            salary:      job.salary ?? null,
            link,
            match:       typeof job.match === 'number' ? job.match : 0,
            link_status: 'unverified' as const,
            seen:        false,
          };
        });

      // No main jobs — return only bonus (skip DB)
      if (!rawJobs.length) {
        res.json({ jobs: [], bonusJobs: prepareBonus(rawBonus), profileSummary: result.profileSummary ?? '' });
        return;
      }

      const verifiedJobs = await Promise.all(
        rawJobs.map(async (job) => {
          const title   = job.title ?? '';
          const company = job.company ?? '';
          let link      = job.link || null;
          let linkStatus = await verifyLink(link);

          // Vaga expirada ou link inválido → substitui por busca no Indeed
          if (linkStatus === 'dead' || linkStatus === 'none') {
            link = resolveJobLink(null, title, company);
            linkStatus = 'unverified';
          }

          return {
            title,
            company,
            level: (['Junior', 'Pleno', 'Senior'].includes(job.level) ? job.level : 'Pleno') as 'Junior' | 'Pleno' | 'Senior',
            remote: job.remote ?? false,
            location: (job as { location?: string | null }).location ?? null,
            skills: Array.isArray(job.tags) ? job.tags : [],
            description: job.description ?? '',
            salary: job.salary ?? null,
            link,
            match: typeof job.match === 'number' ? job.match : 0,
            link_status: linkStatus,
            ...((job as { published_at?: string | null }).published_at
              ? { published_at: (job as { published_at?: string | null }).published_at }
              : {}),
          };
        })
      );

      const skills = [...new Set(verifiedJobs.flatMap((j) => j.skills))].slice(0, 10);

      const { data: search, error: searchError } = await supabase
        .from('searches')
        .insert({ github_username: null, skills, user_id: req.userId ?? null, query })
        .select()
        .single();

      if (searchError) throw new Error(searchError.message);

      const { data: savedJobs, error: jobsError } = await supabase
        .from('jobs')
        .insert(verifiedJobs.map((vj) => toInsertRow(vj as Record<string, unknown>, search.id)))
        .select();

      if (jobsError) throw new Error(jobsError.message);

      const jobs = (savedJobs ?? []).map((saved, i) => ({
        ...saved,
        match: verifiedJobs[i].match,
        ...((verifiedJobs[i] as Record<string, unknown>)['published_at'] != null
          ? { published_at: (verifiedJobs[i] as Record<string, unknown>)['published_at'] }
          : {}),
      }));

      res.json({ jobs, bonusJobs: prepareBonus(rawBonus), profileSummary: result.profileSummary });
    } catch (err) {
      console.error('[query] Error finding jobs:', err);
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('quota') || msg.includes('too many requests') || msg.includes('429')) {
        res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em alguns minutos.' });
      } else {
        res.status(500).json({ error: 'Erro ao buscar vagas. Tente novamente.' });
      }
    }
    return;
  }

  // ── Route B: LinkedIn-based search ──
  if (!linkedIn?.positions?.length && !linkedIn?.education?.length) {
    res.status(400).json({ error: 'Importe seu perfil do LinkedIn antes de buscar vagas' });
    return;
  }

  try {
    const result = await findProfessionJobs(linkedIn!.positions, linkedIn!.education, linkedIn!.certifications ?? [], preferences, blockedKeywords, blockedSources, likedSources, careerProfile, githubUsername);

    const rawJobs  = Array.isArray(result.jobs)      ? result.jobs      : [];
    const rawBonus = Array.isArray(result.bonusJobs) ? result.bonusJobs : [];

    const prepareBonus = (jobs: typeof rawBonus) =>
      jobs.map((job) => ({
        id:          `bonus-${Math.random().toString(36).slice(2)}`,
        title:       job.title ?? '',
        company:     job.company ?? '',
        level:       (['Junior', 'Pleno', 'Senior'].includes(job.level) ? job.level : 'Pleno') as 'Junior' | 'Pleno' | 'Senior',
        remote:      job.remote ?? false,
        location:    (job as { location?: string | null }).location ?? null,
        skills:      Array.isArray(job.tags) ? job.tags : [],
        description: job.description ?? '',
        salary:      job.salary ?? null,
        link:        job.link || resolveJobLink(null, job.title ?? '', job.company ?? ''),
        match:       typeof job.match === 'number' ? job.match : 0,
        link_status: 'unverified' as const,
        seen:        false,
      }));

    if (!rawJobs.length) {
      res.json({ jobs: [], bonusJobs: prepareBonus(rawBonus), profileSummary: result.profileSummary ?? '' });
      return;
    }

    const verifiedJobs = await Promise.all(
      rawJobs.map(async (job) => {
        const title   = job.title ?? '';
        const company = job.company ?? '';
        let link      = job.link || null;
        let linkStatus = await verifyLink(link);

        if (linkStatus === 'dead' || linkStatus === 'none') {
          link = resolveJobLink(null, title, company);
          linkStatus = 'unverified';
        }

        return {
          title,
          company,
          level: (['Junior', 'Pleno', 'Senior'].includes(job.level) ? job.level : 'Pleno') as 'Junior' | 'Pleno' | 'Senior',
          remote: job.remote ?? false,
          location: (job as { location?: string | null }).location ?? null,
          skills: Array.isArray(job.tags) ? job.tags : [],
          description: job.description ?? '',
          salary: job.salary ?? null,
          link,
          match: typeof job.match === 'number' ? job.match : 0,
          link_status: linkStatus,
          ...((job as { published_at?: string | null }).published_at
            ? { published_at: (job as { published_at?: string | null }).published_at }
            : {}),
        };
      })
    );

    const skills = [...new Set(verifiedJobs.flatMap((j) => j.skills))].slice(0, 10);

    const { data: search, error: searchError } = await supabase
      .from('searches')
      .insert({ github_username: null, skills, user_id: req.userId ?? null })
      .select()
      .single();

    if (searchError) throw new Error(searchError.message);

    const { data: savedJobs, error: jobsError } = await supabase
      .from('jobs')
      .insert(verifiedJobs.map((vj) => toInsertRow(vj as Record<string, unknown>, search.id)))
      .select();

    if (jobsError) throw new Error(jobsError.message);

    // Re-attach match scores and published_at for the live response (not stored in DB)
    const jobs = (savedJobs ?? []).map((saved, i) => ({
      ...saved,
      match: verifiedJobs[i].match,
      ...((verifiedJobs[i] as Record<string, unknown>)['published_at'] != null
        ? { published_at: (verifiedJobs[i] as Record<string, unknown>)['published_at'] }
        : {}),
    }));

    res.json({ jobs, bonusJobs: prepareBonus(rawBonus), profileSummary: result.profileSummary });
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
