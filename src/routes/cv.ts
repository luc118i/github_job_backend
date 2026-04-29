import { Router, Request, Response } from 'express';
import { generateCv } from '../services/cvGenerator';
import { CvRequest } from '../types';

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
    if (msg.includes('quota') || msg.includes('too many requests')) {
      res.status(503).json({ error: 'Limite de requisições atingido. Tente novamente em alguns minutos.' });
    } else if (msg.includes('credit') || msg.includes('balance') || msg.includes('billing')) {
      res.status(503).json({ error: 'Serviço de IA temporariamente indisponível. Tente novamente mais tarde.' });
    } else {
      res.status(500).json({ error: 'Erro ao gerar currículo. Tente novamente.' });
    }
  }
});

export default router;
