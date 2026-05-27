import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { CareerChatMessage, CareerProfile, LinkedInData } from '../types';
import { sendCareerMessageGemini } from '../services/gemini';

const router = Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

const ANALYZE_TOOL: Anthropic.Tool = {
  name: 'analyze_profile',
  description: 'Estrutura o perfil de carreira com base em toda a conversa.',
  input_schema: {
    type: 'object' as const,
    required: [
      'techLiteracy', 'leadershipLevel', 'workStyle',
      'desiredAreas', 'blockedAreas', 'hiddenSkills',
      'careerGoals', 'transitionReady', 'personalitySummary', 'potentialSummary',
    ],
    properties: {
      techLiteracy: {
        type: 'string',
        enum: ['basic', 'intermediate', 'advanced'],
        description: 'Nível de conforto com tecnologia e ferramentas digitais',
      },
      leadershipLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Capacidade e experiência de liderança',
      },
      workStyle: {
        type: 'array',
        items: { type: 'string', enum: ['analytical', 'creative', 'operational', 'relational'] },
        description: 'Perfil de trabalho predominante (pode ter mais de um)',
      },
      desiredAreas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Áreas, funções ou setores que o usuário quer explorar',
      },
      blockedAreas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Áreas, funções ou setores que o usuário não quer mais',
      },
      hiddenSkills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Habilidades reais não evidentes no currículo atual',
      },
      careerGoals: {
        type: 'string',
        description: 'Objetivo de carreira em 1 frase direta',
      },
      transitionReady: {
        type: 'boolean',
        description: 'Se o usuário está disposto a mudar de área profissional',
      },
      transitionTarget: {
        type: ['string', 'null'],
        description: 'Área alvo da transição, se aplicável',
      },
      personalitySummary: {
        type: 'string',
        description: 'Resumo do perfil comportamental em 1 frase objetiva',
      },
      potentialSummary: {
        type: 'string',
        description: 'Principal potencial não explorado identificado, em 1 frase',
      },
    },
  },
};

// Returns true for credit/billing errors and quota errors — use Gemini fallback
function shouldFallbackToGemini(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  const msg = (err.message ?? '').toLowerCase();
  return (
    err.status === 400 && (msg.includes('credit') || msg.includes('balance') || msg.includes('billing')) ||
    err.status === 429 ||
    err.status === 503
  );
}

// POST /career/message
// Body: { messages: CareerChatMessage[] }
// Returns: { message?: string, profile?: CareerProfile, done: boolean }
router.post('/message', async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: CareerChatMessage[] };

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages inválido' });
    return;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [ANALYZE_TOOL],
      tool_choice: { type: 'auto' },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'analyze_profile',
    );

    if (toolBlock) {
      const profile = toolBlock.input as CareerProfile;
      res.json({ profile, done: true });
      return;
    }

    res.json({ message: textBlock?.text ?? '', done: false });
  } catch (err) {
    if (shouldFallbackToGemini(err)) {
      console.warn('[career] Claude indisponível, usando Gemini como fallback...');
      try {
        const geminiResponse = await sendCareerMessageGemini(messages, SYSTEM_PROMPT);
        if (geminiResponse.done && geminiResponse.profile) {
          res.json({ profile: geminiResponse.profile, done: true });
          return;
        }
        res.json({ message: geminiResponse.message ?? '', done: false });
        return;
      } catch (geminiErr) {
        console.error('[career] Gemini fallback também falhou:', geminiErr);
      }
    }
    console.error('[career] erro:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

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

// POST /career/refine
// Body: { profile: CareerProfile, messages: CareerChatMessage[], linkedIn?: LinkedInData }
// Returns: { message?: string, profile?: CareerProfile, done: boolean }
router.post('/refine', async (req: Request, res: Response) => {
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
  const apiMessages = messages.length > 0
    ? messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : [{ role: 'user' as const, content: 'pode iniciar a análise do meu perfil' }];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: buildRefineSystemPrompt(profile, linkedIn),
      tools: [ANALYZE_TOOL],
      tool_choice: { type: 'auto' },
      messages: apiMessages,
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'analyze_profile',
    );

    if (toolBlock) {
      const updated = toolBlock.input as CareerProfile;
      res.json({ profile: updated, done: true });
      return;
    }

    res.json({ message: textBlock?.text ?? '', done: false });
  } catch (err) {
    if (shouldFallbackToGemini(err)) {
      console.warn('[career/refine] Claude indisponível, usando Gemini como fallback...');
      const systemPrompt = buildRefineSystemPrompt(profile, linkedIn);
      // Use same messages that would have gone to Claude (with trigger if empty)
      const geminiMessages: CareerChatMessage[] = messages.length > 0
        ? messages
        : [{ role: 'user', content: 'pode iniciar a análise do meu perfil' }];
      try {
        const geminiResponse = await sendCareerMessageGemini(geminiMessages, systemPrompt);
        if (geminiResponse.done && geminiResponse.profile) {
          res.json({ profile: geminiResponse.profile, done: true });
          return;
        }
        res.json({ message: geminiResponse.message ?? '', done: false });
        return;
      } catch (geminiErr) {
        console.error('[career/refine] Gemini fallback também falhou:', geminiErr);
      }
    }
    console.error('[career/refine] erro:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

export default router;
