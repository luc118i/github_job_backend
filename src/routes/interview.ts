import { Router, Response } from 'express';
import { db } from '../services/db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { generatePrep, simulateReply } from '../services/interviewCoach';
import {
  InterviewGenRequest,
  InterviewChatRequest,
  InterviewPrepInput,
  InterviewQuestion,
} from '../types';

const router = Router();
router.use(requireAuth);

const SELECT = 'id, user_id, job_id, questions, recruiter_questions, created_at, updated_at';

// Converte a linha do banco (snake_case) para o formato do front (camelCase).
function rowToPrep(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.user_id,
    job_id: row.job_id,
    questions: (row.questions as InterviewQuestion[]) ?? [],
    recruiterQuestions: (row.recruiter_questions as string[]) ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Trata falhas de IA com a mesma semântica das outras rotas (503 em limite/indisponível).
function aiError(res: Response, err: unknown, fallbackMsg: string) {
  console.error('[interview]', err);
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('quota') || msg.includes('429') || msg.includes('rate') || msg.includes('too many') || msg.includes('503')) {
    res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em instantes.' });
  } else {
    res.status(500).json({ error: fallbackMsg });
  }
}

// POST /interview/generate — gera a preparação (efêmero, não persiste).
router.post('/generate', async (req: AuthRequest, res: Response) => {
  const body = req.body as InterviewGenRequest;
  if (!body?.job?.title || !body?.candidate?.name) {
    res.status(400).json({ error: 'Informe a vaga e o candidato para gerar a preparação.' });
    return;
  }
  try {
    res.json(await generatePrep(body));
  } catch (err) {
    aiError(res, err, 'Erro ao gerar a preparação. Tente novamente.');
  }
});

// POST /interview/simulate — um turno da simulação interativa (efêmero).
router.post('/simulate', async (req: AuthRequest, res: Response) => {
  const body = req.body as InterviewChatRequest;
  if (!body?.job?.title || !body?.candidate?.name || !Array.isArray(body.history)) {
    res.status(400).json({ error: 'Contexto insuficiente para a simulação.' });
    return;
  }
  try {
    const content = await simulateReply(body);
    res.json({ content });
  } catch (err) {
    aiError(res, err, 'Erro na simulação. Tente novamente.');
  }
});

// GET /interview?jobId= — busca a preparação salva da vaga (ou null).
router.get('/', async (req: AuthRequest, res: Response) => {
  const jobId = req.query.jobId;
  if (typeof jobId !== 'string' || !jobId) {
    res.status(400).json({ error: 'jobId é obrigatório.' });
    return;
  }
  const { data: rows, error } = await db(
    `SELECT ${SELECT} FROM interview_preps WHERE user_id = $1 AND job_id = $2`,
    [req.userId!, jobId],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ? rowToPrep(data) : null);
});

// POST /interview — salva/atualiza a preparação da vaga (upsert por user+job).
router.post('/', async (req: AuthRequest, res: Response) => {
  const { job_id, questions, recruiterQuestions } = req.body as InterviewPrepInput;
  if (!job_id || !Array.isArray(questions)) {
    res.status(400).json({ error: 'Dados insuficientes para salvar a preparação.' });
    return;
  }

  const { data: rows, error } = await db(
    `INSERT INTO interview_preps (user_id, job_id, questions, recruiter_questions, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, job_id) DO UPDATE SET
       questions = EXCLUDED.questions,
       recruiter_questions = EXCLUDED.recruiter_questions,
       updated_at = EXCLUDED.updated_at
     RETURNING ${SELECT}`,
    [req.userId!, job_id, JSON.stringify(questions), JSON.stringify(Array.isArray(recruiterQuestions) ? recruiterQuestions : [])],
  );
  const data = rows[0];

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(rowToPrep(data));
});

// DELETE /interview/:id — remove a preparação (só do próprio usuário).
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { error } = await db('DELETE FROM interview_preps WHERE id = $1 AND user_id = $2', [req.params.id, req.userId!]);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
