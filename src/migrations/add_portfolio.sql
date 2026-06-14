-- Career Studio M8 — Portfólio Público.
-- Rode uma vez no SQL Editor do Supabase. Seguro repetir (IF NOT EXISTS).
-- O portfólio é montado na hora a partir do GitHub + biblioteca de projetos +
-- LinkedIn já salvos; aqui guardamos só o controle de publicação e os textos
-- curados (headline e resumo) que o usuário edita.

ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_headline TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_summary TEXT;
-- Template visual do portfólio (v6.0): executivo | especialista | criativo | tech.
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_template TEXT NOT NULL DEFAULT 'especialista';
-- Contador de visualizações da página pública (v6.0).
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_views INT NOT NULL DEFAULT 0;

-- Incremento atômico das views (chamado pela página pública).
CREATE OR REPLACE FUNCTION increment_portfolio_views(p_username TEXT)
RETURNS void LANGUAGE sql AS $$
  UPDATE users
     SET portfolio_views = COALESCE(portfolio_views, 0) + 1
   WHERE github_username ILIKE p_username AND portfolio_published = true;
$$;

-- Busca pública por github_username (página /p/<username>).
CREATE INDEX IF NOT EXISTS idx_users_github_username ON users (github_username);
