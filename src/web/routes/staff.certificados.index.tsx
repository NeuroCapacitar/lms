import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { MIME_BY_KIND } from '../../features/media/media';
import type { ActionOutcome } from '../api/action';
import {
  fetchIssuer,
  fetchSignatory,
  saveIssuer,
  saveSignatory,
  signatureSrc,
} from '../api/certificate';
import { fetchCourses } from '../api/catalog';
import { uploadMedia } from '../api/media';
import { ForbiddenError } from '../api/staff';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/certificados/')({ component: StaffCertificates });

const FAILURES: Record<string, string> = {
  invalid_request:
    'Confira os campos: o CNPJ precisa ser válido (14 dígitos) e os textos não podem ter caracteres invisíveis nem de controle.',
  invalid_media: 'A imagem não serve como assinatura. Envie um PNG, JPEG ou WebP de até 3 MB.',
  media_not_ready: 'A imagem ainda não está pronta. Envie de novo.',
  media_not_configured: 'O armazenamento de imagens ainda não está ativo neste ambiente.',
  forbidden: 'Só o Admin gerencia o emitente e o signatário.',
  not_found: 'O curso não existe mais. Atualize a página.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid' ? FAILURES.invalid_request! : 'Não foi possível concluir agora.')
  );
}

type Message = { kind: 'ok' | 'error'; text: string } | undefined;

function Status({ message }: { message: Message }) {
  if (!message) return null;
  return message.kind === 'ok' ? (
    <p role="status" className="font-medium">
      {message.text}
    </p>
  ) : (
    <p role="alert" className="font-medium text-[var(--text-danger)]">
      {message.text}
    </p>
  );
}

/**
 * Emitente e signatário do certificado (M7-06), só do Admin. O emitente é um só; o signatário é de cada curso. A
 * assinatura é uma imagem PRIVADA: aparece aqui por uma rota autorizada e nunca tem endereço público.
 */
function StaffCertificates() {
  const issuer = useQuery({ queryKey: ['certificate-issuer'], queryFn: fetchIssuer, retry: false });
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Certificados</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Quem emite o certificado e quem o assina. Mudar estes dados vale só para os certificados
        emitidos daqui em diante: os já emitidos mantêm o que valia quando nasceram.
      </p>
      {issuer.error instanceof ForbiddenError ? (
        <p role="alert">Só o Admin gerencia o emitente e o signatário.</p>
      ) : issuer.isPending ? (
        <p role="status">Carregando…</p>
      ) : issuer.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar. Tente de novo.
        </p>
      ) : (
        <div className="grid gap-10">
          <IssuerForm initial={issuer.data ?? null} />
          <p>
            <Link to="/staff/certificados/emitidos" className="underline">
              Ver os certificados emitidos
            </Link>
          </p>
          <SignatorySection />
        </div>
      )}
    </>
  );
}

function IssuerForm({ initial }: { initial: { legalName: string; cnpjFormatted: string } | null }) {
  const queryClient = useQueryClient();
  const [legalName, setLegalName] = useState(initial?.legalName ?? '');
  const [cnpj, setCnpj] = useState(initial?.cnpjFormatted ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const outcome = await saveIssuer({ legalName, cnpj });
    setBusy(false);
    if (outcome.result === 'ok') {
      // O formulário NÃO é remontado (a mensagem some junto): só mostra o CNPJ como o servidor o guardou.
      if (outcome.data) setCnpj(outcome.data.issuer.cnpjFormatted);
      setMessage({ kind: 'ok', text: 'Emitente salvo.' });
      await queryClient.invalidateQueries({ queryKey: ['certificate-issuer'] });
    } else {
      setMessage({ kind: 'error', text: failureText(outcome) });
    }
  }

  return (
    <section aria-labelledby="emitente" className="grid max-w-xl gap-4">
      <h2 id="emitente" className="text-2xl font-semibold">
        Emitente
      </h2>
      <form onSubmit={submit} className="grid gap-4">
        <TextField
          label="Razão social"
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          maxLength={200}
          required
        />
        <TextField
          label="CNPJ"
          value={cnpj}
          onChange={(event) => setCnpj(event.target.value)}
          inputMode="numeric"
          description="Com ou sem pontuação. Conferimos os dígitos verificadores."
          required
        />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar emitente'}
          </Button>
        </div>
        <Status message={message} />
      </form>
    </section>
  );
}

