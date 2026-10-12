import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * Em que modo as telas de estudo estão: o aluno (`/estudar`, com acesso, drip e progresso) ou a prévia
 * da Staff (`/staff/previa`, só leitura, tudo liberado, nada gravado). As MESMAS telas servem aos dois;
 * só mudam a fonte dos dados e para onde os links apontam.
 */
export interface StudyMode {
  preview: boolean;
  courseId: string;
}

export function OutlineLink({ mode, children }: { mode: StudyMode; children: ReactNode }) {
  return mode.preview ? (
    <Link to="/staff/previa/$courseId" params={{ courseId: mode.courseId }}>
      {children}
    </Link>
  ) : (
    <Link to="/estudar/$courseId" params={{ courseId: mode.courseId }}>
      {children}
    </Link>
  );
}

export function LessonLink({
  mode,
  lessonId,
  children,
}: {
  mode: StudyMode;
  lessonId: string;
  children: ReactNode;
}) {
  return mode.preview ? (
    <Link
      to="/staff/previa/$courseId/aulas/$lessonId"
      params={{ courseId: mode.courseId, lessonId }}
    >
      {children}
    </Link>
  ) : (
    <Link to="/estudar/$courseId/aulas/$lessonId" params={{ courseId: mode.courseId, lessonId }}>
      {children}
    </Link>
  );
}

/**
 * Faixa FIXA da prévia: a Staff nunca confunde a prévia com a conta de um aluno. É uma região com
 * nome (leitor de tela a encontra) e fica visível ao rolar.
 */
export function PreviewBanner() {
  return (
    <div
      role="region"
      aria-label="Aviso de prévia"
      className="sticky top-0 z-10 mb-6 rounded-lg border border-[var(--border-control)] bg-[var(--surface-raised)] px-4 py-3 font-medium"
    >
      Prévia — nada é gravado.
    </div>
  );
}
