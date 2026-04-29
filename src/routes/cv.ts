import { Router, Request, Response } from 'express';
import { generateCv } from '../services/cvGenerator';
import { CvRequest } from '../types';
import { supabase } from '../services/supabase';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as CvRequest;

  if (!body?.job?.id || !body?.candidate?.name) {
    res.status(400).json({ error: 'Dados insuficientes para gerar CV' });
    return;
  }

  try {
    const result = await generateCv(body);
    res.json(result);
  } catch (err) {
    console.error('Error generating CV:', err);
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('quota') || msg.includes('too many requests') || msg.includes('429')) {
      res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em alguns minutos.' });
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
  const { data, error } = await supabase
    .from('cvs')
    .select('id, content')
    .eq('job_id', req.params.jobId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    res.status(404).json({ error: 'CV não encontrado' });
    return;
  }
  res.json(data);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { content } = req.body as { content?: string };
  if (!content) {
    res.status(400).json({ error: 'content obrigatório' });
    return;
  }
  const { error } = await supabase
    .from('cvs')
    .update({ content })
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

export default router;
