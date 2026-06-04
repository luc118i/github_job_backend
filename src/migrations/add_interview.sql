-- Career Studio M7 — Interview Studio (preparação para entrevista).
-- Rode uma vez no SQL Editor do Supabase. Seguro repetir (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS interview_preps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Vaga associada (mesma chave usada nos CVs/mensagens).
  job_id              TEXT NOT NULL,
  -- Perguntas prováveis com resposta sugerida (STAR):
  -- [{ category: 'tecnica'|'comportamental', question, suggestedAnswer }]
  questions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Perguntas que o candidato pode fazer ao recrutador (string[]).
  recruiter_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uma preparação por usuário+vaga (permite upsert).
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_user_job
  ON interview_preps (user_id, job_id);

COMMENT ON TABLE interview_preps IS
  'Preparação para entrevista por usuário+vaga (Career Studio M7). A simulação interativa (chat) é efêmera; só a prep gerada é persistida.';
