import { Outlet, createRootRoute, useRouterState } from '@tanstack/react-router';

import { PublicLayout } from '../layouts/public-layout';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // A área da Staff tem a sua própria casca (barra lateral e gaveta); o resto usa o layout público.
  if (pathname === '/staff' || pathname.startsWith('/staff/')) return <Outlet />;
  return (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  );
}
