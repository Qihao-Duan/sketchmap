import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { installFontFaces } from './render/fonts';
import { parseRoute } from './router';
import { applyTheme } from './theme';
import { themeFromSearch } from './shared/theme';
import './app.css';

const ListPage = lazy(() => import('./list/ListPage').then((m) => ({ default: m.ListPage })));
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const ViewPage = lazy(() => import('./view/ViewPage').then((m) => ({ default: m.ViewPage })));

installFontFaces();
applyTheme(document.documentElement, themeFromSearch(location.search));

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
