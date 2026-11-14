import type { MouseEvent } from 'react';
import { googleSignInUrl } from './access';
import { KeyPrompt } from './KeyPrompt';

interface Props {
  /** Whether the site offers Google sign-in. Without it, the owner key is the only way in. */
  google: boolean;
  /** The page to come back to after Google. */
  next: string;
  message?: string;
  onKey(key: string): void;
  /** Shown as "Try again" when the server could not be asked whether this browser is signed in. */
  onRetry?(): void;
  /** The Google link was clicked (a plain click leaves this page; a ⌘/Ctrl or middle click opens a new tab). */
  onGoogle?(e: MouseEvent<HTMLAnchorElement>): void;
}

/** The sign-in page: Google first when the site offers it, with the owner key always available. */
export function SignIn({ google, next, message, onKey, onRetry, onGoogle }: Props) {
  const retry = onRetry && <button type="button" className="retry" onClick={onRetry}>Try again</button>;
  if (!google) return <KeyPrompt onSubmit={onKey} error={message}>{retry}</KeyPrompt>;
  return (
    <div className="key-prompt sign-in">
      <h1>Sign in to edit your maps</h1>
      {message && <p role="alert" className="error">{message}</p>}
      {/* A plain link: the page's Content-Security-Policy allows no forms to post anywhere and no outside scripts. */}
      <a className="google-button" href={googleSignInUrl(next)} onClick={onGoogle}>Sign in with Google</a>
      {retry}
      <details>
        <summary>Use the owner key instead</summary>
        <KeyPrompt compact onSubmit={onKey} />
      </details>
    </div>
  );
}
