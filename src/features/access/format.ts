/**
 * Data para a pessoa ler (dd/mm/aaaa) no fuso de São Paulo, o mesmo dos dias de liberação do drip
 * (M3-03). Puro: só `Intl`. Entrada inválida devolve texto vazio em vez de "Invalid Date".
 */
const FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatAccessDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : FORMATTER.format(date);
}
