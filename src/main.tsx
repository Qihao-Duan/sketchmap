import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { adoptLocalOwnerKey } from './auth/ownerKey';
import { installFontFaces } from './render/fonts';
import { parseRoute } from './router';
import { applyTheme, refreshSiteTheme, siteThemeOf } from './theme';
import { shownTheme, themeFromSearch } from './shared/theme';
import './app.css';

const ListPage = lazy(() => import('./list/ListPage').then((m) => ({ default: m.ListPage })));
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const ViewPage = lazy(() => import('./view/ViewPage').then((m) => ({ default: m.ViewPage })));

// Set by vite.config.ts: the local key under `npm run dev` on this machine, null in every build.
declare const __LOCAL_OWNER_KEY__: string | null | undefined;

installFontFaces();
// The Worker already wrote the look into the page; this repeats the same rule (`?theme=`, then the site setting)
// so a page served without it (the setting missing) still gets the default look rather than the system's.
applyTheme(document.documentElement, shownTheme(themeFromSearch(location.search), siteThemeOf(document.documentElement)));
// A page the browser brings back from memory (Back/Forward), or a tab shown again, may predate the latest pick:
// read the setting again. (Pages are sent `no-store`, so the browser's file cache never holds an old one.)
const refreshTheme = () => void refreshSiteTheme(document.documentElement, location.search);
addEventListener('pageshow', (e) => {
  if (e.persisted) refreshTheme();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshTheme();
});
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
