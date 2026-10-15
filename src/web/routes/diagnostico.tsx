import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import {
  browserDiagnosticsEnv,
  collectDiagnostics,
  formatDiagnostics,
  type DiagnosticsReport,
} from '../offline/diagnostics';

export const Route = createFileRoute('/diagnostico')({ component: Diagnostics });

/**
 * Diagnóstico do aparelho (M8-04): o que o app guardou neste aparelho, só em nomes e contagens, para o roteiro do iPhone provar
 * (sem Mac e sem inspetor) o que ficou depois de sair, de trocar de conta ou de perder o cache. Sem sessão e sem dado da pessoa:
 * nada aqui lê conteúdo.
 */
function Diagnostics() {
  const [report, setReport] = useState<DiagnosticsReport | undefined>();
  const [copied, setCopied] = useState<'ok' | 'failed' | undefined>();
  const [persist, setPersist] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setCopied(undefined);
    setReport(await collectDiagnostics(browserDiagnosticsEnv()));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatDiagnostics(report));
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }

  async function askPersistence() {
    try {
      const granted = await navigator.storage?.persist?.();
      setPersist(
        granted === undefined
          ? 'Este navegador não oferece armazenamento persistente.'
          : granted
            ? 'O navegador concedeu armazenamento persistente.'
            : 'O navegador NÃO concedeu armazenamento persistente.',
      );
    } catch {
      setPersist('Não foi possível pedir armazenamento persistente.');
    }
    await refresh();
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Diagnóstico do aparelho</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        Mostra o que o app guardou neste aparelho (só nomes e contagens, nunca o conteúdo). Serve ao
        roteiro de testes do uso offline.
      </p>
      <div className="mb-6 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          Atualizar
        </Button>
        <Button type="button" onClick={() => void copy()} disabled={!report}>
          Copiar relatório
        </Button>
        <Button type="button" variant="secondary" onClick={() => void askPersistence()}>
          Pedir armazenamento persistente
        </Button>
      </div>
      {copied === 'ok' ? <p role="status">Relatório copiado.</p> : null}
      {copied === 'failed' ? (
        <p role="alert">Não foi possível copiar. Selecione o texto abaixo e copie à mão.</p>
      ) : null}
      {persist ? <p role="status">{persist}</p> : null}
      {report ? (
        <pre
          aria-label="Relatório do aparelho"
          className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border p-4 text-sm"
          tabIndex={0}
        >
          {formatDiagnostics(report)}
        </pre>
      ) : (
        <p role="status">Coletando…</p>
      )}
    </>
  );
}
