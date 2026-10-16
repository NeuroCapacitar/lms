/**
 * Link de acesso COLADO pela pessoa (M8-04). No iPhone, o app instalado na tela inicial tem armazenamento próprio e o link do e-mail
 * abre no Safari: a sessão nasce lá e o app continua sem login. A saída é a pessoa copiar o link (sem abri-lo) e colá-lo no app, que o
 * confirma DENTRO do próprio armazenamento. É o MESMO link e o MESMO endpoint de hoje (`/entrar/confirmar#token=…`): aqui só se
 * extrai o token e se recusa tudo o que não seja um link de login DESTE site.
 */
export type PastedLinkResult =
  | { kind: 'ok'; token: string }
  | {
      kind: 'invalid';
      reason: 'empty' | 'not_a_link' | 'other_site' | 'wrong_page' | 'reauth' | 'no_token';
    };

const TOKEN_SHAPE = /^[A-Za-z0-9_.~-]{16,512}$/;

/** `origin` é o do site aberto (`window.location.origin`): link de outro endereço nunca é aceito. */
export function parsePastedLink(input: string, origin: string): PastedLinkResult {
  const text = input.trim();
  if (text === '') return { kind: 'invalid', reason: 'empty' };
  // O texto pode vir com quebra de linha, aspas ou pontuação em volta (cópia de e-mail): pega o primeiro endereço.
  const candidate = text.match(/https?:\/\/[^\s<>"'`]+/i)?.[0];
  if (!candidate) return { kind: 'invalid', reason: 'not_a_link' };
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { kind: 'invalid', reason: 'not_a_link' };
  }
  if (url.origin !== origin) return { kind: 'invalid', reason: 'other_site' };
  if (url.pathname.replace(/\/+$/, '') !== '/entrar/confirmar') {
    return { kind: 'invalid', reason: 'wrong_page' };
  }
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  // O link de "confirmar identidade" (reautenticação) NÃO abre sessão: nunca é consumido por aqui.
  if (params.get('purpose') === 'reauth') return { kind: 'invalid', reason: 'reauth' };
  const token = params.get('token');
  if (!token || !TOKEN_SHAPE.test(token)) return { kind: 'invalid', reason: 'no_token' };
  return { kind: 'ok', token };
}
