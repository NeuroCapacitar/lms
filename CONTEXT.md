# Glossário — Hub vNext

Os termos e invariantes completos estão em [docs/spec/domain.md](docs/spec/domain.md). Este arquivo só orienta a navegação.

- **Course / Offer:** o curso pedagógico e a condição comercial (gratuita ou paga, preço em centavos, prazo em meses). Um Course tem várias Offers.
- **Currículo vivo:** módulos e aulas com IDs estáveis, editados em rascunho e publicados de forma atômica. Não há releases imutáveis.
- **Entitlement / Enrollment:** a origem do direito de acesso (compra, oferta gratuita, concessão manual) e a projeção efetiva dele. Âncora de drip única por pessoa e curso.
- **Staff / Admin / Suporte:** papéis não exclusivos com grants granulares. A Staff entra só por magic link e tem "prévia de aluno" sem gravar progresso.
- **LessonCompletion / CourseCompletion:** fatos pedagógicos; a conclusão do curso é histórica e nunca apagada.
- **Order / CheckoutSession / Payment / RefundRequest:** entidades comerciais e evidência financeira distintas.
- **VideoAsset / VideoProviderConnection:** vídeo de um provider (JMVStream, Panda, Cloudflare Stream, Mux, YouTube, Vimeo) com capabilities verificáveis.
- **MediaAsset:** arquivo no R2 (público só para capas e banners).
- **Certificate:** artefato imutável com PDF privado e validação pública mínima.
- **Outbox / Inbox:** fatos duráveis no Postgres; as filas só aceleram.
- **Staff vs. pedido por e-mail:** desistência, exclusão, dados e troca de e-mail são pedidos ao suporte, executados por procedimento manual.
- **PROTEA-R:** um curso. A plataforma é NeuroCapacitar.

Mudanças de significado entram na especificação e no código, não só aqui.
