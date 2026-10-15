# M8 — PWA e estudo offline

**Estado:** especificação vigente (2026-10-10); código não implementado.

**Entrega.** O Hub é instalável e a **área do aluno (Student)** funciona offline de forma seletiva: texto e imagens de aulas já visitadas, progresso concluível offline e sincronizado depois. `vite-plugin-pwa` em `injectManifest` com Service Worker próprio; dados offline em IndexedDB e Cache API **separados por usuário**; lease de acesso offline `min(expiração do Entitlement, última verificação + 72 h)`; outbox offline com allowlist e `clientOperationId`; **vídeo sempre online; envio de quiz sempre online**; logout com purga e `Clear-Site-Data`; atualização do app em fronteira segura. **Staff é online-only** (nada da Staff é cacheado). Decisão Q14, exceção deliberada à regra de corte.

**Gate de aceite (P-15, bloqueador).** O roteiro de M8-04 passa em **iPhone/Safari real** (navegador e PWA instalada) e em Chromium + WebKit automatizados. **Se o gate falhar, o release offline é bloqueado:** a v1 sai com o recurso desligado (kill switch de M8-01) e a falha vira decisão registrada; não se libera offline "por emulação". Emulação de WebKit no desktop não substitui o aparelho.

**Pendências:** PENDENTE (responsável/cliente) um iPhone físico para o gate; PENDENTE (decisão no M8-02) se anexos/PDFs de material podem ser baixados para offline (padrão proposto: não). Comportamento de `Clear-Site-Data`, Background Sync e persistência de storage no Safari: **verificar no aparelho**, não assumir.

**Notas de IDs.** M8-01..M8-04 mantidos. O item "purge no logout/troca de conta" saiu do antigo M8-02 para M8-05 (merece prova própria); a parte "certificados offline" saiu do antigo M8-04 para M8-06. M8-04 passa a ser só o gate. Novos: M8-05, M8-06.

Ordem sugerida: M8-01 → M8-02 → M8-05 → M8-03 → M8-06 → M8-04.

---

### M8-01 — Manifest, Service Worker (injectManifest) e atualização segura

