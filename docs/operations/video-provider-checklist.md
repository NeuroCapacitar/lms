# Verificação de provider de vídeo (M5-03)

Modelo ÚNICO usado por M5-08 a M5-13. Um provider só é usável em **Production** depois de passar neste checklist com **conta real do cliente** (ADR 0015: "adapter sem teste fica desativado"). Mock, fixture e o adapter falso **não** valem como verificação.

## O que o CI já prova (offline, sem conta)

- `src/web/video/adapter-contract.ts`: allowlist de hosts, embed só de `buildEmbed` e dentro da allowlist, ID hostil não troca o host, `origin` do embed igual ao do `src`, `resume` honesto, lixo nunca derruba o `normalize`, capability **declarada ⇒ evento com fixture** (e o inverso), todo host em `frame-src` de `public/_headers`.
- `src/features/video/provider-adapter-contract.ts`: normalização de ID/URL (hostil recusado), estado do asset por fixtures, falha/timeout como `ProviderError` **sem vazar o texto da rede**, `deleteAsset` só com `managedUpload` e só para asset `managed` (nunca `referenced`, sem chamar o provider ao recusar).
- `src/server/video/activation.test.ts`: provider em `VERIFIED_PROVIDERS` exige adapter registrado **e** a entrada de evidência no STATUS.

Cada tarefa de adapter acrescenta: o adapter em `src/web/video/adapters.ts` e `src/server/video/provider-adapters.ts`, a fixture gravada em `adapter-contract.test.ts` e em `activation.test.ts`, e o host em `frame-src` (`public/_headers`).

## Checklist com conta real (manual)

Registre data, tipo/plano da conta, navegador e dispositivo, e o resultado de **cada** item (`ok`, `falhou`, `não foi possível`, com o motivo).

1. Reproduzir (play) e pausar; o heartbeat chega ao servidor só enquanto reproduz.
2. Seek ao limiar: 89% **não** conclui; 90% conclui (política do curso).
3. Velocidade 2×: a posição enviada continua coerente.
4. Aba oculta por mais de 5 min: o progresso é enviado ao ocultar (`visibilitychange`) e ao voltar.
5. iPhone real (Safari) em tela cheia e ao sair dela.
6. `ended` com autoplay e loop **desligados**: o evento chega? Se não, `reportsEnded` fica `false` (sem autoavanço).
7. Perda de rede no meio: o próximo envio recupera (flush) e o `seq` segue crescente.
8. Domínio **não** autorizado: o player recusa tocar.
9. Token/URL assinada expirada: erro claro, sem quebrar a tela.
10. Vídeo removido/privado: estado `unavailable` para a Staff e mensagem ao aluno.
11. `event.origin` e `event.source` falsos: a mensagem é ignorada.
12. Legenda (WCAG 1.2.2, nível A): o provider/adapter suporta? Registrar a lacuna se não.

## Como ativar (só depois do checklist)

1. Acrescente a entrada abaixo ao `docs/implementation/STATUS.md` (o título exato é exigido pelo teste).
2. Em um PR, acrescente o provider a `VERIFIED_PROVIDERS` (`src/features/video/verification.ts`) no(s) ambiente(s) onde a conta real foi exercitada. Production só depois de passar em Staging.
3. O CI reprova o PR se faltar adapter, fixture de contrato ou a entrada no STATUS.

```markdown
### Verificação de provider — <provider> (AAAA-MM-DD)

- **Conta:** tipo/plano, de quem é, ambiente onde foi testada.
- **Dispositivos:** navegador e versão, iPhone real (modelo/iOS).
- **Resultado por item (1 a 12):** ok | falhou | não foi possível (motivo).
- **Capabilities confirmadas:** reportsTime, reportsEnded, reportsSeek, resume, duração (api|player); managedUpload, signedPlayback, domainRestriction.
- **Não foi possível verificar:** ...
- **Ativado em:** staging | production (SHA do PR).
```
