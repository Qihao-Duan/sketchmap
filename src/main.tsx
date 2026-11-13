import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { adoptLocalOwnerKey } from './auth/ownerKey';
import { installFontFaces } from './render/fonts';
import { parseRoute } from './router';
import { applyTheme } from './theme';
import { themeFromSearch } from './shared/theme';
import './app.css';

const ListPage = lazy(() => import('./list/ListPage').then((m) => ({ default: m.ListPage })));
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const ViewPage = lazy(() => import('./view/ViewPage').then((m) => ({ default: m.ViewPage })));

// Set by vite.config.ts: the local key under `npm run dev` on this machine, null in every build.
declare const __LOCAL_OWNER_KEY__: string | null | undefined;

installFontFaces();
applyTheme(document.documentElement, themeFromSearch(location.search));
// The view-only page never needs the key, so it is left out (it reads and writes no browser storage).
if (parseRoute(location.pathname).name !== 'view') {
  adoptLocalOwnerKey(typeof __LOCAL_OWNER_KEY__ === 'string' ? __LOCAL_OWNER_KEY__ : null, location.hostname);
}

function App() {
  const route = parseRoute(location.pathname);
  return (
    <Suspense fallback={<p className="center muted">Loading…</p>}>
      {route.name === 'list' && <ListPage />}
      {route.name === 'editor' && <EditorPage id={route.id} />}
      {route.name === 'view' && <ViewPage id={route.id} />}
      {route.name === 'notFound' && (
        <div className="center">
          <p>Page not found. <a href="/">All maps</a></p>
        </div>
      )}
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
