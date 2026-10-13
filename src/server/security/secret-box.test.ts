import { describe, expect, it } from 'vitest';

import {
  DecryptionError,
  SecretBoxConfigError,
  UnknownKeyVersionError,
  openSecret,
  parseKeyring,
  sealSecret,
} from './secret-box';

const key = (seed: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)));
const RING = `1:${key(1)},2:${key(2)}`;
const AAD = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10:panda';
const SECRET = 'segredo falso da conta 1';

describe('cofre AES-GCM', () => {
  it('cifra e abre (ida e volta) com a chave corrente, a mais alta', async () => {
    const ring = await parseKeyring(RING);
    expect(ring.currentVersion).toBe(2);
    const sealed = await sealSecret(ring, SECRET, AAD);
    expect(sealed.keyVersion).toBe(2);
    expect(await openSecret(ring, sealed, AAD)).toBe(SECRET);
  });

  it('o texto cifrado não contém o segredo nem o reproduz em claro', async () => {
    const ring = await parseKeyring(RING);
    const sealed = await sealSecret(ring, SECRET, AAD);
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
    expect(atob(sealed.ciphertext)).not.toContain('segredo falso');
  });

  it('o nonce NUNCA repete em 1.000 cifragens (nonce aleatório de 96 bits) e o texto cifrado também muda', async () => {
    const ring = await parseKeyring(RING);
    const nonces = new Set<string>();
    const ciphertexts = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const sealed = await sealSecret(ring, SECRET, AAD);
      expect(atob(sealed.nonce)).toHaveLength(12);
      nonces.add(sealed.nonce);
      ciphertexts.add(sealed.ciphertext);
    }
    expect(nonces.size).toBe(1000);
    expect(ciphertexts.size).toBe(1000);
  });

  it('AAD trocado (outra conexão ou outro provider) não abre', async () => {
    const ring = await parseKeyring(RING);
    const sealed = await sealSecret(ring, SECRET, AAD);
    await expect(
      openSecret(ring, sealed, '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10:mux'),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(openSecret(ring, sealed, 'outra-conexao:panda')).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('texto cifrado, tag ou nonce adulterados não abrem (e o erro não diz qual)', async () => {
    const ring = await parseKeyring(RING);
    const sealed = await sealSecret(ring, SECRET, AAD);
    const bytes = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 1;
    const tampered = { ...sealed, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await expect(openSecret(ring, tampered, AAD)).rejects.toThrow('decryption_failed');
    const lastByte = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    lastByte[lastByte.length - 1] = lastByte.at(-1)! ^ 1;
    await expect(
      openSecret(ring, { ...sealed, ciphertext: btoa(String.fromCharCode(...lastByte)) }, AAD),
    ).rejects.toBeInstanceOf(DecryptionError);
    const otherNonce = (await sealSecret(ring, 'x', AAD)).nonce;
    await expect(openSecret(ring, { ...sealed, nonce: otherNonce }, AAD)).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await expect(openSecret(ring, { ...sealed, nonce: '@@@' }, AAD)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('versão de chave desconhecida falha com erro claro; a antiga continua abrindo o que cifrou', async () => {
    const old = await parseKeyring(`1:${key(1)}`);
    const sealedWithOld = await sealSecret(old, SECRET, AAD);
    expect(sealedWithOld.keyVersion).toBe(1);

    const both = await parseKeyring(RING);
    expect(await openSecret(both, sealedWithOld, AAD)).toBe(SECRET); // rotação sem downtime

    const onlyNew = await parseKeyring(`2:${key(2)}`);
    const error = await openSecret(onlyNew, sealedWithOld, AAD).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownKeyVersionError);
    expect((error as UnknownKeyVersionError).keyVersion).toBe(1);
    expect((error as Error).message).toBe('unknown_key_version:1');
  });

  it('a chave errada (mesma versão, outro material) não abre', async () => {
    const sealed = await sealSecret(await parseKeyring(`1:${key(1)}`), SECRET, AAD);
    await expect(openSecret(await parseKeyring(`1:${key(9)}`), sealed, AAD)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('o segredo do Worker malformado falha alto, sem ecoar a chave', async () => {
    const bad: [string | undefined, string][] = [
      [undefined, 'missing'],
      ['', 'missing'],
      ['1', 'malformed_entry'],
      ['x:AAAA', 'malformed_entry'],
      ['0:AAAA', 'malformed_entry'],
      ['1:AAAA:extra', 'malformed_entry'],
      [`1:${key(1)},1:${key(2)}`, 'duplicate_version'],
      ['1:AAAA', 'key_must_be_32_bytes'],
      [`1:${btoa('curta')}`, 'key_must_be_32_bytes'],
      ['1:@@@', 'key_must_be_32_bytes'],
    ];
    for (const [raw, reason] of bad) {
      const error = await parseKeyring(raw).catch((caught: unknown) => caught);
      expect(error, String(raw)).toBeInstanceOf(SecretBoxConfigError);
      expect((error as Error).message).toBe(`secret_box_config:${reason}`);
    }
  });
});
