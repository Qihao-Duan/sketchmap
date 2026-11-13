// Signing in without the key on the developer's own machine. `npm run dev` reads the local key and hands
// it to the page (vite.config.ts); the page then remembers it as if it had been typed (main.tsx).
// Nothing here touches Node or the browser, so both sides can use it.

const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True for the names a machine uses for itself. */
export function isThisMachine(hostname: string): boolean {
  return THIS_MACHINE.has(hostname.toLowerCase());
}

export interface DevServer {
  command: 'serve' | 'build';
  isPreview?: boolean;
  /** Vite's `server.host`. Unset, or one of this machine's own names, keeps the server off the network. */
  host?: string | boolean;
  /** The browser tests start their own servers, which must ask for the key like the deployed site. */
  testServer?: boolean;
}

/**
 * Whether a server may put the local key into the page. Only the plain dev server may: a build never
 * carries a key, and a dev server opened to other machines would hand the key to all of them.
 */
export function mayHandOverLocalKey({ command, isPreview, host, testServer }: DevServer): boolean {
  if (command !== 'serve' || isPreview || testServer) return false;
  return host === undefined || host === false || (typeof host === 'string' && isThisMachine(host));
}
