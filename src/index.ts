import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jobsRouter from './routes/jobs';
import searchesRouter from './routes/searches';
import cvRouter from './routes/cv';
import linkedInRouter from './routes/linkedin';
import professionJobsRouter from './routes/professionJobs';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

app.use('/jobs', jobsRouter);
app.use('/searches', searchesRouter);
app.use('/cv', cvRouter);
app.use('/linkedin', linkedInRouter);
app.use('/profession-jobs', professionJobsRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
