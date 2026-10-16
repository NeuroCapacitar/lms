/** Só endereços de teste: o local-part precisa terminar em `+gate…` (nunca e-mail de aluno real). */
export function isGateEmail(email: string): boolean {
  return /^[^@\s]+\+gate[a-z0-9-]*@[^@\s]+\.[^@\s]+$/i.test(email);
}
