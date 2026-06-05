-- Job Pipeline CRM (MVC v4.0) — metadados de cada candidatura por usuário.
-- Migra o antigo kanban (que vivia em localStorage) para o Supabase, base do
-- CRM: analytics histórico, IA insights e follow-up engine. Rode uma vez.

CREATE TABLE IF NOT EXISTS job_pipeline (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Vaga associada (mesma chave usada em cvs/messages).
  job_id         TEXT NOT NULL,
  -- Etapa do pipeline (7 etapas do MVC v4.0):
  -- salvas | preparar | aplicadas | em_analise | entrevista | proposta | contratado
  status         TEXT NOT NULL DEFAULT 'salvas',
  favorite       BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT NOT NULL DEFAULT '',
  -- Próxima ação (CRM): texto livre + data opcional.
  next_step      TEXT,
  next_step_date DATE,
  -- CV utilizado nessa candidatura (referencia cvs.id; sem FK p/ não travar).
  cv_id          UUID,
  -- Quando entrou na etapa atual (base do follow-up por cor).
  moved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_pipeline_user ON job_pipeline (user_id);

COMMENT ON TABLE job_pipeline IS
  'Pipeline CRM por usuário+vaga (MVC v4.0). Status, favorito, notas, próximo passo, CV utilizado e moved_at para o funil e o follow-up.';
