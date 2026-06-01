-- Career Studio M6 — Cartas/Mensagens.
-- Rode uma vez no SQL Editor do Supabase. Seguro repetir (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Vaga de origem (string, igual ao job_id usado em cvs).
  job_id     TEXT NOT NULL,
  -- cover_letter | recruiter_dm | email | follow_up
  type       TEXT NOT NULL,
  -- Assunto (usado no e-mail; null nos demais).
  subject    TEXT,
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_job
  ON messages (user_id, job_id, created_at DESC);

COMMENT ON TABLE messages IS
  'Cartas/mensagens geradas por IA e personalizadas para a vaga (Career Studio M6).';
