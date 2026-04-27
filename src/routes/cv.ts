import { Router, Request, Response } from 'express';
import { generateCv } from '../services/cvGenerator';
import { CvRequest } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as CvRequest;

  if (!body?.job?.id || !body?.candidate?.githubLogin) {
    res.status(400).json({ error: 'Dados insuficientes para gerar CV' });
    return;
  }

  try {
    const result = await generateCv(body);
    res.json(result);
  } catch (err) {
    console.error('Error generating CV:', err);
    res.status(500).json({ error: 'Erro ao gerar currículo' });
  }
});

export default router;
