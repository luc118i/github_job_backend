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
  -- Categoria p/ os filtros: frontend|backend|fullstack|data|mobile|outro.
  category    TEXT NOT NULL DEFAULT 'outro',
  link        TEXT,
  -- Repositório GitHub de origem, quando importado (chave de dedupe).
  repo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects (user_id, created_at DESC);

-- Para bases que já criaram a tabela antes desta coluna existir.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'outro';

COMMENT ON TABLE projects IS
  'Biblioteca de Projetos do usuário (Career Studio M5). Curada uma vez e reusada nos CVs; match projeto↔vaga é determinístico no front.';
