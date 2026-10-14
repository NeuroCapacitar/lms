import { createAsaasCheckoutProvider } from './asaas-client';
import type { CheckoutProvider } from './checkout-provider';
import { createAsaasPaymentReader } from './payment-reader';
import type { PaymentReader } from './payment-reader';

const DEFAULT_ASAAS_BASE_URL = 'https://api-sandbox.asaas.com';

type AsaasEnv = Pick<Env, 'ASAAS_API_KEY' | 'ASAAS_API_BASE_URL'>;

function credentials(env: AsaasEnv): { apiKey: string; baseUrl: string } | undefined {
  const apiKey = env.ASAAS_API_KEY?.trim();
  if (!apiKey) return undefined;
  return { apiKey, baseUrl: env.ASAAS_API_BASE_URL?.trim() || DEFAULT_ASAAS_BASE_URL };
}

/** O provider de checkout do ambiente: sem `ASAAS_API_KEY` não há compra (`undefined`, 503), nunca "meio configurada". */
export function checkoutProviderFor(env: AsaasEnv): CheckoutProvider | undefined {
  const found = credentials(env);
  return found ? createAsaasCheckoutProvider(found) : undefined;
}

/** O leitor de pagamentos do ambiente. Sem a chave, os eventos do Asaas ficam `pending` na inbox (sem handler). */
export function paymentReaderFor(env: AsaasEnv): PaymentReader | undefined {
  const found = credentials(env);
  return found ? createAsaasPaymentReader(found) : undefined;
}
