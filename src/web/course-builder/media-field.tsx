import { useEffect, useId, useState } from 'react';

import type { CroppablePurpose } from '../../features/media/crop';
import { uploadMedia, type UploadFailure } from '../api/media';
import { prepareImage } from '../media/prepare-image';
import { ConfirmButton } from '../components/confirm-button';

const REJECTION_TEXT: Record<string, string> = {
  type_mismatch: 'O arquivo não é uma imagem válida.',
  type_not_allowed: 'Este tipo de arquivo não é permitido aqui.',
  too_large: 'A imagem ficou grande demais para enviar.',
  size_mismatch: 'O envio foi interrompido. Tente de novo.',
  dimensions_out_of_range: 'A imagem tem dimensões fora do permitido.',
  aspect_mismatch: 'A imagem não tem a proporção exigida.',
  bad_dimensions: 'Não foi possível ler as dimensões da imagem.',
  content_type_not_allowed: 'Este tipo de arquivo não é permitido aqui.',
};

const FAILURE_TEXT: Record<UploadFailure, string> = {
  forbidden: 'Você não tem permissão para enviar imagens.',
  not_configured: 'O armazenamento de imagens ainda não está ativo neste ambiente.',
  upload_failed: 'O envio da imagem falhou. Verifique a conexão e tente de novo.',
  unavailable:
    'Não foi possível enviar agora. Se continuar, o armazenamento de imagens pode não estar ativo neste ambiente.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  invalid_media: 'A imagem foi recusada.',
};

/**
 * Capa ou banner do curso (M5-07). O navegador RECORTA ao centro na proporção exigida, converte e envia só o master
 * editado (o original nunca sobe); o servidor confere os bytes antes de a imagem valer. O novo valor só vai ao
 * servidor com "Salvar rascunho", e só aparece para o público depois de publicar o currículo.
 */
export function MediaField({
  purpose,
  label,
  help,
  value,
  onChange,
  readOnly,
}: {
  purpose: CroppablePurpose;
  label: string;
  help: string;
  value: string | null | undefined;
  onChange: (mediaId: string | null) => void;
  readOnly: boolean;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function pick(file: File) {
    setMessage(undefined);
    setBusy(true);
    const prepared = await prepareImage(file, purpose);
    if (!prepared.ok) {
      setBusy(false);
      setMessage({
        kind: 'error',
        text:
          prepared.failure === 'too_small'
            ? 'A imagem é pequena demais para este espaço.'
            : prepared.failure === 'too_large'
              ? 'A imagem ficou grande demais mesmo depois de reduzida.'
              : 'Não foi possível ler este arquivo como imagem.',
      });
      return;
    }
    const outcome = await uploadMedia(purpose, prepared.blob, prepared.contentType);
    setBusy(false);
    if (!outcome.ok) {
      setMessage({
        kind: 'error',
        text:
          outcome.failure === 'invalid_media' && outcome.reason
            ? (REJECTION_TEXT[outcome.reason] ?? FAILURE_TEXT.invalid_media)
            : FAILURE_TEXT[outcome.failure],
      });
      return;
    }
    setPreview(URL.createObjectURL(prepared.blob));
    onChange(outcome.media.id);
    setMessage({
      kind: 'ok',
      text: 'Imagem enviada. Salve o rascunho e publique o currículo para ela aparecer.',
    });
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={inputId} className="font-medium text-[var(--field-label)]">
        {label}
      </label>
      <p id={`${inputId}-ajuda`} className="text-sm text-[var(--field-description)]">
        {help}
      </p>
      {!readOnly ? (
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby={`${inputId}-ajuda`}
          disabled={busy}
          className="min-h-11 max-w-full"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
      ) : null}
      {busy ? <p role="status">Enviando a imagem…</p> : null}
      {preview ? (
        <img
          src={preview}
          alt={`Prévia: ${label}`}
          className="max-h-48 max-w-full rounded-lg border object-contain"
        />
      ) : value ? (
        <p>Há uma imagem definida.</p>
      ) : (
        <p className="text-[var(--text-muted)]">Nenhuma imagem definida.</p>
      )}
      {value && !readOnly ? (
        <div>
          <ConfirmButton
            label={`Remover ${label.toLowerCase()}`}
            confirmLabel="Confirmar remoção da imagem"
            disabled={busy}
            onConfirm={() => {
              setPreview(undefined);
              setMessage(undefined);
              onChange(null);
            }}
          />
        </div>
      ) : null}
      {message ? (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'font-medium text-[var(--text-success)]'
              : 'font-medium text-[var(--text-danger)]'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
