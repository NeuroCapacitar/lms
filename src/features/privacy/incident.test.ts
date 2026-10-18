import { describe, expect, it } from 'vitest';

import {
  canClose,
  canTransition,
  createIncidentSchema,
  looksLikePersonalData,
  updateIncidentSchema,
} from './incident';

const valid = {
  title: 'Segredo exposto em um commit',
  description: 'Uma chave de teste apareceu em um commit; trocada no mesmo dia.',
  category: 'exposure',
};

describe('o registro nunca guarda dado pessoal de quem foi afetado', () => {
  it('reconhece e-mail, CPF, CNPJ, telefone e link de acesso', () => {
    for (const text of [
      'a conta ana.souza@example.com foi exposta',
      'CPF 123.456.789-09 da pagadora',
      'cpf 12345678909',
      'CNPJ 12.345.678/0001-99',
      'cnpj 12345678000199',
      'ligar para (11) 91234-5678',
      'tel 11 91234 5678',
      'link https://app.example.test/magic/AbCdEfGhIjKlMnOp',
    ]) {
      expect(looksLikePersonalData(text), text).toBe(true);
    }
  });

  it('deixa passar o que descreve o incidente sem identificar ninguém', () => {
    for (const text of [
      'Cerca de 150 pessoas tiveram o nome exposto por 3 horas.',
      'Um segredo de teste apareceu num commit em 12/10/2026 e foi trocado.',
      'Backup copiado para a pasta errada; 2 arquivos, 14 MB.',
      'A resposta da API trouxe o progresso de outra pessoa.',
    ]) {
      expect(looksLikePersonalData(text), text).toBe(false);
    }
  });
});

describe('corpo de criação', () => {
  it('aceita o mínimo e preenche os padrões', () => {
    const parsed = createIncidentSchema().parse(valid);
    expect(parsed).toMatchObject({
      dataKinds: [],
      affectedCount: null,
      occurredAt: null,
      actionsTaken: '',
    });
    expect(parsed.detectedAt).toBeUndefined();
  });

  it('recusa campo desconhecido, categoria inventada, número negativo e título curto', () => {
    const schema = createIncidentSchema();
    expect(schema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, category: 'invented' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, affectedCount: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, title: 'ab' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, dataKinds: ['cpf_em_claro'] }).success).toBe(false);
  });

  it('recusa dado pessoal no título, na descrição e nas ações, com um código próprio', () => {
    const schema = createIncidentSchema();
    for (const field of ['title', 'description', 'actionsTaken'] as const) {
      const result = schema.safeParse({ ...valid, [field]: 'avisei ana.souza@example.com ontem' });
      expect(result.success, field).toBe(false);
      if (!result.success)
        expect(result.error.issues.some((issue) => issue.message === 'personal_data_in_text')).toBe(
          true,
        );
    }
  });

  it('as datas viram Date e exigem fuso', () => {
    const schema = createIncidentSchema();
    const parsed = schema.parse({ ...valid, detectedAt: '2026-10-18T12:00:00Z' });
    expect(parsed.detectedAt).toBeInstanceOf(Date);
    expect(schema.safeParse({ ...valid, detectedAt: '2026-10-18T12:00:00' }).success).toBe(false);
  });
});

describe('corpo de atualização', () => {
  it('exige ao menos um campo e recusa o que não é editável', () => {
    const schema = updateIncidentSchema();
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ title: 'novo título' }).success).toBe(false);
    expect(schema.safeParse({ status: 'contained' }).success).toBe(true);
    expect(schema.safeParse({ status: 'reaberto' }).success).toBe(false);
  });
});

describe('ciclo do incidente', () => {
  it('só anda para a frente e encerrado é definitivo', () => {
    expect(canTransition('open', 'contained')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(true);
    expect(canTransition('contained', 'contained')).toBe(true);
    expect(canTransition('contained', 'open')).toBe(false);
    expect(canTransition('closed', 'closed')).toBe(false);
    expect(canTransition('closed', 'open')).toBe(false);
  });

  it('encerrar exige o risco avaliado e a comunicação decidida', () => {
    expect(canClose({ riskAssessment: 'not_assessed', communication: 'not_required' })).toBe(false);
    expect(canClose({ riskAssessment: 'low', communication: 'pending' })).toBe(false);
    expect(canClose({ riskAssessment: 'low', communication: 'not_required' })).toBe(true);
    expect(canClose({ riskAssessment: 'relevant', communication: 'communicated' })).toBe(true);
  });
});
