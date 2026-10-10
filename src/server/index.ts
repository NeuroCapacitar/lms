import { createApp } from './app';

const app = createApp();

/**
 * O id de correlação é gerado aqui, no servidor: o `x-request-id` enviado pelo cliente é
 * ignorado (o evlog o adotaria como id do evento, e ele é controlado por quem chama).
 * O id volta no cabeçalho da resposta para o suporte cruzar a queixa com o log.
 */
export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set('x-request-id', requestId);
    const response = await app.fetch(new Request(request, { headers }), env, ctx);
    const withId = new Response(response.body, response);
    withId.headers.set('x-request-id', requestId);
    return withId;
  },
} satisfies ExportedHandler<Env>;
