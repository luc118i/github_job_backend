import { Router, Response } from 'express';
import { db } from '../services/db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { generateMessage } from '../services/messageGenerator';
import { MessageType, MessageGenRequest, MessageInput } from '../types';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = new Set<MessageType>(['cover_letter', 'recruiter_dm', 'email', 'follow_up']);

// POST /messages/generate — gera o texto com IA (efêmero, não persiste).
router.post('/generate', async (req: AuthRequest, res: Response) => {
  const body = req.body as MessageGenRequest;
  if (!body?.type || !VALID_TYPES.has(body.type) || !body.job?.title || !body.candidate?.name) {
    res.status(400).json({ error: 'Informe o tipo, a vaga e o candidato para gerar a mensagem.' });
    return;
  }
  try {
    const draft = await generateMessage(body);
    res.json(draft);
  } catch (err) {
    console.error('Error generating message:', err);
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('quota') || msg.includes('429') || msg.includes('rate') || msg.includes('too many')) {
      res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em instantes.' });
    } else {
      res.status(500).json({ error: 'Erro ao gerar a mensagem. Tente novamente.' });
    }
  }
});

// GET /messages?jobId= — lista as mensagens do usuário (filtra por vaga se enviado).
router.get('/', async (req: AuthRequest, res: Response) => {
  const jobId = req.query.jobId;
  const params: unknown[] = [req.userId!];
  let sql = 'SELECT id, user_id, job_id, type, subject, content, created_at, updated_at FROM messages WHERE user_id = $1';
  if (typeof jobId === 'string' && jobId) {
    params.push(jobId);
    sql += ` AND job_id = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC';

  const { data, error } = await db(sql, params);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

// POST /messages — salva uma mensagem editada.
router.post('/', async (req: AuthRequest, res: Response) => {
  const { job_id, type, subject, content } = req.body as MessageInput;
  if (!job_id || !type || !VALID_TYPES.has(type) || !content?.trim()) {
    res.status(400).json({ error: 'Dados insuficientes para salvar a mensagem.' });
    return;
  }

  const { data: rows, error } = await db(
    `INSERT INTO messages (user_id, job_id, type, subject, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, job_id, type, subject, content, created_at, updated_at`,
    [req.userId!, job_id, type, subject?.trim() || null, content.trim()],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

// PATCH /messages/:id — edita assunto/conteúdo (só do próprio usuário).
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { subject, content } = req.body as { subject?: string | null; content?: string };
  if (!content?.trim()) {
    res.status(400).json({ error: 'O conteúdo da mensagem é obrigatório.' });
    return;
  }

  const { data: rows, error } = await db(
    `UPDATE messages SET subject = $1, content = $2, updated_at = now()
      WHERE id = $3 AND user_id = $4
      RETURNING id, user_id, job_id, type, subject, content, created_at, updated_at`,
    [subject?.trim() || null, content.trim(), req.params.id, req.userId!],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Mensagem não encontrada.' });
    return;
  }
  res.json(data);
});

// DELETE /messages/:id — remove (só do próprio usuário).
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { error } = await db('DELETE FROM messages WHERE id = $1 AND user_id = $2', [req.params.id, req.userId!]);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
