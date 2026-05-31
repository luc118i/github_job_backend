-- Run this once in the Supabase SQL editor to enable CV version history.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- Career Studio M2: cada versão é um snapshot imutável dos blocos do
-- currículo (content_blocks) + o Markdown derivado, com rótulo e origem.
--   source = 'initial'  -> criada na geração do CV
--   source = 'manual'   -> usuário clicou "salvar versão"
--   source = 'adapted'  -> gerada pelo M4 (adaptar para vaga)

CREATE TABLE IF NOT EXISTS cv_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id           UUID NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  content_blocks  JSONB,
  label           TEXT NOT NULL DEFAULT 'Versão',
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cv_versions_cv_id_created_at_idx
  ON cv_versions (cv_id, created_at DESC);

COMMENT ON TABLE cv_versions IS
  'Histórico de versões do currículo (Career Studio M2). Snapshot imutável de content + content_blocks por versão.';
