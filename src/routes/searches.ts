import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const { data: searches, error } = await supabase
    .from('searches')
    .select('*, jobs(*)')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
    return;
  }

  res.json({ searches: searches ?? [] });
});

export default router;
