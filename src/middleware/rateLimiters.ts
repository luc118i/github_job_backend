import rateLimit from 'express-rate-limit';

// Rotas públicas pesadas (consomem créditos de IA) — 20 req/15min por IP.
// Compartilhado entre index.ts e rotas que precisam aplicar o limite a um
// path específico dentro de um router já montado sem o limiter global (ex:
// endpoints públicos de portfolio, que convivem com rotas autenticadas leves).
export const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde alguns minutos e tente novamente.' },
});
