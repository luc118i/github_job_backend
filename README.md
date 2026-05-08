# GitHub Job Finder - Backend

API em Node.js, Express e TypeScript para buscar vagas compatíveis com perfis do GitHub/LinkedIn, salvar resultados no Supabase e gerar currículos em Markdown com IA.

## Stack

- Node.js 20+
- Express 4
- TypeScript
- Supabase
- Anthropic Claude
- Google Gemini
- Adzuna, opcional, para busca estruturada de vagas
- Multer, para upload de PDF/ZIP do LinkedIn

## Funcionalidades

- Autenticacao por e-mail e senha com JWT.
- Importacao de dados do LinkedIn por PDF ou ZIP.
- Busca de vagas por perfil GitHub.
- Busca de vagas por historico profissional do LinkedIn.
- Ranking e enriquecimento de vagas com IA.
- Verificacao basica dos links das vagas.
- Historico de buscas e vagas salvas no Supabase.
- Geracao, consulta e edicao de curriculos para vagas.

## Como rodar localmente

Instale as dependencias:

```bash
npm install
```

Crie o arquivo de ambiente:

```bash
cp .env.example .env
```

Preencha as variaveis em `.env` e inicie o servidor:

```bash
npm run dev
```

Por padrao a API sobe em:

```text
http://localhost:3001
```

Health check:

```text
GET /health
```

## Variaveis de ambiente

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
GOOGLE_API_KEY=your-google-ai-studio-key
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
JWT_SECRET=your-jwt-secret
ADZUNA_APP_ID=your-adzuna-app-id
ADZUNA_APP_KEY=your-adzuna-app-key
PORT=3001
FRONTEND_URL=http://localhost:5173
```

Observacoes:

- `ANTHROPIC_API_KEY` e `GOOGLE_API_KEY` sao usadas nos fluxos de busca com IA e geracao de CV.
- `ADZUNA_APP_ID` e `ADZUNA_APP_KEY` sao opcionais. Quando existem, o backend tenta usar Adzuna primeiro e faz fallback para busca com IA se necessario.
- `SUPABASE_SERVICE_ROLE_KEY` deve ficar somente no backend. Nunca exponha essa chave no frontend.
- `JWT_SECRET` e necessario para login, registro e rotas autenticadas.
- `FRONTEND_URL` controla a origem permitida no CORS.

## Scripts

```bash
npm run dev
```

Roda a API em modo desenvolvimento com `tsx watch`.

```bash
npm run build
```

Compila TypeScript para `dist`.

```bash
npm start
```

Executa a versao compilada em `dist/index.js`.

## Rotas principais

### Auth

- `POST /auth/register` cria usuario com e-mail, senha e dados do LinkedIn.
- `POST /auth/login` autentica usuario e retorna token JWT.
- `GET /auth/me` retorna usuario logado e dados do LinkedIn.
- `PATCH /auth/profile` atualiza nome e usuario GitHub.
- `PATCH /auth/linkedin` atualiza dados importados do LinkedIn.

### Vagas por GitHub

- `POST /jobs` busca vagas usando perfil GitHub, repositorios, skills e preferencias.
- `PATCH /jobs/:id/seen` marca vaga como visualizada.
- `PATCH /jobs/:id/dismiss` descarta vaga.

### Vagas por profissao

- `POST /profession-jobs` busca vagas usando experiencia e formacao importadas do LinkedIn.

### Historico

- `GET /searches` lista as vagas salvas no historico, removendo duplicadas por titulo e empresa.

### LinkedIn

- `POST /linkedin/import` recebe `multipart/form-data` com campo `file`.
- Aceita PDF ou ZIP exportado pelo LinkedIn.
- Limite de upload: 20 MB.

### Curriculos

- `POST /cv` gera curriculo em Markdown para uma vaga.
- `GET /cv/job/:jobId` busca curriculo existente por vaga.
- `PATCH /cv/:id` atualiza conteudo de curriculo.

## Fluxo de busca de vagas

1. O frontend envia perfil GitHub ou LinkedIn e preferencias.
2. O backend cria uma busca em `searches`.
3. Para GitHub, se Adzuna estiver configurado, a API busca vagas por queries geradas a partir do perfil.
4. Claude ranqueia as vagas retornadas. Se esse fluxo falhar, o backend usa busca web com Claude.
5. Se Claude falhar por erro da API, o backend tenta Gemini.
6. Links sao verificados e as vagas sao salvas em `jobs`.
7. A resposta retorna as vagas salvas e o identificador da busca.

## Supabase

O codigo espera tabelas como:

- `users`
- `searches`
- `jobs`
- `cvs`

Campos usados aparecem nas rotas e servicos, especialmente em:

- `src/routes/auth.ts`
- `src/routes/jobs.ts`
- `src/routes/professionJobs.ts`
- `src/routes/searches.ts`
- `src/services/cvGenerator.ts`

## Docker

Build da imagem:

```bash
docker build -t github-job-finder-backend .
```

Execucao:

```bash
docker run --env-file .env -p 3001:3001 github-job-finder-backend
```

## Estrutura

```text
src/
  index.ts                 Entrada da API e registro das rotas
  middleware/auth.ts       Autenticacao JWT obrigatoria/opcional
  routes/                  Rotas HTTP
  services/                Integracoes, IA, Supabase e parsers
  types/                   Tipos compartilhados do backend
```

## Notas de seguranca

- Nao commite `.env`.
- A service role key do Supabase deve permanecer somente no backend.
- Use um `JWT_SECRET` forte em producao.
- Restrinja `FRONTEND_URL` para o dominio real do frontend em producao.
