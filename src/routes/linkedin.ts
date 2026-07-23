import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parseLinkedInZip } from '../services/linkedInParser';
import { parseLinkedInPdf } from '../services/linkedInPdfParser';
import { parseResumeText } from '../services/resumeParser';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf');
    const isZip = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip');
    cb(null, isPdf || isZip);
  },
});

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo enviado' });
    return;
  }

  try {
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf');
    const data = isPdf
      ? await parseLinkedInPdf(req.file.buffer)
      : parseLinkedInZip(req.file.buffer);
    res.json(data);
  } catch (err) {
    console.error('LinkedIn parse error:', err);
    res.status(422).json({ error: 'Arquivo inválido. Envie um PDF de currículo ou o .zip exportado pelo LinkedIn.' });
  }
});

router.post('/import-text', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };

  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Cole o texto do currículo' });
    return;
  }

  try {
    const data = await parseResumeText(text);
    res.json(data);
  } catch (err) {
    console.error('Resume text parse error:', err);
    res.status(422).json({ error: 'Não foi possível interpretar o texto colado. Tente novamente.' });
  }
});

export default router;
