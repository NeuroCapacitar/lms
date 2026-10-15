import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  profileFormSchema,
  THEMES,
  type ProfileDto,
  type ProfileFormValues,
  type Theme,
} from '../../features/identity/profile';
import { fetchMyInterests, withdrawCourseInterest } from '../api/interest';
import { fetchProfile, saveProfile, UnauthenticatedError } from '../api/profile';
import { MyCertificates } from '../components/my-certificates';
import { Button } from '../components/ui/button';
import { RequireTerms } from '../components/require-terms';
import { SignOutSection, SignedOutNotice } from '../components/sign-out';
import { useSignedOutPending } from '../offline/signed-out';
import { TextField } from '../components/ui/field';
import { useBusy } from '../pwa/safe-boundary';
import { setThemePreference } from '../theme';

export const Route = createFileRoute('/conta/')({
  component: () => (
    <RequireTerms>
      <Account />
    </RequireTerms>
  ),
});

const THEME_LABELS: Record<Theme, string> = {
  system: 'Seguir o sistema',
  light: 'Claro',
  dark: 'Escuro',
};

function toForm(profile: ProfileDto): ProfileFormValues {
  return {
    displayName: profile.displayName,
    certificateName: profile.certificateName ?? '',
    theme: profile.theme,
    autoAdvance: profile.autoAdvance,
  };
}

/** Perfil e preferências da própria pessoa (área do aluno). */
function Account() {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    retry: false,
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { displayName: '', certificateName: '', theme: 'system', autoAdvance: false },
  });

  // M8-01: formulário com alteração não salva impede a atualização do app.
  useBusy('formulário não salvo', form.formState.isDirty);

  // Quando o perfil chega, o formulário passa a refleti-lo e o tema salvo vale neste aparelho.
  useEffect(() => {
    if (profile.data) {
      form.reset(toForm(profile.data));
      setThemePreference(profile.data.theme);
    }
  }, [profile.data, form]);

  const signedOutPending = useSignedOutPending();

  const save = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      saveProfile({
        displayName: values.displayName,
        certificateName: values.certificateName === '' ? null : values.certificateName,
        theme: values.theme,
        autoAdvance: values.autoAdvance,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['profile'], saved);
      setThemePreference(saved.theme);
    },
  });

  if (signedOutPending) return <SignedOutNotice />;

  if (profile.isPending) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Minha conta</h1>
        <p role="status">Carregando…</p>
      </>
    );
  }

  if (profile.error instanceof UnauthenticatedError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Minha conta</h1>
        <p className="mb-4 max-w-prose">Entre para ver e editar o seu perfil.</p>
        <Link to="/entrar">Entrar</Link>
      </>
    );
  }

  if (profile.isError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Minha conta</h1>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar o seu perfil agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void profile.refetch()}>
          Tentar novamente
        </Button>
        <MyCertificates />
        <SignOutSection />
      </>
    );
  }

  const errors = form.formState.errors;
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Minha conta</h1>
      <p className="mb-4 max-w-prose text-[var(--text-muted)]">
        Seu nome de exibição e suas preferências. O e-mail de acesso não é alterado por aqui.
      </p>
      <p className="mb-8">
        <Link to="/conta/seguranca">Segurança da conta</Link>
      </p>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className="grid max-w-md gap-6"
      >
        <TextField
          label="Nome de exibição"
          autoComplete="name"
          error={errors.displayName?.message}
          {...form.register('displayName')}
        />
        <TextField
          label="Nome no certificado"
          description="Opcional. É o nome que aparecerá nos certificados; você confirmará antes da primeira emissão."
          error={errors.certificateName?.message}
          {...form.register('certificateName')}
        />

        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Tema</legend>
          {THEMES.map((theme) => (
            <label key={theme} className="flex min-h-11 items-center gap-3">
              <input type="radio" value={theme} {...form.register('theme')} className="size-5" />
              <span>{THEME_LABELS[theme]}</span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-1">
          <label className="flex min-h-11 items-center gap-3 font-medium">
            <input type="checkbox" {...form.register('autoAdvance')} className="size-5" />
            <span>Avançar para a próxima aula automaticamente</span>
          </label>
          <p className="text-sm text-[var(--text-muted)]">
            Quando um vídeo termina, abrir a próxima aula. Desligado por padrão.
          </p>
        </div>

        {save.isError ? (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            {save.error instanceof UnauthenticatedError
              ? 'Sua sessão expirou. Entre novamente.'
              : 'Não foi possível salvar. Tente novamente.'}
          </p>
        ) : null}
        {save.isSuccess ? (
          <p role="status" className="font-medium text-[var(--text-success)]">
            Preferências salvas.
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </form>

      <MyCertificates />
      <CourseNotices />

      <SignOutSection />
    </>
  );
}

/** "Avisos de cursos" (M5-06): os cursos em que a pessoa pediu aviso de abertura, com a retirada na própria conta. */
function CourseNotices() {
  const queryClient = useQueryClient();
  const interests = useQuery({
    queryKey: ['interests'],
    queryFn: fetchMyInterests,
    retry: false,
  });
  const [failed, setFailed] = useState(false);
  const active = (interests.data ?? []).filter((item) => item.status === 'active');
  if (interests.isPending || interests.isError || active.length === 0) return null;

  return (
    <section aria-labelledby="avisos-titulo" className="mt-12 grid max-w-md gap-3">
      <h2 id="avisos-titulo" className="text-xl font-semibold">
        Avisos de cursos
      </h2>
      <p className="text-[var(--text-muted)]">
        Você receberá um e-mail quando as inscrições destes cursos abrirem.
      </p>
      {failed ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível retirar o aviso agora. Tente novamente.
        </p>
      ) : null}
      <ul className="grid gap-3" aria-label="Cursos com aviso">
        {active.map((item) => (
          <li key={item.courseId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium">{item.title}</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setFailed(false);
                void withdrawCourseInterest(item.courseId).then(async (outcome) => {
                  if (outcome.result === 'ok') {
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ['interests'] }),
                      queryClient.invalidateQueries({ queryKey: ['catalog'] }),
                    ]);
                  } else setFailed(true);
                });
              }}
            >
              Retirar o aviso de {item.title}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
