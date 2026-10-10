import { Outlet, createRootRoute } from '@tanstack/react-router';

import { PublicLayout } from '../layouts/public-layout';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  return (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  );
}
