import { Router, Response } from 'express';
import { CareerChatMessage, CareerProfile, LinkedInData } from '../types';
import { sendCareerMessageGroq } from '../services/groq';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { supabase } from '../services/supabase';

const router = Router();

const SYSTEM_PROMPT = `Você é um consultor de carreira especialista em desenvolvimento humano e transição profissional. Seu objetivo é entender o potencial real do usuário além do currículo.

Conduza uma conversa breve, empática e direta em português. Faça UMA pergunta por vez. Respostas curtas, máximo 2 frases. Sem listas, sem marcadores, sem formatação markdown.

Regras para as perguntas:
- Sejam concretas e fáceis de responder — nunca vagas ou filosóficas
- Prefira perguntas com opções claras: "X ou Y?" quando fizer sentido
- Nunca presuma que a pessoa quer mudar de área — descubra isso primeiro
- Adapte o tom com base nas respostas anteriores

Siga esta sequência de temas (adapte com base nas respostas, mas cubra todos):
1. Se está satisfeito na área atual ou quer explorar algo diferente — isso define tudo o que vem depois
2. Habilidades e capacidades que o currículo não mostra bem
3. Se quer mudar: qual área ou função deseja, mesmo sem experiência formal. Se não quer: o que busca na próxima oportunidade
4. Áreas ou tipos de trabalho que definitivamente não quer mais fazer
5. Estilo de trabalho: analítico (dados/problemas), criativo (inovação/design), operacional (processos/execução) ou relacional (pessoas/comunicação) — pode ser mais de um
6. Experiências de liderança, mesmo informais
7. Nível de conforto com tecnologia e ferramentas digitais

Após cobrir os 7 temas (geralmente 7 a 10 trocas), chame analyze_profile para estruturar o perfil. Não avise que vai chamar a função — apenas chame.`;

// ── Helpers for /refine ───────────────────────────────────────────

const WORK_STYLE_PT: Record<string, string> = {
  analytical: 'analítico', creative: 'criativo',
  operational: 'operacional', relational: 'relacional',
};
const TECH_PT: Record<string, string> = { basic: 'básico', intermediate: 'intermediário', advanced: 'avançado' };
const LEADERSHIP_PT: Record<string, string> = { low: 'baixa', medium: 'moderada', high: 'alta' };

function buildRefineSystemPrompt(profile: CareerProfile, linkedIn?: LinkedInData): string {
  const lines = [
    `Objetivo: ${profile.careerGoals}`,
    `Perfil comportamental: ${profile.personalitySummary}`,
    `Estilo de trabalho: ${profile.workStyle.map((s) => WORK_STYLE_PT[s] ?? s).join(', ')}`,
    `Liderança: ${LEADERSHIP_PT[profile.leadershipLevel] ?? profile.leadershipLevel}`,
    `Tecnologia: ${TECH_PT[profile.techLiteracy] ?? profile.techLiteracy}`,
    profile.desiredAreas.length ? `Quer explorar: ${profile.desiredAreas.join(', ')}` : 'Nenhuma área de interesse registrada',
    profile.blockedAreas.length ? `Não quer mais: ${profile.blockedAreas.join(', ')}` : null,
    profile.hiddenSkills.length ? `Habilidades ocultas: ${profile.hiddenSkills.join(', ')}` : null,
    profile.transitionReady && profile.transitionTarget
      ? `Em transição para: ${profile.transitionTarget}`
      : 'Não está em transição de carreira',
    profile.potentialSummary ? `Potencial identificado: ${profile.potentialSummary}` : null,
  ].filter(Boolean).join('\n');

  const liContext = linkedIn?.positions?.length
    ? '\n\nHistórico profissional (LinkedIn):\n' +
      linkedIn.positions.slice(0, 3)
        .map((p) => `- ${p.title} na ${p.company}${p.finishedOn ? '' : ' (atual)'}`)
        .join('\n')
    : '';

  return `Você é um consultor de carreira. O usuário já completou uma análise inicial e você tem o perfil estruturado abaixo. Sua missão agora é refinar esse perfil através de uma conversa.

PERFIL ATUAL:
${lines}${liContext}

Seu papel nesta sessão:
1. Abrir com uma leitura rápida do perfil: o que se destaca e o que parece vago ou incompleto
2. Fazer perguntas específicas para refinar pontos ambíguos ou descobrir aspectos novos
3. Dar feedback concreto: "com esse perfil, você tende a se encaixar bem em X porque Y"
4. Sugerir tipos de vaga ou áreas que combinam com o perfil atual
5. Chamar analyze_profile quando tiver novas informações para atualizar 2+ campos OU quando o usuário sinalizar que terminou

Regras:
- Uma mensagem por vez, máximo 2 frases
- Sem markdown, sem listas, sem formatação
- Preserve todos os campos do perfil original que não foram discutidos
- Chame analyze_profile ao final com o perfil completo e atualizado`;
}

// POST /career/message
// Body: { messages: CareerChatMessage[] }
// Returns: { message?: string, profile?: CareerProfile, done: boolean }
router.post('/message', async (req: AuthRequest, res: Response) => {
  const { messages } = req.body as { messages: CareerChatMessage[] };

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages inválido' });
    return;
  }

  try {
    const result = await sendCareerMessageGroq(messages, SYSTEM_PROMPT);
    if (result.done && result.profile) {
      res.json({ profile: result.profile, done: true });
      return;
    }
    res.json({ message: result.message ?? '', done: false });
  } catch (err) {
    console.error('[career] erro:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

// POST /career/refine
// Body: { profile: CareerProfile, messages: CareerChatMessage[], linkedIn?: LinkedInData }
// Returns: { message?: string, profile?: CareerProfile, done: boolean }
router.post('/refine', async (req: AuthRequest, res: Response) => {
  const { profile, messages = [], linkedIn } = req.body as {
    profile: CareerProfile;
    messages: CareerChatMessage[];
    linkedIn?: LinkedInData;
  };

  if (!profile) {
    res.status(400).json({ error: 'profile obrigatório' });
    return;
  }

  // If no messages yet, send a silent trigger so the AI opens the conversation
  const groqMessages: CareerChatMessage[] = messages.length > 0
    ? messages
    : [{ role: 'user', content: 'pode iniciar a análise do meu perfil' }];

  try {
    const result = await sendCareerMessageGroq(groqMessages, buildRefineSystemPrompt(profile, linkedIn));
    if (result.done && result.profile) {
      res.json({ profile: result.profile, done: true });
      return;
    }
    res.json({ message: result.message ?? '', done: false });
  } catch (err) {
    console.error('[career/refine] erro:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

// GET /career/profile — retorna o perfil salvo do usuário autenticado
router.get('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select('career_profile')
    .eq('id', req.userId!)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
    return;
  }

  res.json({ profile: (data as { career_profile?: CareerProfile | null })?.career_profile ?? null });
});

// PUT /career/profile — salva ou atualiza o perfil do usuário autenticado
router.put('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const { profile } = req.body as { profile: CareerProfile | null };

  const { error } = await supabase
    .from('users')
    .update({ career_profile: profile ?? null })
    .eq('id', req.userId!);

  if (error) {
    console.error('[career/profile] erro ao salvar:', error);
    res.status(500).json({ error: 'Erro ao salvar perfil' });
    return;
  }

  res.json({ ok: true });
});

export default router;
