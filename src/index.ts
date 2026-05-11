import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jobsRouter from './routes/jobs';
import searchesRouter from './routes/searches';
import cvRouter from './routes/cv';
import linkedInRouter from './routes/linkedin';
import professionJobsRouter from './routes/professionJobs';
import authRouter from './routes/auth';

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

app.get('/health', (_req, res) => res.sendStatus(200));

app.use('/auth', authRouter);
app.use('/jobs', jobsRouter);
app.use('/searches', searchesRouter);
app.use('/cv', cvRouter);
app.use('/linkedin', linkedInRouter);
app.use('/profession-jobs', professionJobsRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
