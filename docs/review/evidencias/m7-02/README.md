# Evidência M7-02: primeiro PDF do Browser Run REAL em Staging

**Data:** 2026-10-15 (01:31 UTC) · **Ambiente:** Staging (`hub-staging`, SHA `bbe8a53`) · **Dados:** 100% sintéticos (aluna `certificado.teste@example.test`, emitente e signatário de teste; nenhuma pessoa real).

| Item | Resultado |
|---|---|
| Caminho | conclusão do curso → certificado `queued` + intenção na outbox → Cron (*/30) republica → fila `general` → handler → `env.BROWSER.quickAction('pdf')` → R2 privado → `ready` |
| Tentativas | 1 (a intenção ficou 16 min na outbox esperando o Cron; o render em si levou ~1 s) |
| Arquivo | `certificado-staging.pdf` (120 180 bytes) |
| SHA-256 | `c8fba389360bc534b7af8c295e4e047707a4402f231debb25fe1897ce77029a7` = hash gravado no banco = hash do objeto baixado do R2 (conferido) |
| Páginas | 1 (`/Type /Page` contado) |
| Tamanho da página | MediaBox 841,92 × 594,96 pt = A4 paisagem |
| Fontes | 8 fontes Type 3 (como o spike M0-15: o Skia converte a fonte variável); texto selecionável |
| Texto extraído (`pdftotext -enc UTF-8`) | "CERTIFICADO DE CONCLUSÃO", "Maria Aparecida de Nazaré Çavalcanti d’Ávila", "carga horária de 3 horas, em 14 de outubro de 2026", emitente, CNPJ e código: acentos, ç e apóstrofo corretos |
| Links e JavaScript no PDF | 0 e 0 |
| Producer | Skia/PDF m128 |

**Limites desta evidência (não é o gate M7-09):** conferi só estrutura e texto; NÃO conferi a posição dos campos em mm contra o layout, o QR com um leitor, as fontes com `pdffonts` (não instalado aqui) nem o arquivo em leitores de PDF diferentes. O horário "14 de outubro" é o dia de São Paulo (01:31 UTC do dia 15). O endereço de validação quebra em três linhas na caixa de 70 mm (melhorar no M7-09). Download pela rota autenticada do aluno NÃO foi exercitado em Staging (exige sessão).
