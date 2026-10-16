import { describe, expect, it } from 'vitest';

import { parsePastedLink } from './pasted-link';

const ORIGIN = 'https://hub.example.test';
const TOKEN = 'abcdEFGH1234ijklMNOP5678qrstUVWX';
const LINK = `${ORIGIN}/entrar/confirmar#token=${TOKEN}`;

describe('link de acesso colado', () => {
  it('aceita o link do e-mail e devolve só o token', () => {
    expect(parsePastedLink(LINK, ORIGIN)).toEqual({ kind: 'ok', token: TOKEN });
  });

  it('tolera espaços, quebra de linha, aspas e texto em volta (cópia de e-mail)', () => {
    expect(parsePastedLink(`  \n${LINK}\n  `, ORIGIN)).toEqual({ kind: 'ok', token: TOKEN });
    expect(parsePastedLink(`"${LINK}"`, ORIGIN)).toEqual({ kind: 'ok', token: TOKEN });
    expect(parsePastedLink(`Entrar: ${LINK} (vale 15 minutos)`, ORIGIN)).toEqual({
      kind: 'ok',
      token: TOKEN,
    });
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar/#token=${TOKEN}`, ORIGIN)).toEqual({
      kind: 'ok',
      token: TOKEN,
    });
  });

  it('decodifica o token codificado na URL', () => {
    expect(
      parsePastedLink(`${ORIGIN}/entrar/confirmar#token=${encodeURIComponent(TOKEN)}`, ORIGIN),
    ).toEqual({ kind: 'ok', token: TOKEN });
  });

  it('recusa vazio e texto que não é um endereço', () => {
    expect(parsePastedLink('', ORIGIN)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parsePastedLink('   \n ', ORIGIN)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parsePastedLink(TOKEN, ORIGIN)).toEqual({ kind: 'invalid', reason: 'not_a_link' });
    expect(parsePastedLink('olá, tudo bem?', ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'not_a_link',
    });
  });

  it('NUNCA aceita link de outro site (mesmo com o caminho e o token certos)', () => {
    expect(parsePastedLink(`https://evil.example/entrar/confirmar#token=${TOKEN}`, ORIGIN)).toEqual(
      { kind: 'invalid', reason: 'other_site' },
    );
    expect(
      parsePastedLink(`http://hub.example.test/entrar/confirmar#token=${TOKEN}`, ORIGIN),
    ).toEqual({ kind: 'invalid', reason: 'other_site' });
    expect(
      parsePastedLink(
        `https://hub.example.test.evil.example/entrar/confirmar#token=${TOKEN}`,
        ORIGIN,
      ),
    ).toEqual({ kind: 'invalid', reason: 'other_site' });
  });

  it('recusa outra página do mesmo site', () => {
    expect(parsePastedLink(`${ORIGIN}/cursos#token=${TOKEN}`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'wrong_page',
    });
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar/x#token=${TOKEN}`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'wrong_page',
    });
  });

  it('o link de "confirmar identidade" (reauth) não abre sessão: recusado', () => {
    expect(parsePastedLink(`${LINK}&purpose=reauth`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'reauth',
    });
  });

  it('sem token, com token curto demais ou com caracteres estranhos: recusado', () => {
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'no_token',
    });
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar#token=abc`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'no_token',
    });
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar#token=${TOKEN}$$$`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'no_token',
    });
    expect(parsePastedLink(`${ORIGIN}/entrar/confirmar#token=${'a'.repeat(513)}`, ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'no_token',
    });
  });
});
