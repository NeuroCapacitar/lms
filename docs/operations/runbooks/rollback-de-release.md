# Runbook: release com problema (rollback)

**Princípios:** migrations são **somente para a frente** (expand/contract, sem `drizzle-kit push` em Staging e Production). Voltar o **código** é possível; voltar o **banco** não é. Por isso toda migration é compatível com o código anterior (expand antes, contract depois).

Production é publicada **manualmente** pelo responsável; Staging pode ser publicada pelo workflow (`deploy-staging.yml`, só `main`/`staging`) ou localmente.

## Passos

1. **Decida se é o código ou o dado.** Erro de interface ou de rota depois do deploy = código. Dado errado gravado = não é rollback: trate como incidente ([backup-and-restore.md](../backup-and-restore.md) só com revisão; nunca restaurar direto em Production).
2. Confirme a identidade e liste as versões do Worker: `bunx wrangler versions list --name hub-<ambiente> --profile neurocapacitar`. Anote o `releaseId` atual (`/api/health/live`) e o SHA anterior bom.
3. **Voltar o código** à versão anterior: `bunx wrangler rollback <version-id> --name hub-<ambiente> --profile neurocapacitar`. Alternativa limpa: publicar de novo o **SHA anterior** (`git switch` para o commit bom e o procedimento normal de deploy do ambiente, com o preflight).
4. Rode o smoke com o SHA completo: `bun run smoke <url> <sha-completo>` (o `releaseId` precisa ser o esperado e `ready` 200).
5. **Migration do release já aplicada?** O código anterior precisa continuar funcionando com ela (por isso expand/contract). Se não funciona, **não apague a migration**: publique uma correção para a frente e avise o responsável.
6. **PWA:** o app instalado só atualiza em fronteira segura; se o release quebrou o cliente, o kill switch `PWA_KILL=1` (variável de build) desliga o offline e o service worker no próximo build. Um release que exige cliente novo devolve `409 client_outdated` aos antigos.
7. Registre no STATUS: SHA ruim, SHA restaurado, hora, causa provável.

## Não faça

- Rollback de DNS como se fosse rollback do sistema: depois da primeira operação nova (pedido, matrícula), **voltar o DNS ao legado não é rollback seguro** (M10).
- Derrubar `staging`/`main` com force push ou apagar o Worker.
