# Fluxo de trabalho com agentes de IA

Um ritual único e verificável para Codex, Claude Code, Copilot ou outro agente, sem duplicar regras. Ler [`AGENTS.md`](../../AGENTS.md) primeiro; topologia das instruções em [agent-instructions.md](agent-instructions.md).

## 1 — Seleção de tarefa e DoR

- Receba autorização **para um ID específico**. Confira [STATUS](../implementation/STATUS.md), as dependências e a tarefa em [docs/tasks/](../tasks/README.md).
- Leia as ADRs e a especificação citadas pela tarefa. Decisões `superseded` não valem como requisito.
- Inspecione o checkout e o ambiente reais. Pergunte só se uma condição crítica impede a execução ou se há escolha de produto, segurança, custo ou consequência irreversível.
- Explicite objetivo, fora do escopo, arquivos esperados, comportamento observável e verificações.

## 2 — Implementação

- Mudanças pequenas e coesas; regressão para bugs quando possível.
- Sem dados reais de Production em testes, logs, prompts ou fixtures; sem segredos em artefatos.
- Regras de domínio independentes de React e Hono; endpoints autorizados e validados; migrations forward-only por ambiente.
- Antes de chamar um provider, identifique confirmação, idempotência, efeito ambíguo e reconciliação.
- Git, banco, DNS, Cloudflare e providers: código gerado não é autorização para aplicar.

## 3 — Verificação

- Teste focado primeiro; depois checks e integração relevantes **que de fato existam**.
- Não troque PG18 real nem workerd por mocks em riscos que exigem comportamento real.
- Reproduza falhas de concorrência, acesso cruzado e resultado externo incerto quando o domínio exigir.
- Releia o diff atrás de segredos e flags acidentais; atualize a documentação canônica se o contrato mudou.
- Se algo não puder rodar por falta de ambiente ou serviço, registre o bloqueio: status `implemented` ou `blocked`, nunca `verified`.
- **Não escreva testes sobre prosa de documentação ou YAML de workflows** (o legado acumulou ~80 assim e pagou o custo).

## 4 — Entrega e handoff

```text
Tarefa: M?-??
Status comprovado: implemented | verified | homologated | blocked
Arquivos criados/alterados: ...
Comandos executados e resultado: ...
Critérios de aceite: passou / pendente + evidência
Riscos e limitações: ...
Próxima tarefa recomendada: ... (não executada)
```

Atualize o `STATUS.md` **somente** com evidências concretas.

## 5 — Decisões e exceções

Para domínio, custo, arquitetura ou segurança: **problema → evidência → alternativas → trade-offs → recomendação → decisão explícita → ADR nova ou emenda, com a antiga `superseded`**. Não relaxe invariantes para deixar testes verdes. Não copie regra do legado sem conferir a decisão vigente.

## 6 — Commits e releases

Nenhum agente faz commit, push, deploy ou migration remota sem autorização contextual. O GitHub Free privado não impõe required checks: revise PRs e verifique a identidade da release à parte. Segredos de Production nunca ficam no CI comum; a release de Production é manual, com preflight, backup, compatibilidade e smoke.