function SignatorySection() {
  const courses = useQuery({ queryKey: ['staff-courses'], queryFn: fetchCourses, retry: false });
  const [courseId, setCourseId] = useState('');
  return (
    <section aria-labelledby="signatario" className="grid max-w-xl gap-4">
      <h2 id="signatario" className="text-2xl font-semibold">
        Signatário por curso
      </h2>
      <p className="text-[var(--text-muted)]">
        Cada curso tem o seu signatário; não há signatário padrão para todos.
      </p>
      {courses.isPending ? (
        <p role="status">Carregando cursos…</p>
      ) : courses.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar os cursos.
        </p>
      ) : courses.data.length === 0 ? (
        <p>Ainda não há cursos.</p>
      ) : (
        <>
          <label className="grid gap-1.5">
            <span className="font-medium">Curso</span>
            <select
              className="min-h-11 rounded-lg border px-3"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              <option value="">Escolha um curso</option>
              {courses.data.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          {courseId ? (
            <>
              <p>
                <Link
                  to="/staff/certificados/$courseId"
                  params={{ courseId }}
                  className="underline"
                >
                  Editar o template do certificado deste curso
                </Link>
              </p>
              <SignatoryLoader key={courseId} courseId={courseId} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function SignatoryLoader({ courseId }: { courseId: string }) {
  const signatory = useQuery({
    queryKey: ['certificate-signatory', courseId],
    queryFn: () => fetchSignatory(courseId),
    retry: false,
  });
  if (signatory.isPending) return <p role="status">Carregando…</p>;
  if (signatory.isError) {
    return (
      <p role="alert" className="font-medium text-[var(--text-danger)]">
        Não foi possível carregar o signatário.
      </p>
    );
  }
  return <SignatoryForm courseId={courseId} initial={signatory.data} />;
}

const ACCEPT = [MIME_BY_KIND.png, MIME_BY_KIND.jpeg, MIME_BY_KIND.webp].join(',');

function SignatoryForm({
  courseId,
  initial,
}: {
  courseId: string;
  initial: { name: string; title: string; signatureMediaId: string | null } | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [mediaId, setMediaId] = useState<string | null>(initial?.signatureMediaId ?? null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function choose(file: File | undefined) {
    if (!file) return;
    setMessage(undefined);
    setUploading(true);
    const uploaded = await uploadMedia('certificate_asset', file, file.type);
    setUploading(false);
    if (uploaded.ok) {
      setMediaId(uploaded.media.id);
      setMessage({ kind: 'ok', text: 'Imagem enviada. Salve o signatário para usá-la.' });
      return;
    }
    const text =
      uploaded.failure === 'not_configured'
        ? FAILURES.media_not_configured!
        : uploaded.failure === 'forbidden'
          ? FAILURES.forbidden!
          : uploaded.failure === 'invalid_media'
            ? FAILURES.invalid_media!
            : 'Não foi possível enviar a imagem agora.';
    setMessage({ kind: 'error', text });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const outcome = await saveSignatory(courseId, { name, title, signatureMediaId: mediaId });
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: 'Signatário salvo.' });
      await queryClient.invalidateQueries({ queryKey: ['certificate-signatory', courseId] });
    } else {
      setMessage({ kind: 'error', text: failureText(outcome) });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <TextField
        label="Nome do signatário"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={120}
        required
      />
      <TextField
        label="Cargo"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={120}
        required
      />
      <div className="grid gap-2">
        <label htmlFor="assinatura" className="font-medium">
          Imagem da assinatura
        </label>
        <input
          id="assinatura"
          type="file"
          accept={ACCEPT}
          disabled={uploading}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <p className="text-sm text-[var(--text-muted)]">
          PNG, JPEG ou WebP de até 3 MB. A imagem é privada: só o Admin a vê.
        </p>
        {uploading ? <p role="status">Enviando a imagem…</p> : null}
        {mediaId ? (
          <div className="grid justify-start gap-2">
            <img
              src={signatureSrc(mediaId)}
              alt={`Assinatura de ${name || 'signatário'}`}
              className="max-h-24 max-w-64 rounded border bg-white p-2"
            />
            <Button type="button" variant="secondary" onClick={() => setMediaId(null)}>
              Remover a assinatura
            </Button>
          </div>
        ) : (
          <p>Nenhuma assinatura cadastrada.</p>
        )}
      </div>
      <div>
        <Button type="submit" disabled={busy || uploading}>
          {busy ? 'Salvando…' : 'Salvar signatário'}
        </Button>
      </div>
      <Status message={message} />
    </form>
  );
}
