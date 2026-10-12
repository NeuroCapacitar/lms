import { richTextFromParagraph, type RichText } from '../content/rich-text';
import type { SequenceMode } from './catalog';

/**
 * Curso demonstrativo (M2-07): conteúdo 100% SINTÉTICO, sem nome, e-mail, marca ou texto real. Um só
 * lugar descreve o curso; o seed de Dev/Staging e as fixtures dos testes usam os mesmos dados, e a
 * jornada do M3 (acesso, drip, progresso) parte dele. Puro: sem banco nem relógio.
 */
export const DEMO_SLUG = 'curso-demonstrativo';
export const DEMO_TITLE = 'Curso Demonstrativo';
export const DEMO_SEQUENCE_MODE: SequenceMode = 'guided';

/** Oferta gratuita com prazo (toda oferta tem prazo; sem acesso vitalício). */
export const DEMO_OFFER = {
  name: 'Acesso de demonstração',
  kind: 'free',
  priceCents: 0,
  accessMonths: 3,
  maxInstallments: 1,
} as const;

interface DemoLesson {
  title: string;
  isOptional: boolean;
  body: RichText;
}
interface DemoModule {
  title: string;
  /** D+N: dias após a âncora de acesso em que o módulo libera. */
  dripDays: number;
  lessons: DemoLesson[];
}

const lesson = (title: string, text: string, isOptional = false): DemoLesson => ({
  title,
  isOptional,
  body: richTextFromParagraph(text),
});

export const DEMO_DRAFT: {
  details: { displayTitle: string; description: RichText; workloadHours: number };
  modules: DemoModule[];
} = {
  details: {
    displayTitle: DEMO_TITLE,
    description: richTextFromParagraph(
      'Curso de demonstração com conteúdo sintético, usado para conferir a plataforma de ponta a ponta.',
    ),
    workloadHours: 3,
  },
  modules: [
    {
      title: 'Primeiros passos',
      dripDays: 0,
      lessons: [
        lesson(
          'Boas-vindas',
          'Texto de exemplo da primeira aula. Este módulo libera no primeiro dia.',
        ),
        lesson('Como estudar aqui', 'Texto de exemplo sobre a rotina de estudo na plataforma.'),
      ],
    },
    {
      title: 'Aprofundando',
      dripDays: 7,
      lessons: [
        lesson(
          'Conceito central',
          'Texto de exemplo do conceito central. Libera 7 dias após o acesso.',
        ),
        lesson(
          'Leitura complementar',
          'Texto de exemplo opcional, que não bloqueia o avanço.',
          true,
        ),
      ],
    },
    {
      title: 'Fechamento',
      dripDays: 14,
      lessons: [
        lesson('Revisão', 'Texto de exemplo da revisão. Libera 14 dias após o acesso.'),
        lesson('Próximos passos', 'Texto de exemplo de encerramento do curso demonstrativo.'),
      ],
    },
  ],
};
