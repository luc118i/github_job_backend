import Groq from 'groq-sdk';
import { CareerChatMessage, CareerProfile } from '../types';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GROQ_MODELS = [
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.3-70b-versatile',
];

// OpenAI-style tool definition (Groq uses OpenAI API format)
const ANALYZE_PROFILE_TOOL: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'analyze_profile',
    description: 'Estrutura o perfil de carreira com base em toda a conversa.',
    parameters: {
      type: 'object',
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
  },
};

export async function sendCareerMessageGroq(
  messages: CareerChatMessage[],
  systemPrompt: string,
): Promise<{ message?: string; profile?: CareerProfile; done: boolean }> {
  if (!messages.length) throw new Error('messages não pode ser vazio');

  const apiMessages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  let lastErr: unknown;
  for (const model of GROQ_MODELS) {
    try {
      const response = await groq.chat.completions.create({
        model,
        max_tokens: 512,
        messages: apiMessages,
        tools: [ANALYZE_PROFILE_TOOL],
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('Groq retornou resposta vazia');

      // Check for tool call (profile finalized)
      const toolCall = choice.message.tool_calls?.find(
        (tc) => tc.function.name === 'analyze_profile',
      );

      if (toolCall) {
        const profile = JSON.parse(toolCall.function.arguments) as CareerProfile;
        console.log(`[career/groq] perfil finalizado via ${model}`);
        return { done: true, profile };
      }

      const text = choice.message.content ?? '';
      return { done: false, message: text };
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const status = (err as { status?: number }).status;
      const code = (err as { error?: { error?: { code?: string } } }).error?.error?.code ?? '';
      const retryable = status === 429 || status === 503 || code === 'model_decommissioned' || msg.includes('vazia') || msg.includes('JSON');
      if (retryable) {
        console.warn(`[career/groq] ${model} falhou (${msg}), tentando próximo...`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
