import { z } from 'zod';

import { DELEGABLE_CAPABILITIES } from './capabilities';

/** Uma pessoa da Staff como a tela de equipe a recebe. Só o Admin (`staff.manage`) a obtém. */
export interface TeamMemberDto {
  id: string;
  name: string;
  email: string;
  roles: ('support' | 'admin')[];
  /** Capabilities delegáveis ativas (o Admin tem todas por papel, não por grant). */
  grants: string[];
  suspended: boolean;
}

/** Corpo de `POST /api/staff/users/:id/grants` e de `.../grants/revoke`: uma capability delegável. */
export const grantBodySchema = z.strictObject({
  capability: z.enum(DELEGABLE_CAPABILITIES),
});

/** Rótulos em português das capabilities delegáveis (a interface; o servidor só usa os códigos). */
export const CAPABILITY_LABELS: Record<(typeof DELEGABLE_CAPABILITIES)[number], string> = {
  'course.edit': 'Editar cursos (módulos, aulas, quizzes e publicar)',
  'access.grant': 'Matricular e suspender acesso a curso',
  'enrollment.support_edit': 'Ajustar matrículas no suporte',
  'refund.execute': 'Executar reembolsos',
  'finance.review': 'Revisar pendências financeiras',
  'finance.view': 'Ver o financeiro',
  'certificate.reissue': 'Reemitir certificados',
  'discussion.moderate': 'Moderar discussões',
  'help.edit': 'Editar a central de ajuda',
  'audit.view': 'Ver a auditoria',
  'ops.queue': 'Operar filas e tarefas',
};
