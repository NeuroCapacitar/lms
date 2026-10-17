import type { Capability } from './capabilities';

/**
 * Matriz capacidade × tela × endpoint da Staff (M9-01, passo 1). É o CONTRATO declarado: o teste `test/pg/staff-matrix.pg.test.ts`
 * confere que (1) toda rota `/api/staff/*` registrada tem uma linha aqui e nenhuma linha sobra, (2) cada linha nega sem sessão (401),
 * a quem não é da Staff, à conta suspensa e ao Suporte sem o grant (403), e deixa passar quem tem a capacidade, e (3) o que exige
 * reautenticação recente a pede. `docs/spec/staff-matrix.md` repete esta tabela para leitura (o teste confere que não divergem).
 * A interface só MOSTRA conforme isto; quem decide é o servidor.
 */
type StaffRequirement =
  /** Só sessão (aceitar convite): a autorização é o e-mail do convite, conferido no caso de uso. */
  | { kind: 'session' }
  | { kind: 'capability'; capability: Capability }
  /** Basta UMA das capacidades (a lista de certificados serve a quem emite, reemite ou opera a fila). */
  | { kind: 'any'; capabilities: readonly Capability[] };

export interface StaffEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Igual ao caminho registrado no Hono, com `:parâmetros`. */
  path: string;
  requires: StaffRequirement;
  /** Exige prova de reautenticação RECENTE da sessão (403 `reauth_required` sem ela). */
  reauth: boolean;
  /** Tela da Staff que usa o endpoint (`null` = nenhuma tela). */
  screen: string | null;
}

const cap = (capability: Capability): StaffRequirement => ({ kind: 'capability', capability });

function row(
  method: StaffEndpoint['method'],
  path: string,
  requires: StaffRequirement,
  screen: string | null,
  reauth = false,
): StaffEndpoint {
  return { method, path, requires, reauth, screen: screen };
}

const EQUIPE = '/staff/equipe';
const CURSOS = '/staff/cursos';
const CURSO = '/staff/cursos/$courseId';
const CERTIFICADOS = '/staff/certificados';
const HELP = '/staff/ajuda';
const BANNERS = '/staff/banners';
const VIDEOS = '/staff/videos';
const FINANCE = '/staff/financeiro';
const OPS = '/staff/operacao';

