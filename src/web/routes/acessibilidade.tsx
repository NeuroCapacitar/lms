import { Link, createFileRoute } from '@tanstack/react-router';

import { SupportAddress } from '../components/support-address';

export const Route = createFileRoute('/acessibilidade')({ component: AccessibilityStatement });

/**
 * Declaração de acessibilidade (M9-08). Diz o que foi VERIFICADO e o que NÃO foi, sem afirmar conformidade total; as lacunas conhecidas
 * (legendas, leitor de tela manual) estão escritas. O texto está em revisão antes do lançamento (a revisão jurídica e o símbolo de
 * acessibilidade, LBI art. 63, dependem do responsável e do advogado).
 */
function AccessibilityStatement() {
  return (
    <>
      <h1 className="mb-4 text-3xl font-semibold">Acessibilidade</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Texto em revisão antes do lançamento. Ele descreve o que já foi verificado e o que ainda
        não, sem afirmar que tudo está conforme.
      </p>

      <section aria-labelledby="compromisso" className="mb-8 max-w-prose">
        <h2 id="compromisso" className="mb-2 text-2xl font-semibold">
          Nosso objetivo
        </h2>
        <p>
          O NeuroCapacitar Hub busca atender às Diretrizes de Acessibilidade para Conteúdo Web
          (WCAG) 2.2, nível AA, em todas as telas de quem estuda e da equipe.
        </p>
      </section>

      <section aria-labelledby="verificado" className="mb-8 max-w-prose">
        <h2 id="verificado" className="mb-2 text-2xl font-semibold">
          O que já foi verificado
        </h2>
        <ul className="grid list-disc gap-1 pl-6">
          <li>
            Contraste das cores calculado por teste automático, nos temas claro e escuro: texto,
            botões, campos, links e indicador de foco.
          </li>
          <li>
            Verificação automática de acessibilidade (axe) nas telas principais, nos dois temas.
          </li>
          <li>Uso só com o teclado nos fluxos principais, com foco sempre visível.</li>
          <li>
            Telas que se ajustam de 360 a 1440 pixels de largura, sem rolagem horizontal da página.
          </li>
          <li>Botões, campos e links de menu com área de toque de pelo menos 24 pixels.</li>
          <li>
            Nada se move sozinho por mais de 5 segundos: os destaques mudam só quando a pessoa usa
            os botões, e a próxima aula só abre depois de uma contagem que pode ser cancelada, se a
            pessoa ligar essa opção.
          </li>
        </ul>
      </section>

      <section aria-labelledby="pendente" className="mb-8 max-w-prose">
        <h2 id="pendente" className="mb-2 text-2xl font-semibold">
          O que ainda não foi verificado
        </h2>
        <ul className="grid list-disc gap-1 pl-6">
          <li>
            Teste manual com leitor de tela (NVDA e VoiceOver) nos fluxos de entrar, comprar,
            estudar, fazer o quiz, ver o certificado e nas principais telas da equipe.
          </li>
          <li>Revisão da conformidade por pessoa especialista fora da equipe do produto.</li>
        </ul>
      </section>

      <section aria-labelledby="limites" className="mb-8 max-w-prose">
        <h2 id="limites" className="mb-2 text-2xl font-semibold">
          Limitações conhecidas
        </h2>
        <ul className="grid list-disc gap-2 pl-6">
          <li>
            <strong>Legendas nos vídeos.</strong> A plataforma não gera legendas próprias nesta
            versão. A legenda depende de quem publica o vídeo e do serviço de vídeo usado. Um vídeo
            sem legenda não atende ao critério 1.2.2 das WCAG (nível A). Quem publica os vídeos deve
            enviá-los com legenda.
          </li>
          <li>
            <strong>Verificação de segurança no login.</strong> Ela é feita por um serviço externo
            (Cloudflare Turnstile). Se ela não carregar ou não for possível usá-la, peça ajuda por
            um dos canais abaixo.
          </li>
        </ul>
      </section>

      <section aria-labelledby="contato" className="mb-8 max-w-prose">
        <h2 id="contato" className="mb-2 text-2xl font-semibold">
          Encontrou uma barreira?
        </h2>
        <p className="mb-2">
          Conte pela página de{' '}
          <Link to="/ajuda" className="underline">
            Ajuda
          </Link>
          : diga qual tela, o que você tentou fazer e, se quiser, qual recurso de apoio usa.
        </p>
        <SupportAddress prefix="Ou escreva para" />
      </section>
    </>
  );
}
