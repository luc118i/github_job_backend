import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parseLinkedInZip } from '../services/linkedInParser';
import { parseLinkedInPdf } from '../services/linkedInPdfParser';

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
    res.status(422).json({ error: 'Arquivo inválido. Envie o PDF ou ZIP exportado pelo LinkedIn.' });
  }
});

export default router;
