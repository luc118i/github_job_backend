import { Router, Response } from 'express';
import { supabase } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { PipelineStatus, PipelineEntryInput, PipelineInsightsRequest } from '../types';
import { generatePipelineInsights } from '../services/pipelineInsights';

const router = Router();
router.use(requireAuth);

const SELECT = 'id, user_id, job_id, status, favorite, notes, next_step, next_step_date, cv_id, moved_at, created_at, updated_at';

const VALID_STATUS = new Set<PipelineStatus>([
  'salvas', 'preparar', 'aplicadas', 'em_analise', 'entrevista', 'proposta', 'contratado',
]);

function normalizeStatus(v: unknown): PipelineStatus | null {
  const s = String(v ?? '').trim();
  // Compat: o kanban antigo usava 'finalizadas' → vira 'contratado'.
  if (s === 'finalizadas') return 'contratado';
  return VALID_STATUS.has(s as PipelineStatus) ? (s as PipelineStatus) : null;
}

// GET /pipeline — todas as entradas do usuário.
router.get('/', async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('job_pipeline')
    .select(SELECT)
    .eq('user_id', req.userId!);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

// PUT /pipeline/:jobId — cria/atualiza a entrada da vaga (upsert por user+job).
// moved_at é renovado só quando a etapa realmente muda (base do follow-up).
router.put('/:jobId', async (req: AuthRequest, res: Response) => {
  const jobId = String(req.params.jobId ?? '').trim();
  if (!jobId) {
    res.status(400).json({ error: 'jobId é obrigatório.' });
    return;
  }
  const body = req.body as PipelineEntryInput;

  // Estado atual (p/ detectar mudança de etapa e preservar campos).
  const { data: existing } = await supabase
    .from('job_pipeline')
    .select('status')
    .eq('user_id', req.userId!)
    .eq('job_id', jobId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    user_id: req.userId!,
    job_id: jobId,
    updated_at: new Date().toISOString(),
  };

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status);
    if (!status) {
      res.status(400).json({ error: 'Etapa inválida.' });
      return;
    }
    row.status = status;
    // Renova moved_at só se a etapa mudou (ou se é nova entrada).
    if (!existing || existing.status !== status) row.moved_at = new Date().toISOString();
  }
  if (body.favorite !== undefined) row.favorite = Boolean(body.favorite);
  if (body.notes !== undefined) row.notes = String(body.notes ?? '');
  if (body.next_step !== undefined) row.next_step = body.next_step ? String(body.next_step).trim() : null;
  if (body.next_step_date !== undefined) row.next_step_date = body.next_step_date || null;
  if (body.cv_id !== undefined) row.cv_id = body.cv_id || null;

  const { data, error } = await supabase
    .from('job_pipeline')
    .upsert(row, { onConflict: 'user_id,job_id' })
    .select(SELECT)
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

// POST /pipeline/insights — IA analisa o pipeline e devolve padrões (F5).
// O front envia o resumo das candidaturas (efêmero, não persiste).
router.post('/insights', async (req: AuthRequest, res: Response) => {
  const body = req.body as PipelineInsightsRequest;
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    res.status(400).json({ error: 'Sem candidaturas para analisar.' });
    return;
  }
  try {
    const insights = await generatePipelineInsights(body.items.slice(0, 60));
    res.json(insights);
  } catch (err) {
    console.error('[pipeline/insights]', err);
    res.status(503).json({ error: 'A IA está indisponível agora. Tente novamente em instantes.' });
  }
});

// DELETE /pipeline/:jobId — remove a entrada (vaga descartada do pipeline).
router.delete('/:jobId', async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('job_pipeline')
    .delete()
    .eq('user_id', req.userId!)
    .eq('job_id', req.params.jobId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
