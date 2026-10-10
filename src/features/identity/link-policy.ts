/**
 * Regras do pedido de link de acesso (M1-06). Os valores são PROPOSTOS e precisam de confirmação do
 * responsável antes de fixar (docs/tasks/M1-identidade.md). Puro: sem rede nem banco.
 */
export interface LinkLimits {
  perEmail: { max: number; windowSeconds: number };
  perIp: { max: number; windowSeconds: number };
  globalPerDay: number;
  linkTtlSeconds: number;
}

export const LINK_LIMITS: LinkLimits = {
  /** Pedidos por e-mail (qualquer IP) numa janela. */
  perEmail: { max: 3, windowSeconds: 10 * 60 },
  /** Pedidos por IP numa janela. */
  perIp: { max: 10, windowSeconds: 10 * 60 },
  /**
   * Teto diário global de links. O Resend Free envia 100 e-mails/dia: o restante fica reservado
   * aos e-mails transacionais (compra, certificado), que nunca passam por este teto.
   */
  globalPerDay: 60,
  /** Validade do link. */
  linkTtlSeconds: 15 * 60,
};

export interface DeliveryFacts {
  /** Já existe um usuário com este e-mail. */
  userExists: boolean;
  /** O e-mail pertence à Staff (papel ou convite). */
  isStaffEmail: boolean;
  /** A conta existe e está suspensa: um link não serviria (o login é recusado), então não se envia. */
  isSuspended: boolean;
}

/**
 * Decide se o link é enviado. Quem não existe e não é Staff vira aluno novo. E-mail de Staff só
 * recebe link se o usuário JÁ existir (foi criado pelo convite): nunca cria conta por cadastro livre.
 * A resposta HTTP é a mesma nos dois casos; só o envio muda.
 */
export function decideDelivery(facts: DeliveryFacts): 'send' | 'skip' {
  if (facts.isSuspended) return 'skip';
  if (facts.isStaffEmail && !facts.userExists) return 'skip';
  return 'send';
}

export interface EmailMessage {
  to: string;
  /** Identificador do modelo hospedado (Resend Hosted Templates). */
  template: 'magic-link' | 'reauth-link' | 'staff-invitation';
  variables: Record<string, string>;
  /** Evita envio duplicado em reenvio de rede (o mesmo valor devolve o mesmo resultado). */
  idempotencyKey: string;
}

/** Porta de saída de e-mail: o domínio não conhece o provedor. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
