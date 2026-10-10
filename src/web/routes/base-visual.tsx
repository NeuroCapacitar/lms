import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/base-visual')({ component: BaseVisual });

/**
 * Vitrine dos componentes da base visual (M0-07). Existe para o teste de acessibilidade e para a
 * revisão visual dos temas; sai do menu quando houver telas reais (ver docs/tasks/M0-fundacao.md).
 */
function BaseVisual() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const error = submitted && !email.includes('@') ? 'Informe um e-mail válido.' : undefined;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Base visual</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Componentes da fundação: botões, campo de formulário e alternância de tema.
      </p>
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-5">
        <TextField
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          description="Usaremos para enviar o link de acesso."
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Enviar link</Button>
          <Button type="button" variant="secondary">
            Cancelar
          </Button>
          <Button type="button" disabled>
            Indisponível
          </Button>
        </div>
      </form>
      {submitted && !error ? (
        <p role="status" className="mt-6 font-medium text-[var(--text-success)]">
          Link enviado (simulação).
        </p>
      ) : null}
    </>
  );
}
