import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { db } from '../services/db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { LinkedInData } from '../types';
import { sendEmail, buildResetPasswordEmail } from '../services/email';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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

// POST /auth/check-email — diz se já existe conta com esse e-mail.
// Usado no front pra alternar entre "entrar" e "criar conta" automaticamente.
router.post('/check-email', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !email.trim()) {
    res.status(400).json({ error: 'E-mail é obrigatório' });
    return;
  }

  const { data: rows, error } = await db('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);

  if (error) {
    res.status(503).json({ error: 'Não foi possível verificar o e-mail. Tente novamente.' });
    return;
  }

  res.json({ exists: rows.length > 0 });
});

// POST /auth/forgot-password — gera um token de redefinição e envia por e-mail.
// Sempre responde { ok: true } (mesmo se o e-mail não existir) pra não revelar
// quais e-mails têm conta através desse endpoint especificamente.
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !email.trim()) {
    res.status(400).json({ error: 'E-mail é obrigatório' });
    return;
  }

  const { data: userRows, error } = await db('SELECT id, email FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  if (error) {
    res.status(503).json({ error: 'Não foi possível processar o pedido. Tente novamente.' });
    return;
  }

  const user = userRows[0];
  if (user) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

    const { error: insertError } = await db(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(token), expiresAt],
    );

    if (!insertError) {
      const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',')[0].trim();
      const resetUrl = `${frontendUrl}/?reset=${token}`;
      const { subject, html } = buildResetPasswordEmail(resetUrl);
      try {
        await sendEmail({ to: user.email as string, subject, html });
      } catch (err) {
        console.error('[forgot-password] falha ao enviar e-mail:', err);
      }
    } else {
      console.error('[forgot-password] falha ao criar token:', insertError);
    }
  }

  res.json({ ok: true });
});

// POST /auth/reset-password — troca a senha usando o token recebido por e-mail.
router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };

  if (!token || !newPassword) {
    res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres' });
    return;
  }

  const { data: tokenRows, error } = await db(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
    [hashToken(token)],
  );

  if (error) {
    res.status(503).json({ error: 'Não foi possível redefinir a senha. Tente novamente.' });
    return;
  }

  const resetToken = tokenRows[0];
  const expired = !resetToken || resetToken.used_at || new Date(resetToken.expires_at as string) < new Date();
  if (expired) {
    res.status(400).json({ error: 'Link de redefinição inválido ou expirado. Solicite um novo.' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const { error: updateError } = await db('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetToken.user_id]);
  if (updateError) {
    res.status(500).json({ error: 'Erro ao redefinir a senha' });
    return;
  }

  await db('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [resetToken.id]);

  res.json({ ok: true });
});

export default router;
