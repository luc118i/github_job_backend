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

const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors({
  origin: allowedOrigin
    ? allowedOrigin
    : (origin, cb) => cb(null, !origin || origin.startsWith('http://localhost')),
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
