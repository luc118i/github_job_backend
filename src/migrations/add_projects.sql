-- Career Studio M5 — Biblioteca de Projetos.
-- Rode uma vez no SQL Editor do Supabase. Seguro repetir (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Stack/tecnologias (usado no match determinístico com as skills da vaga).
  tech        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Conquistas/destaques em bullets (entram no bloco "projetos" do CV).
  highlights  JSONB NOT NULL DEFAULT '[]'::jsonb,
  link        TEXT,
  -- Repositório GitHub de origem, quando importado.
  repo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects (user_id, created_at DESC);

COMMENT ON TABLE projects IS
  'Biblioteca de Projetos do usuário (Career Studio M5). Curada uma vez e reusada nos CVs; match projeto↔vaga é determinístico no front.';
