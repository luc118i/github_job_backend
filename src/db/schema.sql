-- Schema completo do GitHub Job Finder para Postgres puro (substitui o Supabase).
-- Consolida a tabela base (antes só existente no dashboard do Supabase) com
-- todas as migrações incrementais em src/migrations/*.sql.
-- Idempotente: seguro rodar mais de uma vez.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ── users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT,
  phone                TEXT,
  password_hash        TEXT NOT NULL,
  linkedin_data        JSONB,
  github_username      TEXT,
  preferences          JSONB DEFAULT '{}'::jsonb,
  career_profile       JSONB DEFAULT NULL,
  portfolio_published  BOOLEAN NOT NULL DEFAULT false,
  portfolio_headline   TEXT,
  portfolio_summary    TEXT,
  portfolio_template   TEXT NOT NULL DEFAULT 'especialista',
  portfolio_views      INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_github_username ON users (github_username);

-- Legado (versão anterior do app, sem uso no código atual) — mantido só p/ não perder dados históricos.
-- CREATE TABLE IF NOT EXISTS é no-op se a tabela já existe, então colunas novas em
-- tabelas existentes SEMPRE precisam de ALTER TABLE ADD COLUMN IF NOT EXISTS explícito.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial JSONB;

-- ── searches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS searches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  github_username  TEXT,
  skills           JSONB NOT NULL DEFAULT '[]'::jsonb,
  query            TEXT DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_searches_user ON searches (user_id, created_at DESC);

-- Legado (versão anterior do app, sem uso no código atual) — mantido só p/ não perder dados históricos.
ALTER TABLE searches ADD COLUMN IF NOT EXISTS linkedin_name TEXT;
ALTER TABLE searches ADD COLUMN IF NOT EXISTS linkedin_email TEXT;

-- ── jobs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id    UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  company      TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'Pleno',
  remote       BOOLEAN NOT NULL DEFAULT false,
  location     TEXT,
  skills       JSONB NOT NULL DEFAULT '[]'::jsonb,
  description  TEXT NOT NULL DEFAULT '',
  salary       TEXT,
  link         TEXT,
  link_status  TEXT,
  seen         BOOLEAN NOT NULL DEFAULT false,
  dismissed    BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_search_id ON jobs (search_id, created_at DESC);

-- ── projects ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  tech            JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlights      JSONB NOT NULL DEFAULT '[]'::jsonb,
  category        TEXT NOT NULL DEFAULT 'outro',
  link            TEXT,
  repo            TEXT,
  readme          TEXT,
  competencies    JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_score INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id, created_at DESC);

-- ── cvs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         TEXT NOT NULL,
  content        TEXT NOT NULL,
  content_blocks JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cvs_job_id ON cvs (job_id);

-- ── cv_versions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cv_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id          UUID NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  content        TEXT NOT NULL,
  content_blocks JSONB,
  label          TEXT NOT NULL DEFAULT 'Versão',
  source         TEXT NOT NULL DEFAULT 'manual',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cv_versions_cv_id_created_at_idx ON cv_versions (cv_id, created_at DESC);

-- ── job_pipeline ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_pipeline (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'salvas',
  favorite       BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT NOT NULL DEFAULT '',
  next_step      TEXT,
  next_step_date DATE,
  cv_id          UUID,
  moved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_pipeline_user ON job_pipeline (user_id);

-- ── messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL,
  type       TEXT NOT NULL,
  subject    TEXT,
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_job ON messages (user_id, job_id, created_at DESC);

-- ── interview_preps ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_preps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id              TEXT NOT NULL,
  questions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  recruiter_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_user_job ON interview_preps (user_id, job_id);

-- ── password_reset_tokens ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id);

-- ── increment_portfolio_views ────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_portfolio_views(p_username TEXT)
RETURNS void LANGUAGE sql AS $$
  UPDATE users
     SET portfolio_views = COALESCE(portfolio_views, 0) + 1
   WHERE github_username ILIKE p_username AND portfolio_published = true;
$$;