export const STAFF_ENDPOINTS: readonly StaffEndpoint[] = [
  // Equipe: convites, papéis e grants (só Admin; escritas com reautenticação).
  row('GET', '/api/staff/invitations', cap('staff.manage'), EQUIPE),
  row('POST', '/api/staff/invitations', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/invitations/:id/resend', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/invitations/:id/revoke', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/users/:id/suspend', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/users/:id/reactivate', cap('staff.manage'), EQUIPE, true),
  row('GET', '/api/staff/team', cap('staff.manage'), EQUIPE),
  row('POST', '/api/staff/users/:id/grants', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/users/:id/grants/revoke', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/users/:id/support/revoke', cap('staff.manage'), EQUIPE, true),
  row('POST', '/api/staff/invitations/accept', { kind: 'session' }, '/convite'),

  // Prévia de aluno (não grava progresso).
  row(
    'GET',
    '/api/staff/preview/courses/:id/outline',
    cap('staff.read'),
    '/staff/previa/$courseId',
  ),
  row(
    'GET',
    '/api/staff/preview/courses/:id/lessons/:lessonId',
    cap('staff.read'),
    '/staff/previa/$courseId/aulas/$lessonId',
  ),

  // Inscritos e acesso.
  row('GET', '/api/staff/courses/:courseId/enrollments', cap('staff.read'), CURSO),
  row('POST', '/api/staff/enrollments', cap('access.grant'), CURSO),
  row(
    'POST',
    '/api/staff/courses/:courseId/enrollments/:userId/suspend',
    cap('access.grant'),
    CURSO,
  ),
  row(
    'POST',
    '/api/staff/courses/:courseId/enrollments/:userId/reinstate',
    cap('access.grant'),
    CURSO,
  ),
  row('POST', '/api/staff/entitlements/:id/adjust', cap('enrollment.support_edit'), CURSO),

  // Catálogo e currículo.
  row('GET', '/api/staff/courses', cap('staff.read'), CURSOS),
  row('POST', '/api/staff/courses', cap('course.create'), CURSOS),
  row('GET', '/api/staff/courses/:id', cap('staff.read'), CURSO),
  row('PATCH', '/api/staff/courses/:id', cap('course.edit'), CURSO),
  row('POST', '/api/staff/courses/:id/status', cap('course.edit'), CURSO),
  row('POST', '/api/staff/courses/:id/offers', cap('offer.manage'), CURSO),
  row('PATCH', '/api/staff/courses/:id/offers/:offerId', cap('offer.manage'), CURSO),
  row('POST', '/api/staff/courses/:id/offers/:offerId/status', cap('offer.manage'), CURSO),
  row('GET', '/api/staff/courses/:id/draft', cap('staff.read'), CURSO),
  row('PUT', '/api/staff/courses/:id/draft', cap('course.edit'), CURSO),
  row('POST', '/api/staff/courses/:id/publish', cap('course.edit'), CURSO),
  row('GET', '/api/staff/courses/:id/publish-preview', cap('staff.read'), CURSO),
  row('GET', '/api/staff/courses/:id/interests', cap('staff.read'), CURSO),

  // Operação.
  row('GET', '/api/staff/operations', cap('staff.read'), OPS),
  row('POST', '/api/staff/operations/outbox/:id/requeue', cap('ops.queue'), OPS, true),
  row('POST', '/api/staff/operations/queues/:lane/pause', cap('system.maintenance'), OPS, true),

  // Vídeo (credenciais de integração; só Admin).
  row('GET', '/api/staff/video/connections', cap('integration.credentials'), VIDEOS),
  row('GET', '/api/staff/video/providers', cap('integration.credentials'), VIDEOS),
  row('POST', '/api/staff/video/connections', cap('integration.credentials'), VIDEOS, true),
  row(
    'PUT',
    '/api/staff/video/connections/:id/secret',
    cap('integration.credentials'),
    VIDEOS,
    true,
  ),
  row(
    'POST',
    '/api/staff/video/connections/:id/disable',
    cap('integration.credentials'),
    VIDEOS,
    true,
  ),
  row(
    'POST',
    '/api/staff/video/connections/:id/enable',
    cap('integration.credentials'),
    VIDEOS,
    true,
  ),
  row('POST', '/api/staff/video/rekey', cap('integration.credentials'), VIDEOS, true),

  // Financeiro.
  row('GET', '/api/staff/finance/reviews', cap('finance.review'), FINANCE),
  row('POST', '/api/staff/finance/reviews/:id/resolve', cap('finance.review'), FINANCE),
  row('POST', '/api/staff/finance/orders/:id/refund', cap('refund.execute'), FINANCE, true),
  row('GET', '/api/staff/finance/orders', cap('finance.view'), FINANCE),
  row(
    'POST',
    '/api/staff/finance/payments/:id/reveal-document',
    cap('finance.view'),
    FINANCE,
    true,
  ),
  row('GET', '/api/staff/finance/refunds', cap('refund.execute'), FINANCE),

  // Ajuda e FAQ.
  row('GET', '/api/staff/help/faq', cap('help.edit'), HELP),
  row('POST', '/api/staff/help/faq', cap('help.edit'), HELP),
  row('PUT', '/api/staff/help/faq/:id', cap('help.edit'), HELP),
  row('POST', '/api/staff/help/faq/:id/state', cap('help.edit'), HELP),
  row('POST', '/api/staff/help/faq/:id/move', cap('help.edit'), HELP),
  row('POST', '/api/staff/help/faq/:id/delete', cap('help.edit'), HELP),
  row('GET', '/api/staff/help/requests', cap('staff.read'), HELP),

  // Banners (só Admin).
  row('GET', '/api/staff/banners', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/panel', cap('staff.manage'), BANNERS),
  row('PUT', '/api/staff/banners/panel/:id', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/panel/:id/state', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/panel/:id/move', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/panel/:id/delete', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/login', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/login/:id/state', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/login/:id/move', cap('staff.manage'), BANNERS),
  row('POST', '/api/staff/banners/login/:id/delete', cap('staff.manage'), BANNERS),

  // Certificados: emitente, signatário e modelo (só Admin, por `staff.manage` como proxy de "só Admin")...
  row('GET', '/api/staff/certificate/issuer', cap('staff.manage'), CERTIFICADOS),
  row('PUT', '/api/staff/certificate/issuer', cap('staff.manage'), CERTIFICADOS),
  row(
    'GET',
    '/api/staff/courses/:courseId/certificate/signatory',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  row(
    'PUT',
    '/api/staff/courses/:courseId/certificate/signatory',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  row(
    'GET',
    '/api/staff/courses/:courseId/certificate/template',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  row(
    'PUT',
    '/api/staff/courses/:courseId/certificate/template',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  row(
    'POST',
    '/api/staff/courses/:courseId/certificate/template/publish',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  row(
    'POST',
    '/api/staff/courses/:courseId/certificate/template/discard',
    cap('staff.manage'),
    `${CERTIFICADOS}/$courseId`,
  ),
  // ...e os certificados emitidos: ver (quem emite, reemite ou opera a fila), revogar (só Admin), reemitir e repetir.
  row(
    'GET',
    '/api/staff/certificates',
    { kind: 'any', capabilities: ['staff.manage', 'certificate.reissue', 'ops.queue'] },
    `${CERTIFICADOS}/emitidos`,
  ),
  row(
    'POST',
    '/api/staff/certificates/:id/revoke',
    cap('staff.manage'),
    `${CERTIFICADOS}/emitidos`,
    true,
  ),
  row(
    'POST',
    '/api/staff/certificates/:id/reissue',
    cap('certificate.reissue'),
    `${CERTIFICADOS}/emitidos`,
  ),
  row('POST', '/api/staff/certificates/:id/retry', cap('ops.queue'), `${CERTIFICADOS}/emitidos`),

  // Discussões.
  row('GET', '/api/staff/discussions', cap('discussion.moderate'), '/staff/discussoes'),
  row(
    'POST',
    '/api/staff/discussions/posts/:id/reply',
    cap('discussion.moderate'),
    '/staff/discussoes',
  ),
  row(
    'POST',
    '/api/staff/discussions/posts/:id/moderate',
    cap('discussion.moderate'),
    '/staff/discussoes',
  ),
  row(
    'POST',
    '/api/staff/discussions/posts/:id/dismiss',
    cap('discussion.moderate'),
    '/staff/discussoes',
  ),
];
