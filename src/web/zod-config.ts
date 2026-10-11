import { z } from 'zod';

// A CSP não permite eval: o Zod 4 tentaria compilar validadores com `new Function` e geraria uma
// violação de CSP a cada carga. Sem JIT o resultado é o mesmo, só um pouco mais lento.
// Este módulo é importado PRIMEIRO em `main.tsx`: os `import` são avaliados antes do corpo do
// arquivo, então um esquema criado no carregamento de qualquer rota (como o `validateSearch` do
// catálogo) já nasceria com o JIT ligado se a configuração ficasse no corpo de `main.tsx`.
z.config({ jitless: true });
