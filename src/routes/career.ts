import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { CareerChatMessage, CareerProfile } from '../types';

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
    console.error('[career] erro:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

export default router;
