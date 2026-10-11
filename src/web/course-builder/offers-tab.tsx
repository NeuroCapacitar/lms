import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  canTransitionOffer,
  type OfferStatus,
  type StaffCourseDto,
  type StaffOfferDto,
} from '../../features/catalog/catalog';
import {
  offerFormSchema,
  offerFormToInput,
  SERVER_FIELD_MESSAGES,
  type OfferFormValues,
} from '../../features/catalog/forms';
import { centsToInput, formatBrl } from '../../features/catalog/money';
import { createOffer, setOfferStatus, updateOffer } from '../api/catalog';
import { ConfirmButton } from '../components/confirm-button';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
};

/** Do que o servidor listou como inválido para os campos do formulário. */
const FIELD_FOR_SERVER: Record<string, keyof OfferFormValues> = {
  priceCents: 'price',
  accessMonths: 'accessMonths',
  maxInstallments: 'maxInstallments',
  name: 'name',
};

function OfferForm({
  courseId,
  offer,
  onDone,
  onCancel,
}: {
  courseId: string;
  /** Sem oferta: criar. Com oferta: editar (a modalidade não muda). */
  offer?: StaffOfferDto;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [message, setMessage] = useState<string | undefined>();
  const form = useForm<OfferFormValues>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: offer
      ? {
          name: offer.name,
          kind: offer.kind,
          price: offer.kind === 'paid' ? centsToInput(offer.priceCents) : '',
          accessMonths: offer.accessMonths,
          maxInstallments: offer.maxInstallments,
        }
      : { name: '', price: '', accessMonths: 12, maxInstallments: 1 },
  });
  const errors = form.formState.errors;
  const kind = form.watch('kind');
  const id = offer?.id ?? 'nova';

  async function submit(values: OfferFormValues) {
    setMessage(undefined);
    const input = offerFormToInput(values);
    const outcome = offer
      ? await updateOffer(courseId, offer.id, {
          name: input.name,
          priceCents: input.priceCents,
          accessMonths: input.accessMonths,
          maxInstallments: input.maxInstallments,
        })
      : await createOffer(courseId, input);
    if (outcome.result === 'ok') {
      form.reset();
      onDone();
      return;
    }
    const fields = outcome.error?.fields ?? [];
    let mapped = false;
    for (const field of fields) {
      const target = FIELD_FOR_SERVER[field];
      if (target) {
        form.setError(target, { message: SERVER_FIELD_MESSAGES[field] ?? 'Valor inválido.' });
        mapped = true;
      }
    }
    if (mapped) return;
    setMessage(
      outcome.result === 'forbidden'
        ? 'Só o administrador pode criar e editar ofertas.'
        : outcome.code === 'offer_archived'
          ? 'Esta oferta está arquivada e não pode mais ser alterada.'
          : outcome.code === 'course_archived'
            ? 'O curso está arquivado: republique-o para criar ofertas.'
            : 'Não foi possível salvar agora. Tente novamente.',
    );
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(submit)}
      aria-label={offer ? `Editar a oferta ${offer.name}` : 'Nova oferta'}
      className="grid max-w-xl gap-4"
    >
      <TextField label="Nome da oferta" error={errors.name?.message} {...form.register('name')} />
      {offer ? (
        <p className="text-sm text-[var(--text-muted)]">
          Modalidade: {offer.kind === 'free' ? 'gratuita' : 'paga'}. Para mudar, crie outra oferta.
        </p>
      ) : (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Modalidade</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" value="paid" className="size-5" {...form.register('kind')} />
            <span>Paga</span>
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" value="free" className="size-5" {...form.register('kind')} />
            <span>Gratuita</span>
          </label>
          {errors.kind ? (
            <p role="alert" className="text-sm font-medium text-[var(--field-error)]">
              {errors.kind.message}
            </p>
          ) : null}
        </fieldset>
      )}
      {(offer?.kind ?? kind) !== 'free' ? (
        <TextField
          label="Preço (R$)"
          description="Em reais, por exemplo 197,00. Guardado em centavos inteiros."
          inputMode="decimal"
          error={errors.price?.message}
          {...form.register('price')}
        />
      ) : null}
      <TextField
        label="Prazo de acesso (meses)"
        description="Toda oferta tem prazo: de 1 a 600 meses, sem acesso vitalício."
        type="number"
        error={errors.accessMonths?.message}
        {...form.register('accessMonths', { valueAsNumber: true })}
      />
      <TextField
        label="Máximo de parcelas"
        description="De 1 a 12, sem juros. A oferta gratuita não parcela."
        type="number"
        error={errors.maxInstallments?.message}
        {...form.register('maxInstallments', { valueAsNumber: true })}
      />
      {message ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {offer ? 'Salvar oferta' : 'Criar oferta'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
      <input type="hidden" value={id} readOnly />
    </form>
  );
}

