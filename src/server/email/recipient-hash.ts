/**
 * Identidade do destinatário para a supressão (M4-07): HMAC-SHA256 do endereço NORMALIZADO com uma chave
 * de servidor (`EMAIL_HASH_KEY`, Worker Secret). O resultado (64 hex) é a chave de `email_recipient_state`;
 * o endereço nunca é gravado, e sem a chave a tabela não permite descobrir quem foi suprimido.
 * Trocar a chave INVALIDA as supressões existentes: só com migração dos hashes.
 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export async function hashRecipient(key: string, address: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(normalizeAddress(address)),
  );
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
