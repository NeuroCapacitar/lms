import { afterEach, describe, expect, it } from 'vitest';

import { busyReasons, markBusy, resetBusyForTests } from './safe-boundary';

afterEach(() => resetBusyForTests());

describe('fronteira segura de atualização', () => {
  it('começa livre; marcar ocupa; desmarcar libera', () => {
    expect(busyReasons()).toEqual([]);
    const release = markBusy('vídeo tocando');
    expect(busyReasons()).toEqual(['vídeo tocando']);
    release();
    expect(busyReasons()).toEqual([]);
  });

  it('vários motivos juntos; cada um sai sozinho; motivo repetido aparece uma vez', () => {
    const a = markBusy('quiz em andamento');
    const b = markBusy('formulário não salvo');
    const c = markBusy('quiz em andamento');
    expect([...busyReasons()].sort()).toEqual(['formulário não salvo', 'quiz em andamento']);
    a();
    expect([...busyReasons()].sort()).toEqual(['formulário não salvo', 'quiz em andamento']);
    c();
    expect(busyReasons()).toEqual(['formulário não salvo']);
    b();
    expect(busyReasons()).toEqual([]);
  });

  it('desmarcar duas vezes é seguro (idempotente) e não derruba o motivo de outro', () => {
    const first = markBusy('sincronizando');
    const second = markBusy('sincronizando');
    first();
    first();
    expect(busyReasons()).toEqual(['sincronizando']);
    second();
    expect(busyReasons()).toEqual([]);
  });
});