**Dependências:** M3-05 (jornada gratuita E2E), M0-07 · **Estado:** `verified` no CI e registrado em Staging (2026-10-15; só Chromium; WebKit e iPhone real NÃO exercitados; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** App instalável, shell estático em cache, Staff fora do cache e update sem interromper ação crítica.

**Passos**
1. `vite-plugin-pwa` com `strategies: 'injectManifest'`, SW em `src/sw.ts`; manifest (nome, ícones, `display: standalone`, `scope`/`start_url` da área do aluno).
2. Precache **somente** do shell estático com hash. Navegações em denylist vão sempre à rede: `/api/`, rotas da Staff, `/certificados/`, `/comprar/`, checkout, `/cdn-cgi/`. `run_worker_first: ["/api/*"]` permanece.
3. Atualização: `registerType: 'prompt'`; o SW novo fica `waiting` e só é ativado numa **fronteira segura** (sem vídeo tocando, sem formulário sujo, sem quiz em andamento, sem outbox sincronizando). Nunca `skipWaiting` automático.
4. Incompatibilidade de versão: o cliente envia a versão do app; a API responde `409 client_outdated` quando necessário e a UI pede recarga.
5. **Kill switch:** um build/flag que serve um SW de desativação (limpa caches e se desregistra). `sw.js` e `index.html` com `Cache-Control: no-cache`.

**Testes.** Instalação; reload durante vídeo/quiz/formulário sujo não aplica update; rota da Staff offline mostra "somente online" e **nenhuma** entrada de Staff aparece no Cache Storage; deploy novo com cliente antigo; kill switch remove SW e caches; checagem de instalabilidade.

**Aceite.** Evidência (capturas/saída dos testes) de cada teste acima em Staging.

**Fora do escopo / cuidados.** Não usar `autoUpdate` cego. Não cachear respostas de `/api/*` no SW (dados offline ficam no IndexedDB, M8-02). Nada financeiro/admin em cache.

---

### M8-02 — Armazenamento offline por usuário e lease

**Dependências:** M8-01, M3-01 · **Estado:** `implemented` (2026-10-15; só Chromium; WebKit/iPhone, Staging e purga no logout NÃO; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Dados offline isolados por conta e com validade limitada.

**Passos**
1. Banco IndexedDB nomeado por hash do `userId`; store `meta` com `{userId, lastVerifiedAt, leaseUntil, maxSeenClock}`. Nunca guardar cookies, tokens ou segredos.
2. `POST /api/offline/lease` (sessão + CSRF) devolve `serverNow` e, por curso, `leaseUntil = min(expiresAt do Entitlement, serverNow + 72 h)`; renovado a cada verificação online.
3. Guardar, para lições **já visitadas e já liberadas pelo drip**: JSON da aula, metadados e imagens inline (Cache API por usuário). Materiais anexos: PENDENTE (padrão proposto: não baixar).
4. Leitura offline: antes de renderizar, checar o lease do curso; expirado → bloquear com mensagem clara. Relógio: se `Date.now() < maxSeenClock − tolerância`, tratar como expirado até reverificar.
5. Cota e evicção: `navigator.storage.estimate()`; `persist()` só como tentativa; o app tolera ausência de dados; versão de schema do IndexedDB com purga em migração incompatível.

**Testes.** Usuário A→B no mesmo navegador; relógio adiantado e atrasado; lease expirado sem rede; Entitlement revogado entre verificações (vale até o fim do lease: limite documentado); cache evictado; duas abas; armazenamento cheio.

**Aceite.** Nenhum dado de A aparece a B; acesso offline cessa conforme a política; testes verdes.

**Fora do escopo / cuidados.** Offline **não** é DRM nem controle forte (o relógio do aparelho é do usuário). Vídeo nunca é guardado. Conta com papel de Staff: nada da Staff é guardado.

---

### M8-03 — Outbox offline e sincronização

**Dependências:** M8-02, M3-04 · **Estado:** `implemented` (2026-10-15; só Chromium; migration 0039 e Staging NÃO; WebKit/iPhone NÃO; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Ações permitidas feitas offline convergem ao reconectar, sem criar progresso indevido.

**Passos**
1. Allowlist inicial (decisão deliberada): **concluir aula de texto**. Qualquer outro comando exige decisão. Cada item na outbox: `clientOperationId` (UUID), comando, payload validado por Zod, `createdAt`, tentativas.
2. Sincronizar ao reconectar, ao abrir o app e em `visibilitychange`; usar Background Sync só onde existir (Safari não depende dele).
3. `POST /api/offline/sync` em lote ordenado: cada comando passa pelo **mesmo caso de uso online** (Entitlement, drip, estado da aula); idempotente por `(user_id, clientOperationId)` em tabela própria; usuário vem da sessão, nunca do payload; resultado por item `applied | duplicate | rejected(motivo)`.
4. UI mostra pendências e rejeições (aula removida, acesso expirado); nunca descarta em silêncio. Hora do fato = hora do servidor; hora do cliente só como metadado.
5. Sessão expirada (401) mantém a outbox; só sincroniza depois de novo login do **mesmo** usuário.

**Testes.** Sync duplicado; acesso revogado enquanto offline; aula removida; comando fora da allowlist e payload malformado; tentativa de enviar quiz offline (UI bloqueia e o servidor não expõe comando); `userId` forjado no payload ignorado; reconexão intermitente.

**Aceite.** Reconexão converge; contagem de conclusões = contagem esperada.

**Fora do escopo / cuidados.** Quiz e vídeo permanecem online. Não criar fila genérica de requisições.

---

### M8-04 — Gate: Chromium, WebKit e iPhone/Safari real

**Dependências:** M8-03, M8-05, M8-06 · **Estado:** `in_progress` (2026-10-15; roteiro em `docs/operations/gate-m8-04-roteiro.md` e tela `/diagnostico` prontos; o gate NÃO foi executado: falta o iPhone físico e autorização para instalar o WebKit do Playwright)

**Objetivo.** Decidir, com evidência, se o offline entra no release.

**Passos**
1. Playwright em Chromium e **WebKit**: offline/throttling, update seguro, cache corrompido, troca de usuário.
2. Chrome/Edge desktop e Android (Chromium) reais.
3. **iPhone real**, Safari e PWA adicionada à tela inicial: instalar → abrir aula → modo avião → ler e concluir aula de texto → reconectar e conferir sync → logout (verificar que IndexedDB/caches ficaram vazios) → login de outra conta → lease expirado (alterar data do aparelho) → atualização do app → comportamento de armazenamento após dias sem uso.
4. Evidência: modelo do aparelho, versão do iOS, SHA do build, gravação de tela, resultado por item; **sem dados reais**.
5. Falha em item crítico (isolamento de conta, purga no logout, lease, outbox idempotente, update seguro) → acionar o kill switch, liberar a v1 sem offline e registrar a decisão em `STATUS.md`.

**Testes.** O próprio roteiro; repetir após qualquer mudança no SW.

**Aceite.** Roteiro 100% nos itens críticos no iPhone real, ou kill switch ligado e decisão registrada.

**Fora do escopo / cuidados.** Nunca inferir iOS a partir de emulação. Depende de dispositivo fornecido pelo responsável/cliente.

---

### M8-05 — Logout, troca de conta e `Clear-Site-Data`

**Dependências:** M8-02, M8-03, M1-01, M1-06 (magic link) · **Estado:** `implemented` SEM o passo 1 (outbox, do M8-03) (2026-10-15; só Chromium; WebKit/iPhone e Staging NÃO; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** Sair da conta deixa o aparelho limpo, mesmo offline.

**Passos**
1. Logout online: tentar sincronizar a outbox com timeout curto; se sobrarem itens, avisar e pedir confirmação antes de descartar.
2. Purga **por JavaScript** (IndexedDB e Cache API do usuário, caches do SW, localStorage/sessionStorage, estado do TanStack Query) e, na resposta do logout, `Clear-Site-Data` como defesa adicional; não depender só do header (suporte no Safari a verificar no aparelho).
3. Detecção de troca de conta: se a sessão atual difere de `activeUserId`, purgar **antes** de renderizar qualquer dado local.
4. Todas as abas reagem (BroadcastChannel). Sessão revogada pelo servidor (suspensão) → purga no próximo contato online.
5. Logout offline: purga local imediata; revogação da sessão no servidor ocorre ao reconectar.

**Testes.** A→B; logout offline; logout com outbox pendente; aba antiga de A aberta após logout; após logout `indexedDB.databases()` e `caches.keys()` vazios; PDF/prévia de certificado de A inacessível a B; sessão expirada.

**Aceite.** Testes verdes em Chromium/WebKit e roteiro de M8-04 no iPhone.

**Fora do escopo / cuidados.** Login continua exigindo rede (magic link): não existe login offline.

---

### M8-06 — Certificados offline (prévia com marca de verificação)

**Dependências:** M8-02, M7-04 · **Estado:** `implemented` (2026-10-15; só Chromium; Staging e WebKit/iPhone NÃO; sem a prévia leve do snapshot; evidência em `docs/implementation/STATUS.md`)

**Objetivo.** A pessoa consulta seus certificados offline sem ver "válido" desatualizado.

**Passos**
1. Guardar metadados (curso, data, código, estado) e prévia leve do snapshot, sempre com "verificado em <data/hora>".
2. PDF offline **somente** se a pessoa o baixou explicitamente; guardado por usuário com o SHA-256 para conferência.
3. Ao sincronizar: estado `revoked/superseded` atualiza a lista e **remove** o PDF local.
4. Nunca exibir "válido" sem a data da última verificação.

**Testes.** Revogado depois do download offline (remove ao sincronizar); cache adulterado (hash diverge → descarta); troca de usuário e logout purgam; PDF de outro usuário inacessível.

**Aceite.** Testes verdes; roteiro de M8-04 inclui um certificado.

**Fora do escopo / cuidados.** Offline não garante revogação imediata de cópia já baixada; dizer isso na UI.
