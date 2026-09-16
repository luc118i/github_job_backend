import { Router, Request, Response } from 'express';
import { generateCv, adaptCv } from '../services/cvGenerator';
import { CvRequest, CvBlock, CvVersionSource } from '../types';
import { db } from '../services/db';

const router = Router();

function getRetryAfterSeconds(err: unknown): number | null {
  const details = (err as { errorDetails?: Array<Record<string, unknown>> }).errorDetails;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    if (typeof d.retryDelay === 'string') {
      const match = d.retryDelay.match(/^(\d+)/);
      if (match) return parseInt(match[1]);
    }
  }
  return null;
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as CvRequest;

  // Valida campos obrigatórios e estrutura aninhada
  if (
    !body ||
    typeof body !== 'object' ||
    !body.job?.id ||
    typeof body.job.title !== 'string' ||
    !body.candidate?.name ||
    typeof body.candidate.name !== 'string'
  ) {
    res.status(400).json({ error: 'Dados insuficientes para gerar o CV. Informe a vaga e o nome do candidato.' });
    return;
  }

  // Garante que repos é sempre array (evita crash no cvGenerator)
  if (!Array.isArray(body.candidate.repos)) body.candidate.repos = [];

  try {
    const result = await generateCv(body);
    res.json(result);
  } catch (err) {
    console.error('Error generating CV:', err);
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('quota') || msg.includes('too many requests') || msg.includes('429')) {
      const retryAfter = getRetryAfterSeconds(err);
      res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em alguns instantes.', retryAfter });
    } else if (msg.includes('credit') || msg.includes('balance') || msg.includes('billing')) {
      res.status(503).json({ error: 'Serviço de IA temporariamente indisponível. Tente novamente mais tarde.' });
    } else if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('high demand')) {
      res.status(503).json({ error: 'Serviço de IA sobrecarregado. Tente novamente em instantes.' });
    } else {
      res.status(500).json({ error: 'Erro ao gerar currículo. Tente novamente.' });
    }
  }
});

router.get('/job/:jobId', async (req: Request, res: Response) => {
  const { data: rows, error } = await db(
    'SELECT id, content, content_blocks FROM cvs WHERE job_id = $1 LIMIT 1',
    [req.params.jobId],
  );
  const data = rows[0];

  if (error || !data) {
    res.status(404).json({ error: 'CV não encontrado' });
    return;
  }
  res.json(data);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { content, blocks } = req.body as { content?: string; blocks?: CvBlock[] };
  if (!content) {
    res.status(400).json({ error: 'O conteúdo do CV é obrigatório' });
    return;
  }
  // Salva o Markdown derivado e, quando o front mandar, os blocos editados.
  const { error } = Array.isArray(blocks)
    ? await db('UPDATE cvs SET content = $1, content_blocks = $2 WHERE id = $3', [content, JSON.stringify(blocks), req.params.id])
    : await db('UPDATE cvs SET content = $1 WHERE id = $2', [content, req.params.id]);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// ── Versionamento (Career Studio M2) ──────────────────────────────

// Snapshot da versão atual do CV. O front envia o estado atual
// (content + blocks) para evitar corrida com um PATCH simultâneo.
router.post('/:id/versions', async (req: Request, res: Response) => {
  const { content, blocks, label, source } = req.body as {
    content?: string;
    blocks?: CvBlock[];
    label?: string;
    source?: CvVersionSource;
  };
  if (!content) {
    res.status(400).json({ error: 'O conteúdo do CV é obrigatório' });
    return;
  }

  const { data: rows, error } = await db(
    `INSERT INTO cv_versions (cv_id, content, content_blocks, label, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, label, source, created_at`,
    [req.params.id, content, Array.isArray(blocks) ? JSON.stringify(blocks) : null, label?.trim() || 'Versão', source ?? 'manual'],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

// Adapta os blocos do CV para uma vaga (Career Studio M4). Não persiste:
// devolve a versão otimizada para o front mostrar o split view.
router.post('/:id/adapt', async (req: Request, res: Response) => {
  const { blocks, job } = req.body as { blocks?: CvBlock[]; job?: CvRequest['job'] };
  if (!Array.isArray(blocks) || blocks.length === 0 || !job?.title) {
    res.status(400).json({ error: 'Envie os blocos do currículo e a vaga.' });
    return;
  }
  try {
    const optimized = await adaptCv(blocks, job);
    res.json({ blocks: optimized });
  } catch (err) {
    console.error('Error adapting CV:', err);
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('quota') || msg.includes('429') || msg.includes('rate')) {
      res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em instantes.' });
    } else {
      res.status(500).json({ error: 'Erro ao adaptar o currículo. Tente novamente.' });
    }
  }
});

// Histórico de versões (mais recentes primeiro).
router.get('/:id/versions', async (req: Request, res: Response) => {
  const { data, error } = await db(
    'SELECT id, cv_id, content, content_blocks, label, source, created_at FROM cv_versions WHERE cv_id = $1 ORDER BY created_at DESC',
    [req.params.id],
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

export default router;
