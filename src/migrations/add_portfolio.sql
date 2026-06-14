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

-- Busca pública por github_username (página /p/<username>).
CREATE INDEX IF NOT EXISTS idx_users_github_username ON users (github_username);
