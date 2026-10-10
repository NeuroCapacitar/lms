# Produto — NeuroCapacitar Hub vNext

**Estado:** decisões fechadas em 2026-10-10 ([relatório](docs/review/relatorio-final.md)); código não implementado.

## O que é

LMS da **NeuroCapacitar** para vender e entregar cursos online. **PROTEA-R é um curso, não a marca da plataforma.** Substitui o Hub legado (Next.js/Vercel) e sai da Vercel para a Cloudflare.

## Para quem

- **Alunos:** profissionais adultos (18+) de saúde e educação (hoje, psicólogas e neuropsicólogas). Escala atual: ~20 pessoas, 1 curso em produção, 2 cursos novos planejados.
- **Staff:** 1 Admin e 3 pessoas de Suporte, com permissões granulares. Quem desenvolve: 1 dev + agentes de IA.

## O que o Hub faz (v1)

Catálogo e página de cada curso · cadastro e login por magic link (Google e senha opcionais para o aluno) · matrícula gratuita e compra paga (Asaas, Pix e cartão até 12x) · aulas em texto e vídeo, quiz simples e discussões mínimas · drip por módulo e sequência guiada ou livre · progresso e conclusão · certificado em PDF com validação pública · e-mails transacionais e marketing com consentimento · PWA offline para o aluno · painel da Staff, matrícula manual, reembolso, moderação e fila operacional.

## O que não faz (v1)

Boleto, nota fiscal (NFS-e), cupons, bundles, assinatura, compra sem login, vitalício, notas pessoais do aluno, troca de e-mail e exclusão de conta self-service (pedidos por e-mail ao suporte), Web Push, CSV, SSR, app nativo, IA tutora, SCORM, comunidade tipo rede social.

## Princípios

1. Complexidade só onde protege dinheiro, acesso, privacidade ou durabilidade.
2. Experiência do aluno acolhedora e confortável; a Staff usa a mesma linguagem visual.
3. Linguagem neutra ("Boas-vindas", "Pessoas inscritas"); aviso contra dados identificáveis de pacientes nas discussões.
4. Teto de infraestrutura de US$ 10/mês; vídeo e Asaas são custos do cliente.

Fontes: [decisões](docs/decisions.md) · [ADRs](docs/adr/) · [domínio](docs/spec/domain.md).
