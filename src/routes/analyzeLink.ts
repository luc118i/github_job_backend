import { Router, Response } from 'express';
import { analyzeJobLink, CandidateProfile } from '../services/linkAnalyzer';
import { verifyLink } from '../services/linkVerifier';
import { db } from '../services/db';
import { optionalAuth, AuthRequest } from '../middleware/auth';
import { LinkedInData } from '../types';

const router = Router();

router.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  const {
    url,
    text,
    githubUsername,
    githubBio,
    skills,
    repos,
    linkedIn,
  } = req.body as {
    url?: string;
    text?: string;
    githubUsername?: string;
    githubBio?: string | null;
    skills?: string[];
    repos?: { name: string; description: string | null; topics: string[] }[];
    linkedIn?: LinkedInData | null;
  };

  const hasUrl = !!url && url.startsWith('http');
  const hasText = !!text && text.trim().length > 0;

  if (!hasUrl && !hasText) {
    res.status(400).json({ error: 'Informe uma URL válida (começando com http:// ou https://) ou cole a descrição da vaga.' });
    return;
  }

  try {
    const profile: CandidateProfile = { githubUsername, githubBio, skills, repos, linkedIn };
    const { job, match } = await analyzeJobLink({ url: hasUrl ? url : undefined, text: hasText ? text : undefined }, profile);

    const linkStatus = hasUrl ? await verifyLink(url!) : 'none';

    const { data: searchRows, error: searchError } = await db(
      `INSERT INTO searches (github_username, skills, user_id) VALUES ($1, $2, $3) RETURNING *`,
      [githubUsername ?? null, JSON.stringify(job.skills), req.userId ?? null],
    );
    const search = searchRows[0];
    if (searchError || !search) throw new Error(searchError?.message || 'Falha ao inserir busca');

    const { data: jobRows, error: jobError } = await db(
      `INSERT INTO jobs (search_id, title, company, level, remote, location, skills, description, salary, link, link_status, seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        search.id,
        job.title,
        job.company,
        job.level,
        job.remote,
        job.location ?? null,
        JSON.stringify(job.skills),
        job.description,
        job.salary,
        hasUrl ? url : null,
        linkStatus === 'none' ? 'unverified' : linkStatus,
        true,
      ],
    );
    const savedJob = jobRows[0];

    if (jobError || !savedJob) throw new Error(jobError?.message || 'Falha ao inserir vaga');

    res.json({
      job: savedJob,
      match,
      atsKeywords: job.atsKeywords,
      requirements: job.requirements,
      language: job.language,
      contactEmail: job.contactEmail,
    });
  } catch (err) {
    console.error('[analyze-link] erro:', err);
    const msg = err instanceof Error ? err.message : '';
    const isServiceOutage = /quota|429|credit balance|insufficient_quota|503 Service Unavailable/i.test(msg);
    // Erros crus de SDK (Anthropic/Groq/Gemini) vêm como JSON/stack técnico — nunca
    // repassar isso pro usuário final. Só mensagens curtas em PT-BR (as que a própria
    // linkAnalyzer lança de propósito) são seguras de exibir.
    const isUserFacingMessage = !!msg && msg.length < 300 && !/[{}]/.test(msg) && !/^\d{3}\s/.test(msg);
    if (isServiceOutage) {
      res.status(503).json({ error: 'Serviço de IA temporariamente indisponível (limite atingido). Tente novamente em alguns minutos.' });
    } else if (isUserFacingMessage) {
      res.status(500).json({ error: msg });
    } else {
      res.status(500).json({ error: 'Erro ao analisar vaga. Tente novamente.' });
    }
  }
});

export default router;
