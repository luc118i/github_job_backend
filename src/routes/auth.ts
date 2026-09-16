import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../services/db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { LinkedInData } from '../types';

const router = Router();

function signToken(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '90d' });
}

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, linkedInData } = req.body as {
    email: string;
    password: string;
    linkedInData: LinkedInData;
  };

  if (!email || !password || !linkedInData) {
    res.status(400).json({ error: 'email, senha e dados do LinkedIn são obrigatórios' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres' });
    return;
  }

  const { data: existingRows } = await db('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);

  if (existingRows[0]) {
    res.status(409).json({ error: 'Este e-mail já tem uma conta. Faça login.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data: userRows, error } = await db(
    `INSERT INTO users (email, name, phone, password_hash, linkedin_data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, github_username`,
    [email.toLowerCase(), linkedInData.name, linkedInData.phone, passwordHash, JSON.stringify(linkedInData)],
  );
  const user = userRows[0];

  if (error || !user) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar conta' });
    return;
  }

  res.json({ token: signToken(user.id), user: { id: user.id, email: user.email, name: user.name, github_username: user.github_username ?? null } });
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    return;
  }

  const { data: userRows, error } = await db(
    'SELECT id, email, name, github_username, password_hash, linkedin_data FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  const user = userRows[0];

  if (error) {
    console.error('Erro ao consultar usuário no login:', error);
    res.status(503).json({ error: 'Não foi possível conectar ao banco de dados. Tente novamente em instantes.' });
    return;
  }

  if (!user) {
    res.status(401).json({ error: 'E-mail ou senha incorretos' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'E-mail ou senha incorretos' });
    return;
  }

  res.json({
    token: signToken(user.id),
    user: { id: user.id, email: user.email, name: user.name, github_username: user.github_username ?? null },
    linkedInData: user.linkedin_data,
  });
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data: userRows } = await db(
    'SELECT id, email, name, github_username, linkedin_data FROM users WHERE id = $1',
    [req.userId!],
  );
  const user = userRows[0];

  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }

  res.json({
    user: { id: user.id, email: user.email, name: user.name, github_username: user.github_username ?? null },
    linkedInData: user.linkedin_data,
  });
});

// PATCH /auth/profile — atualiza nome e github_username
router.patch('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, github_username } = req.body as { name?: string | null; github_username?: string | null };

  const sets: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { params.push(name || null); sets.push(`name = $${params.length}`); }
  if (github_username !== undefined) { params.push(github_username || null); sets.push(`github_username = $${params.length}`); }

  if (sets.length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar' });
    return;
  }

  params.push(req.userId!);
  const { data: userRows, error } = await db(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, email, name, github_username`,
    params,
  );
  const user = userRows[0];

  if (error || !user) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
    return;
  }

  res.json({ user: { id: user.id, email: user.email, name: user.name, github_username: user.github_username ?? null } });
});

// GET /auth/preferences — lê preferências de filtragem do usuário
router.get('/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data: userRows } = await db('SELECT preferences FROM users WHERE id = $1', [req.userId!]);
  const user = userRows[0];

  res.json({ preferences: (user?.preferences as Record<string, unknown>) ?? {} });
});

// PATCH /auth/preferences — salva preferências de filtragem do usuário
router.patch('/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
  const { preferences } = req.body as {
    preferences: {
      blocked_keywords?: string[];
      liked_keywords?: string[];
      blocked_sources?: string[];
      liked_sources?: string[];
    };
  };

  if (!preferences || typeof preferences !== 'object') {
    res.status(400).json({ error: 'Corpo inválido' });
    return;
  }

  const { error } = await db('UPDATE users SET preferences = $1 WHERE id = $2', [JSON.stringify(preferences), req.userId!]);

  if (error) {
    res.status(500).json({ error: 'Erro ao salvar preferências' });
    return;
  }

  res.json({ ok: true });
});

// PATCH /auth/linkedin — atualiza linkedin_data do usuário logado
router.patch('/linkedin', requireAuth, async (req: AuthRequest, res: Response) => {
  const { linkedInData } = req.body as { linkedInData: LinkedInData };

  if (!linkedInData) {
    res.status(400).json({ error: 'Dados do LinkedIn são obrigatórios' });
    return;
  }

  const { error } = await db(
    'UPDATE users SET linkedin_data = $1, name = $2, phone = $3 WHERE id = $4',
    [JSON.stringify(linkedInData), linkedInData.name, linkedInData.phone, req.userId!],
  );

  if (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
    return;
  }

  res.json({ ok: true });
});

export default router;
