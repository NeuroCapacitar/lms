/**
 * Verifica no Resend se os modelos de e-mail do contrato existem, estão publicados e declaram as variáveis
 * certas (M4-04). Só LÊ (`GET /templates/:alias`); não envia e-mail. A chave sai do ambiente e nunca é
 * impressa; use a chave do ambiente que está sendo verificado (Staging ou Production).
 *
 *   RESEND_API_KEY=... bun scripts/verify-email-templates.ts
 */
import { verifyTemplates } from '../src/server/email/verify-templates.ts';

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error('RESEND_API_KEY não definida (use a chave do ambiente verificado).');
  process.exit(2);
}

const problems = await verifyTemplates({ apiKey });
if (problems.length === 0) {
  console.log('modelos de e-mail conferem com o contrato');
} else {
  for (const { template, problem } of problems) console.error(`${template}: ${problem}`);
  process.exit(1);
}
