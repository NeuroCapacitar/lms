import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { certificateDownloadHref } from '../api/certificate-lifecycle';
import { loadMyCertificates } from '../offline/certificates';
import { offline } from '../offline/runtime';
import { Button } from './ui/button';

const STATUS_TEXT: Record<string, string> = {
  queued: 'Em preparação',
  rendering: 'Em preparação',
  failed: 'Em preparação',
  ready: 'Pronto',
  revoked: 'Revogado',
};

/** Sem rede o app não confirma nada: "Pronto" daria a entender "válido agora". Fica "Emitido", com a data da verificação. */
const OFFLINE_STATUS_TEXT: Record<string, string> = { ...STATUS_TEXT, ready: 'Emitido' };

const FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const PDF_MESSAGES = {
  tampered:
    'O arquivo guardado foi alterado e foi descartado. Conecte-se à internet para baixar de novo.',
  missing: 'A cópia do PDF não está mais neste aparelho.',
  not_ready: 'Este certificado não está mais disponível: a cópia guardada foi removida.',
  not_available: 'Este certificado não está disponível para baixar agora.',
  integrity_failed:
    'O arquivo recebido não passou na conferência de integridade e não foi guardado.',
  failed: 'Não foi possível guardar o PDF agora. Tente de novo com internet.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
} as const;

/**
 * "Meus certificados" (M7-04, M8-06): os certificados da própria pessoa. O PDF só baixa quando está pronto; revogado aparece
 * como revogado, sem o motivo (que é interno). Sem rede, mostra a cópia guardada com "verificado em" (nunca "válido" sem a data) e
 * só abre o PDF que a pessoa baixou DE PROPÓSITO, depois de recalcular o SHA-256. A cópia não prova que continua valendo.
 */
export function MyCertificates() {
  const queryClient = useQueryClient();
  const certificates = useQuery({
    queryKey: ['my-certificates'],
    queryFn: loadMyCertificates,
    retry: false,
    // Sem rede o React Query pausaria a consulta; aqui a falha de rede vira a leitura da cópia guardada.
    networkMode: 'always',
  });
  const stored = useQuery({
    queryKey: ['certificate-pdfs'],
    queryFn: async () => {
      const read = await offline.readCertificates();
      return read.kind === 'ok' ? read.pdfIds : [];
    },
    networkMode: 'always',
  });
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState<{ id: string; text: string } | undefined>();

  if (certificates.isPending || certificates.isError || certificates.data.items.length === 0) {
    return null;
  }
  const { items, offline: copy } = certificates.data;
  const savedIds = new Set(stored.data ?? copy?.pdfIds ?? []);
  const statusText = copy ? OFFLINE_STATUS_TEXT : STATUS_TEXT;
  const refreshStored = () => queryClient.invalidateQueries({ queryKey: ['certificate-pdfs'] });

  async function keep(id: string) {
    setBusy(id);
    setMessage(undefined);
    const outcome = await offline.saveCertificatePdf(id);
    if (outcome !== 'saved') setMessage({ id, text: PDF_MESSAGES[outcome] });
    await refreshStored();
    setBusy(undefined);
  }

  async function openCopy(id: string) {
    setBusy(id);
    setMessage(undefined);
    const result = await offline.openCertificatePdf(id);
    if (result.kind === 'ok') {
      const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } else {
      setMessage({ id, text: PDF_MESSAGES[result.kind] });
      await refreshStored();
    }
    setBusy(undefined);
  }

  async function dropCopy(id: string) {
    await offline.removeCertificatePdf(id);
    await refreshStored();
  }

  return (
    <section aria-labelledby="certificados-titulo" className="mt-12 grid max-w-md gap-3">
      <h2 id="certificados-titulo" className="text-xl font-semibold">
        Meus certificados
      </h2>
      {copy ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          Sem conexão. Esta lista foi guardada neste aparelho e verificada em{' '}
          {FORMAT.format(copy.verifiedAt)}. Sem internet não é possível confirmar que um certificado
          continua válido.
        </p>
      ) : null}
      <ul className="grid gap-3" aria-label="Certificados">
        {items.map((item) => (
          <li key={item.id} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="block font-medium">{item.courseTitle}</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {statusText[item.status] ?? 'Em preparação'}
                  {copy ? ` · verificado em ${FORMAT.format(copy.verifiedAt)}` : ''}
                </span>
              </span>
              {item.canDownload && !copy ? (
                <a
                  className="inline-flex min-h-11 items-center underline"
                  href={certificateDownloadHref(item.id)}
                  download
                >
                  Baixar o PDF<span className="sr-only"> do curso {item.courseTitle}</span>
                </a>
              ) : null}
            </div>
            {item.canDownload ? (
              <div className="flex flex-wrap items-center gap-3">
                {savedIds.has(item.id) ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy === item.id}
                      onClick={() => void openCopy(item.id)}
                    >
                      Baixar a cópia guardada
                      <span className="sr-only"> do curso {item.courseTitle}</span>
                    </Button>
                    {copy ? null : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void dropCopy(item.id)}
                      >
                        Remover a cópia guardada
                        <span className="sr-only"> do curso {item.courseTitle}</span>
                      </Button>
                    )}
                  </>
                ) : copy ? (
                  <span className="text-sm text-[var(--text-muted)]">
                    PDF não guardado neste aparelho: precisa de internet.
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy === item.id}
                    onClick={() => void keep(item.id)}
                  >
                    {busy === item.id ? 'Guardando…' : 'Guardar para ler offline'}
                    <span className="sr-only"> o PDF do curso {item.courseTitle}</span>
                  </Button>
                )}
              </div>
            ) : null}
            {message?.id === item.id ? (
              <p role="alert" className="text-sm font-medium text-[var(--text-danger)]">
                {message.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {copy || savedIds.size > 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          A cópia guardada não se atualiza sem internet: se um certificado for revogado depois, a
          cópia continua neste aparelho até a próxima conexão, quando ela é removida.
        </p>
      ) : null}
    </section>
  );
}
