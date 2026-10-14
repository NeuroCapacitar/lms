/**
 * Comparação de segredos em tempo constante (M6-03). Os dois lados passam por SHA-256 (tamanho fixo, então o
 * comprimento do segredo não vaza) e o resultado é acumulado sem sair no primeiro byte diferente.
 */
async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (const [index, byte] of left.entries()) difference |= byte ^ right[index]!;
  return difference === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  return [...(await digest(text))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
