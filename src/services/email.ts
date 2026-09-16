// Envio de e-mail via Resend (https://resend.com). API HTTP simples — sem SDK,
// sem SMTP. Requer RESEND_API_KEY e EMAIL_FROM no .env.

const RESEND_API_URL = 'https://api.resend.com/emails';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // Dev sem Resend configurado: loga o conteúdo em vez de enviar, pra não travar o fluxo.
    console.warn(`[email] RESEND_API_KEY/EMAIL_FROM não configurados — e-mail não enviado para ${to}.\n${html}`);
    return;
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar e-mail via Resend (${res.status}): ${body}`);
  }
}

export function buildResetPasswordEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'Redefinir sua senha — GitHub Job Finder',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin-bottom: 8px;">Redefinir sua senha</h2>
        <p>Recebemos um pedido para redefinir a senha da sua conta no GitHub Job Finder.</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; background: #7c3aed; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Redefinir senha
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">Esse link expira em 1 hora. Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>
      </div>
    `,
  };
}
