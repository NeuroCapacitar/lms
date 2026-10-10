/**
 * Catálogo de papéis e capabilities (ADR 0008, docs/spec/domain.md). Puro: sem rede nem banco.
 * Deny-by-default: o que não está liberado aqui é negado. A UI nunca autoriza; o servidor sim.
 *
 * Nomes: seguem o spec de domínio (`access.grant`, não `enrollment.manage`). O catálogo é contrato
 * da modelagem e é conferido contra o CHECK do banco por teste (test/pg/access.pg.test.ts).
 */
export const ROLES = ['support', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Só o Admin tem; nunca delegáveis por grant. */
export const ADMIN_ONLY_CAPABILITIES = [
  'course.create',
  'offer.manage',
  'certificate.template',
  'certificate.revoke',
  'staff.manage',
  'integration.credentials',
  'system.maintenance',
] as const;

/** O Admin pode conceder ao Suporte, uma a uma (tabela `staff_grant`). */
export const DELEGABLE_CAPABILITIES = [
  'course.edit',
  'access.grant',
  'enrollment.support_edit',
  'refund.execute',
  'finance.review',
  'finance.view',
  'certificate.reissue',
  'discussion.moderate',
  'help.edit',
  'audit.view',
  'ops.queue',
] as const;

/**
 * Leitura básica da área da Staff (ver inscritos, cursos e fila; prévia de aluno; responder pedidos
 * de suporte). Todo Suporte e todo Admin ativo têm, sem grant.
 */
export const STAFF_READ = 'staff.read' as const;

type AdminOnlyCapability = (typeof ADMIN_ONLY_CAPABILITIES)[number];
export type DelegableCapability = (typeof DELEGABLE_CAPABILITIES)[number];
export type Capability = AdminOnlyCapability | DelegableCapability | typeof STAFF_READ;

export const ALL_CAPABILITIES: readonly Capability[] = [
  ...ADMIN_ONLY_CAPABILITIES,
  ...DELEGABLE_CAPABILITIES,
  STAFF_READ,
];

export function isDelegable(value: string): value is DelegableCapability {
  return (DELEGABLE_CAPABILITIES as readonly string[]).includes(value);
}

/** Quem a pessoa é, para decidir acesso: carregado do banco a CADA requisição. */
export interface AccessContext {
  userId: string;
  /** Conta suspensa: nega tudo, mesmo com papel e grants. */
  suspended: boolean;
  roles: ReadonlySet<Role>;
  grants: ReadonlySet<DelegableCapability>;
}

/**
 * Decide se a pessoa pode usar a capability.
 * Suspensa: nunca. Admin: todas. Suporte: leitura básica e só os grants recebidos. Student (sem
 * papel): nenhuma capability de Staff.
 */
export function hasCapability(context: AccessContext, capability: Capability): boolean {
  if (context.suspended) return false;
  if (context.roles.has('admin')) return true;
  if (!context.roles.has('support')) return false;
  if (capability === STAFF_READ) return true;
  return isDelegable(capability) && context.grants.has(capability);
}

/** Lista as capabilities efetivas (para a interface decidir o que mostrar; não autoriza nada). */
export function effectiveCapabilities(context: AccessContext): Capability[] {
  return ALL_CAPABILITIES.filter((capability) => hasCapability(context, capability));
}
