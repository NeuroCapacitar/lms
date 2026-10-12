import { Link } from '@tanstack/react-router';

import { formatAccessDate } from '../../features/access/format';
import type { LessonLockReason } from '../../features/access/lesson-access';
import type { DeniedReason, StudyResult } from '../api/learning';

/** Por que uma aula não abre, em português. */
export function lockMessage(reason: LessonLockReason, releasesAt: string | null): string {
  switch (reason) {
    case 'drip_locked':
      return releasesAt ? `Libera em ${formatAccessDate(releasesAt)}.` : 'Ainda não liberada.';
    case 'sequence_locked':
      return 'Conclua as aulas obrigatórias anteriores para abrir esta aula.';
    case 'expired':
      return 'Seu acesso a este curso terminou.';
    case 'suspended':
      return 'Seu acesso a este curso está suspenso. Fale com o suporte.';
    case 'no_access':
      return 'Você não está inscrito neste curso.';
    case 'retired':
      return 'Esta aula não está mais disponível.';
  }
}

const DENIED: Record<DeniedReason, string> = {
  no_access: 'Você não está inscrito neste curso.',
  expired: 'Seu acesso a este curso terminou. Inscreva-se de novo para continuar de onde parou.',
  suspended: 'Seu acesso a este curso está suspenso. Fale com o suporte.',
};

/**
 * Avisos de uma tela de estudo quando a resposta NÃO é `ok`: sem sessão, termos, sem acesso, não
 * encontrado. Devolve `null` quando o resultado é `ok` (ou aula bloqueada, que cada tela trata).
 */
export function StudyNotice<T>({ result, returnTo }: { result: StudyResult<T>; returnTo: string }) {
  if (result.kind === 'unauthenticated') {
    return (
      <p role="alert" className="max-w-prose">
        Entre na sua conta para estudar.{' '}
        <Link to="/entrar" search={{ returnTo }} className="underline">
          Entrar
        </Link>
      </p>
    );
  }
  if (result.kind === 'terms_required') {
    return (
      <p role="alert" className="max-w-prose">
        Aceite os Termos de Uso e a Política de Privacidade em{' '}
        <Link to="/conta" className="underline">
          Minha conta
        </Link>{' '}
        para continuar.
      </p>
    );
  }
  if (result.kind === 'forbidden') {
    return (
      <p role="alert" className="max-w-prose">
        Esta área é só da equipe.
      </p>
    );
  }
  if (result.kind === 'denied') {
    return (
      <div className="grid max-w-prose gap-3">
        <p role="alert">{DENIED[result.reason]}</p>
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </div>
    );
  }
  if (result.kind === 'not_found') {
    return (
      <div className="grid max-w-prose gap-3">
        <p role="alert">Este conteúdo não existe ou não está disponível.</p>
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </div>
    );
  }
  return null;
}
