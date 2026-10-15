// Só para o servidor de teste do e2e (`vite preview`): o navegador de teste derruba conexões no meio de uma
// requisição (rota abortada, página fechada) e o Node lança um 'error' de socket (ECONNRESET) que, sem tratador,
// MATA o servidor e derruba todos os testes seguintes. Esse erro específico é ignorado; qualquer outro erro continua
// derrubando o processo. Nunca entra em build, Staging nem Production.
process.on('uncaughtException', (error) => {
  if (error && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
    console.warn(`[e2e] ${error.code} de socket ignorado`);
    return;
  }
  console.error(error);
  process.exit(1);
});
