import { useEffect, useState } from 'react';

import { offline, onLocalPurge, onOutboxChange } from './runtime';
import type { OutboxSummary } from './service';

const EMPTY: OutboxSummary = { pending: [], rejected: [] };

/** As pendências do outbox da pessoa conhecida neste aparelho (M8-03); relê quando o outbox muda (aqui ou em outra aba) ou é limpo. */
export function useOutboxSummary(): OutboxSummary {
  const [summary, setSummary] = useState<OutboxSummary>(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void offline.outboxSummary().then((next) => {
        if (alive) setSummary(next);
      });
    };
    load();
    const stopChange = onOutboxChange(load);
    const stopPurge = onLocalPurge(load);
    return () => {
      alive = false;
      stopChange();
      stopPurge();
    };
  }, []);
  return summary;
}
