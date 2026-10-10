# ADR-0019 — PWA offline seletivo apenas para Student, com gate de iPhone real

- **Estado:** accepted-conditional
- **Data:** 2026-10-10
- **Origem:** Q14 (exceção deliberada à regra de corte Q11); Q58
- **Substitui:** —

## Contexto

O legado não tem PWA nem demanda registrada por offline; é uma aposta de produto (evidência: L2 §12). No Safari, caches do service worker podem ser apagados após 7 dias sem interação fora da tela inicial, o storage é best-effort com eviction LRU, e não há Background Sync (W2 §9). O responsável manteve o PWA como exceção.

## Decisão

- Offline apenas para Student. Staff só online. Vídeo sempre online; submissão de quiz online.
- Lease máximo `min(entitlement, última verificação + 72 h)`; o lease tolera perda total do cache.
- `vite-plugin-pwa` em `injectManifest`, com service worker próprio e pequeno.
- Cache e IndexedDB nomeados por `userId`; nunca cachear `/api/auth/*` nem dado sensível sem chave do usuário. No logout, apagar os dados do usuário e responder com `Clear-Site-Data`.
- Outbox offline com allowlist de comandos, drenada em `online`, `visibilitychange` e abertura do app (sem depender de Background Sync).
- Entrega por último no roadmap (Q58). O release offline só sai depois do gate P-15 (iPhone real).

## Consequências

Custo de manutenção alto para uma capacidade sem uso comprovado. Se o gate falhar, o release offline não ocorre e o núcleo online segue inalterado. Playwright com WebKit ajuda, mas não substitui o iOS real.

## Como validar

Gate P-15: teste em iPhone real (instalado e no Safari), cobrindo troca de usuário, logout, expiração de lease, offline, reconexão e perda do cache. Testes automatizados de isolamento de cache por conta e de outbox allowlisted. Nenhum resultado existe ainda.
