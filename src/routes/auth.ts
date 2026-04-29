import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../services/supabase';
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

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    res.status(409).json({ error: 'Este e-mail já tem uma conta. Faça login.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase(),
      name: linkedInData.name,
      phone: linkedInData.phone,
      password_hash: passwordHash,
      linkedin_data: linkedInData,
    })
    .select('id, email, name, github_username')
    .single();

  if (error) {
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

  const { data: user } = await supabase
    .from('users')
    .select('id, email, name, github_username, password_hash, linkedin_data')
    .eq('email', email.toLowerCase())
    .maybeSingle();

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
  const { data: user } = await supabase
    .from('users')
    .select('id, email, name, github_username, linkedin_data')
    .eq('id', req.userId!)
    .maybeSingle();

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

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name || null;
  if (github_username !== undefined) updateData.github_username = github_username || null;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar' });
    return;
  }

  const { data: user, error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', req.userId!)
    .select('id, email, name, github_username')
    .single();

  if (error || !user) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
    return;
  }

  res.json({ user: { id: user.id, email: user.email, name: user.name, github_username: user.github_username ?? null } });
});

// PATCH /auth/linkedin — atualiza linkedin_data do usuário logado
router.patch('/linkedin', requireAuth, async (req: AuthRequest, res: Response) => {
  const { linkedInData } = req.body as { linkedInData: LinkedInData };

  if (!linkedInData) {
    res.status(400).json({ error: 'linkedInData é obrigatório' });
    return;
  }

  const { error } = await supabase
    .from('users')
    .update({ linkedin_data: linkedInData, name: linkedInData.name, phone: linkedInData.phone })
    .eq('id', req.userId!);

  if (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
    return;
  }

  res.json({ ok: true });
});

export default router;
