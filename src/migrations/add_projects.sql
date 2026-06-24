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
  -- README do repo, cacheado para o match por IA (evita rebuscar o GitHub).
  readme      TEXT,
  -- Competências detectadas pela IA (Biblioteca v5.0): string[].
  competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Portfolio Score 0-100 (heurística). null = ainda não analisado.
  portfolio_score INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects (user_id, created_at DESC);

-- Para bases que já criaram a tabela antes destas colunas existirem.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'outro';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS readme TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS competencies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portfolio_score INT;

COMMENT ON TABLE projects IS
  'Biblioteca de Projetos do usuário (Career Studio M5). Curada uma vez e reusada nos CVs; match projeto↔vaga é determinístico no front.';
