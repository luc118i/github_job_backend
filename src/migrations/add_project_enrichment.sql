-- Biblioteca de Projetos v5.0 — enriquecimento por IA.
-- Adiciona competências detectadas pela IA + Portfolio Score aos projetos.
-- Rode uma vez no SQL Editor do Supabase. Seguro repetir (IF NOT EXISTS).

-- Competências profissionais detectadas pela IA (string[]).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS competencies JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Portfolio Score 0-100 (heurística). NULL = projeto ainda não analisado.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portfolio_score INT;

-- (readme já foi adicionado em add_projects.sql; incluído aqui por segurança)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS readme TEXT;
