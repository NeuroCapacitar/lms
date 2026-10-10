/**
 * Consulta "este e-mail é de Staff?" (papel ativo ou convite pendente).
 * PENDENTE (M1-03/M1-04): as tabelas de papéis e convites ainda não existem. Até lá nenhum e-mail
 * é tratado como Staff; a política e o hook já estão cobertos por teste com um substituto.
 */
export async function isStaffEmail(_email: string): Promise<boolean> {
  return false;
}