/**
 * Oferta (M2-03, só Admin: a aba nem aparece sem `offer.manage` e o servidor confere de novo).
 * Preço, prazo, parcelas e disponibilidade. Toda oferta tem prazo em meses; o preço é digitado em
 * reais e vai em centavos inteiros.
 */
export function OffersTab({
  course,
  onChanged,
}: {
  course: StaffCourseDto;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  async function changeStatus(offer: StaffOfferDto, status: OfferStatus, success: string) {
    setBusy(true);
    setMessage(undefined);
    const outcome = await setOfferStatus(course.id, offer.id, status);
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: success });
      onChanged();
    } else {
      setMessage({
        kind: 'error',
        text:
          outcome.result === 'forbidden'
            ? 'Só o administrador pode mudar a disponibilidade.'
            : 'Não foi possível mudar agora. Tente novamente.',
      });
    }
  }

  return (
    <div className="grid gap-10">
      <section aria-labelledby="ofertas-titulo" className="grid gap-4">
        <h2 id="ofertas-titulo" className="text-xl font-semibold">
          Ofertas do curso
        </h2>
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
        {course.offers.length === 0 ? <p>Este curso ainda não tem ofertas.</p> : null}
        <ul className="grid gap-4" aria-label="Ofertas">
          {course.offers.map((offer) => (
            <li key={offer.id} className="grid gap-3 rounded-lg border p-4">
              <p>
                <strong>{offer.name}</strong> · {STATUS_LABELS[offer.status]}
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                {offer.kind === 'free' ? 'Gratuita' : formatBrl(offer.priceCents)} · acesso por{' '}
                {offer.accessMonths} {offer.accessMonths === 1 ? 'mês' : 'meses'}
                {offer.kind === 'paid' ? ` · até ${offer.maxInstallments}x sem juros` : ''}
              </p>
              {editing === offer.id ? (
                <OfferForm
                  courseId={course.id}
                  offer={offer}
                  onCancel={() => setEditing(undefined)}
                  onDone={() => {
                    setEditing(undefined);
                    setMessage({ kind: 'ok', text: 'Oferta salva.' });
                    onChanged();
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {offer.status !== 'archived' ? (
                    <Button type="button" variant="secondary" onClick={() => setEditing(offer.id)}>
                      Editar {offer.name}
                    </Button>
                  ) : null}
                  {canTransitionOffer(offer.status, 'active') ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void changeStatus(
                          offer,
                          'active',
                          offer.status === 'paused' ? 'Oferta reativada.' : 'Oferta ativada.',
                        )
                      }
                    >
                      {offer.status === 'paused' ? 'Reativar' : 'Ativar'} {offer.name}
                    </Button>
                  ) : null}
                  {canTransitionOffer(offer.status, 'paused') ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void changeStatus(offer, 'paused', 'Oferta pausada.')}
                    >
                      Pausar {offer.name}
                    </Button>
                  ) : null}
                  {canTransitionOffer(offer.status, 'archived') ? (
                    <ConfirmButton
                      label={`Arquivar ${offer.name}`}
                      confirmLabel="Confirmar arquivamento"
                      disabled={busy}
                      onConfirm={() => void changeStatus(offer, 'archived', 'Oferta arquivada.')}
                    />
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="nova-oferta-titulo" className="grid gap-4">
        <h2 id="nova-oferta-titulo" className="text-xl font-semibold">
          Nova oferta
        </h2>
        <OfferForm
          courseId={course.id}
          onDone={() => {
            setMessage({ kind: 'ok', text: 'Oferta criada.' });
            onChanged();
          }}
        />
      </section>
    </div>
  );
}
