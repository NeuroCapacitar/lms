import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { courseFormSchema, type CourseFormValues } from '../../features/catalog/forms';
import { createCourse } from '../api/catalog';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

/**
 * Criar curso (só quem tem `course.create`, o Admin). A sequência pedagógica é ESCOLHA obrigatória,
 * sem opção pré-marcada. Erros do servidor caem no campo certo (endereço já usado).
 */
export function CreateCourseForm() {
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | undefined>();
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: { title: '', slug: '' },
  });
  const errors = form.formState.errors;

  async function submit(values: CourseFormValues) {
    setMessage(undefined);
    const outcome = await createCourse(values);
    if (outcome.result === 'ok' && outcome.data) {
      await navigate({ to: '/staff/cursos/$courseId', params: { courseId: outcome.data.id } });
      return;
    }
    if (outcome.code === 'slug_taken') {
      form.setError('slug', { message: 'Já existe um curso com este endereço.' });
    } else if (outcome.result === 'invalid') {
      setMessage('Confira os campos e tente de novo.');
    } else if (outcome.result === 'forbidden') {
      setMessage('Você não tem permissão para criar cursos.');
    } else if (outcome.result === 'unauthenticated') {
      setMessage('Sua sessão expirou. Entre novamente.');
    } else {
      setMessage('Não foi possível criar agora. Tente novamente em instantes.');
    }
  }

  return (
    <form
      noValidate
      aria-labelledby="novo-curso-titulo"
      onSubmit={form.handleSubmit(submit)}
      className="grid max-w-xl gap-5"
    >
      <h2 id="novo-curso-titulo" className="text-xl font-semibold">
        Novo curso
      </h2>
      <TextField
        label="Título interno"
        description="Só a equipe vê. O título público é editado no curso."
        error={errors.title?.message}
        {...form.register('title')}
      />
      <TextField
        label="Endereço (slug)"
        description="Letras minúsculas, números e hífens. Não muda depois da primeira publicação."
        error={errors.slug?.message}
        {...form.register('slug')}
      />
      <fieldset
        className="grid gap-2"
        aria-describedby={errors.sequenceMode ? 'sequencia-erro' : undefined}
      >
        <legend className="mb-1 font-medium">Como as aulas se liberam</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            value="guided"
            className="size-5"
            {...form.register('sequenceMode')}
          />
          <span>Guiada: uma aula depois da outra, na ordem do curso</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" value="free" className="size-5" {...form.register('sequenceMode')} />
          <span>Livre: a pessoa escolhe a ordem dentro do que já está liberado</span>
        </label>
        {errors.sequenceMode ? (
          <p
            id="sequencia-erro"
            role="alert"
            className="text-sm font-medium text-[var(--field-error)]"
          >
            {errors.sequenceMode.message}
          </p>
        ) : null}
      </fieldset>
      {message ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {message}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Criando…' : 'Criar curso'}
        </Button>
      </div>
    </form>
  );
}
