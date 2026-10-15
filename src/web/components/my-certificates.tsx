import { useQuery } from '@tanstack/react-query';

import { certificateDownloadHref, fetchMyCertificates } from '../api/certificate-lifecycle';

const STATUS_TEXT: Record<string, string> = {
  queued: 'Em preparação',
  rendering: 'Em preparação',
  failed: 'Em preparação',
  ready: 'Pronto',
  revoked: 'Revogado',
};

/**
 * "Meus certificados" (M7-04): os certificados da própria pessoa. O PDF só baixa quando está pronto; revogado aparece
 * como revogado, sem o motivo (que é interno). Sem certificado, a seção nem aparece.
 */
export function MyCertificates() {
  const certificates = useQuery({
    queryKey: ['my-certificates'],
    queryFn: fetchMyCertificates,
    retry: false,
  });
  if (certificates.isPending || certificates.isError || certificates.data.length === 0) return null;
  return (
    <section aria-labelledby="certificados-titulo" className="mt-12 grid max-w-md gap-3">
      <h2 id="certificados-titulo" className="text-xl font-semibold">
        Meus certificados
      </h2>
      <ul className="grid gap-3" aria-label="Certificados">
        {certificates.data.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="block font-medium">{item.courseTitle}</span>
              <span className="text-sm text-[var(--text-muted)]">
                {STATUS_TEXT[item.status] ?? 'Em preparação'}
              </span>
            </span>
            {item.canDownload ? (
              <a
                className="inline-flex min-h-11 items-center underline"
                href={certificateDownloadHref(item.id)}
                download
              >
                Baixar o PDF<span className="sr-only"> do curso {item.courseTitle}</span>
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
