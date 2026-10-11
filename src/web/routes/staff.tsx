import { Outlet, createFileRoute } from '@tanstack/react-router';

import { StaffShell } from '../layouts/staff-shell';

export const Route = createFileRoute('/staff')({ component: StaffLayout });

function StaffLayout() {
  return (
    <StaffShell>
      <Outlet />
    </StaffShell>
  );
}
