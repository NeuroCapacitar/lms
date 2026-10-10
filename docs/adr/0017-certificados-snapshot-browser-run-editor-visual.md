# ADR-0017 — Certificados: snapshot imutável, PDF por Browser Run e editor visual mantido

- **Estado:** accepted-conditional
- **Data:** 2026-10-10
- **Origem:** Q15, Q37 (Q30, Q60)
- **Substitui:** PNG de preview persistido e PDF público irrestrito do legado

## Contexto

O legado gastou cerca de 17 mil linhas e 39 documentos em certificados, com renderer PDFKit/Sharp, que não roda em Workers (evidência: L2 §7.3, §11). O Browser Run (antigo Browser Rendering) oferece `/pdf` por binding sem token, e o uso previsto cabe nas 10 horas mensais incluídas (W1 §H). Não há norma federal sobre campos de certificado de curso livre, nem prazo legal específico para reter PDF revogado (W3 §4.3, §5.3).

## Decisão

- `CourseCompletion` histórico dispara emissão assíncrona e idempotente. Snapshot imutável dos dados impressos; código opaco.
- PDF gerado de HTML/CSS controlado via Browser Run (Quick Action `/pdf`), com Lexend Deca embutida, dados escapados e rede externa bloqueada. Armazenado em R2 privado com SHA-256.
- Editor visual A4 mantido, como exceção deliberada à regra de corte (Q15).
- Página pública mínima por código (sem CPF, e-mail ou pagamento) e sem download público do PDF. Se ela exibe o nome do titular: PENDENTE (modelagem). Confirmação do nome antes da 1ª emissão: PENDENTE (modelagem).
- Revogação (só Admin) e reemissão (grant) auditadas. Reembolso não revoga certificado já emitido.
- Retenção do PDF revogado por 90 dias: **CONDICIONAL** a parecer jurídico (PENDENTE: advogado). O registro mínimo de revogação (código, status, hash) permanece.

## Consequências

O editor visual é custo alto para valor baixo, aceito pelo responsável. Sessões do Browser Run caem em rollouts da plataforma, então a emissão precisa de retry. Certificado de curso livre não pode citar reconhecimento do MEC.

## Como validar

spike M0-15 (PDF com Lexend Deca, acentos e nomes longos). Gate de paridade entre snapshot e PDF (P-18) antes de liberar o editor. Testes de autorização, integridade SHA-256, escape e SSRF.
