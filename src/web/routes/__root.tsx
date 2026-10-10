import { Link, Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  return (
    <>
      <header>
        <nav aria-label="Principal">
          <Link to="/">Início</Link> <Link to="/sobre">Sobre</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
