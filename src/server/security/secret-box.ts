/**
 * Cofre de segredos de integração (M5-01): AES-256-GCM com WebCrypto, igual no Worker e no Node. Cada
 * cifragem usa um nonce ALEATÓRIO de 96 bits; o AAD (dados autenticados, não cifrados) amarra o texto
 * cifrado à conexão e ao provider, então um ciphertext copiado para outra linha não abre. As chaves são
 * VERSIONADAS e vêm de um segredo do Worker (nunca do banco nem do dump): para rotacionar a chave mestra,
 * acrescenta-se uma versão nova, recifra-se (`rekeyAll`) e só depois se retira a antiga.
 *
 * Formato do segredo do Worker `VIDEO_SECRETS_MASTER_KEY`: `1:<base64 de 32 bytes>,2:<base64 de 32 bytes>`.
 * A versão mais ALTA é a corrente (cifra); as demais só abrem o que já foi cifrado com elas.
 */
export class SecretBoxConfigError extends Error {
  constructor(reason: string) {
    super(`secret_box_config:${reason}`);
  }
}

/** A versão de chave do texto cifrado não existe no cofre (chave perdida ou retirada cedo demais). */
export class UnknownKeyVersionError extends Error {
  readonly keyVersion: number;
  constructor(keyVersion: number) {
    super(`unknown_key_version:${keyVersion}`);
    this.keyVersion = keyVersion;
  }
}

/** Não abriu: chave errada, AAD trocado ou texto cifrado adulterado (indistinguíveis de propósito). */
export class DecryptionError extends Error {
  constructor() {
    super('decryption_failed');
  }
}

export interface Keyring {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, CryptoKey>;
}

export interface SealedSecret {
  /** Texto cifrado + tag de autenticação, em base64. */
  ciphertext: string;
  /** Nonce de 96 bits, em base64. */
  nonce: string;
  keyVersion: number;
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

/** Lê o segredo do Worker. Qualquer defeito (formato, tamanho, versão repetida) falha ALTO e sem eco da chave. */
export async function parseKeyring(raw: string | undefined): Promise<Keyring> {
  if (!raw || raw.trim() === '') throw new SecretBoxConfigError('missing');
  const keys = new Map<number, CryptoKey>();
  for (const entry of raw.split(',')) {
    const [versionText, material, ...extra] = entry.trim().split(':');
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1 || !material || extra.length > 0) {
      throw new SecretBoxConfigError('malformed_entry');
    }
    if (keys.has(version)) throw new SecretBoxConfigError('duplicate_version');
    const bytes = fromBase64(material);
    if (!bytes || bytes.length !== KEY_BYTES)
      throw new SecretBoxConfigError('key_must_be_32_bytes');
    keys.set(
      version,
      await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]),
    );
  }
  return { currentVersion: Math.max(...keys.keys()), keys };
}

/** Cifra com a chave CORRENTE e um nonce novo. O AAD deve ser o mesmo na abertura. */
export async function sealSecret(
  keyring: Keyring,
  plaintext: string,
  aad: string,
): Promise<SealedSecret> {
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) throw new UnknownKeyVersionError(keyring.currentVersion);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: toBase64(new Uint8Array(cipher)),
    nonce: toBase64(nonce),
    keyVersion: keyring.currentVersion,
  };
}

/** Abre com a chave da versão gravada. `UnknownKeyVersionError` se ela não está no cofre. */
export async function openSecret(
  keyring: Keyring,
  sealed: SealedSecret,
  aad: string,
): Promise<string> {
  const key = keyring.keys.get(sealed.keyVersion);
  if (!key) throw new UnknownKeyVersionError(sealed.keyVersion);
  const nonce = fromBase64(sealed.nonce);
  const cipher = fromBase64(sealed.ciphertext);
  if (!nonce || nonce.length !== NONCE_BYTES || !cipher) throw new DecryptionError();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) },
      key,
      cipher,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptionError();
  }
}
