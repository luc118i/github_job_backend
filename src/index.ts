import './env-setup'; // MUST be first — loads .env before any module reads process.env
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jobsRouter from './routes/jobs';
import searchesRouter from './routes/searches';
import cvRouter from './routes/cv';
import linkedInRouter from './routes/linkedin';
import professionJobsRouter from './routes/professionJobs';
import authRouter from './routes/auth';
import analyzeLinkRouter from './routes/analyzeLink';
import careerRouter from './routes/career';
import projectsRouter from './routes/projects';
import messagesRouter from './routes/messages';
import interviewRouter from './routes/interview';

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, origin.startsWith('http://localhost'));
    if (allowedOrigins.includes(origin)) return cb(null, true);
    console.warn(`[CORS] origem bloqueada: ${origin} | permitidas: ${allowedOrigins.join(', ')}`);
    cb(new Error(`Origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: '2mb' }));

// ── Rate limiting ────────────────────────────────────────────────────
// Rotas públicas pesadas (consomem créditos de IA) — 20 req/15min por IP
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde alguns minutos e tente novamente.' },
});

// Auth — 10 tentativas de login por 15min por IP (anti-brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
});

app.get('/health', (_req, res) => res.sendStatus(200));

app.use('/auth', authLimiter, authRouter);
app.use('/jobs', heavyLimiter, jobsRouter);
app.use('/searches', searchesRouter);
app.use('/cv', heavyLimiter, cvRouter);
app.use('/linkedin', linkedInRouter);
app.use('/profession-jobs', heavyLimiter, professionJobsRouter);
app.use('/analyze-link', analyzeLinkRouter);
app.use('/career', careerRouter);
app.use('/projects', projectsRouter);
app.use('/messages', heavyLimiter, messagesRouter);
app.use('/interview', heavyLimiter, interviewRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
