import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import type { PublicCertificateState } from '../../features/certificate/public';
import { fetchPublicCertificate } from '../api/public-certificate';

export const Route = createFileRoute('/certificados/$code')({ component: CertificateValidation });

const STATE: Record<PublicCertificateState, { title: string; text: string }> = {
  valid: {
    title: 'Certificado válido',
    text: 'Este certificado foi emitido e continua válido.',
  },
  revoked: {
    title: 'Certificado revogado',
    text: 'Este certificado foi revogado e não deve ser aceito.',
  },
  superseded: {
    title: 'Certificado substituído',
    text: 'Este certificado foi substituído por um mais recente e não vale mais.',
  },
};

const date = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));

/**
 * Validação pública de um certificado (M7-08), aberta a qualquer pessoa com o código. Mostra só o que é público: o
 * estado, o curso, a carga horária, a data de emissão e o emitente. Código desconhecido, malformado ou ainda não
 * emitido mostra a MESMA mensagem (não revela se o código existe). Os metadados de compartilhamento vêm do Worker.
 */
function CertificateValidation() {
  const { code } = Route.useParams();
  const result = useQuery({
    queryKey: ['public-certificate', code],
    queryFn: () => fetchPublicCertificate(code),
    retry: false,
    staleTime: 0,
  });

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold">Validação de certificado</h1>
      {result.isPending ? (
        <p role="status">Conferindo o certificado…</p>
      ) : result.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível conferir o certificado agora. Tente de novo em instantes.
        </p>
      ) : result.data.kind === 'limited' ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Muitas consultas em pouco tempo. Aguarde alguns minutos e tente de novo.
        </p>
      ) : result.data.kind === 'not_found' ? (
        <section aria-labelledby="nao-encontrado" className="grid max-w-prose gap-3">
          <h2 id="nao-encontrado" className="text-2xl font-semibold">
            Certificado não encontrado
          </h2>
          <p>
            Não encontramos um certificado com este código. Confira se o código foi digitado
            corretamente. Se o problema continuar, fale com o suporte da NeuroCapacitar.
          </p>
        </section>
      ) : (
        <section aria-labelledby="estado" className="grid max-w-prose gap-4">
          <h2 id="estado" className="text-2xl font-semibold">
            {STATE[result.data.dto.state].title}
          </h2>
          <p role="status">{STATE[result.data.dto.state].text}</p>
          <dl className="grid gap-3">
            {result.data.dto.holderName ? (
              <div>
                <dt className="font-medium">Titular</dt>
                <dd>{result.data.dto.holderName}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium">Curso</dt>
              <dd>{result.data.dto.courseTitle}</dd>
            </div>
            {result.data.dto.workloadHours ? (
              <div>
                <dt className="font-medium">Carga horária</dt>
                <dd>
                  {result.data.dto.workloadHours}{' '}
                  {result.data.dto.workloadHours === 1 ? 'hora' : 'horas'}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium">Data de emissão</dt>
              <dd>{date(result.data.dto.issuedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium">Emitido por</dt>
              <dd>{result.data.dto.issuerName}</dd>
            </div>
          </dl>
        </section>
      )}
      <p className="mt-8">
        <Link to="/" className="underline">
          Voltar ao início
        </Link>
      </p>
    </>
  );
}
