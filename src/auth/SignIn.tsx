import { googleSignInUrl } from './access';
import { KeyPrompt } from './KeyPrompt';

interface Props {
  /** Whether the site offers Google sign-in. Without it, the owner key is the only way in. */
  google: boolean;
  /** The page to come back to after Google. */
  next: string;
  message?: string;
  onKey(key: string): void;
}

/** The sign-in page: Google first when the site offers it, with the owner key always available. */
export function SignIn({ google, next, message, onKey }: Props) {
  if (!google) return <KeyPrompt onSubmit={onKey} error={message} />;
  return (
    <div className="key-prompt sign-in">
      <h1>Sign in to edit your maps</h1>
      {message && <p role="alert" className="error">{message}</p>}
      {/* A plain link: the page's Content-Security-Policy allows no forms to post anywhere and no outside scripts. */}
      <a className="google-button" href={googleSignInUrl(next)}>Sign in with Google</a>
      <details>
        <summary>Use the owner key instead</summary>
        <KeyPrompt compact onSubmit={onKey} />
      </details>
    </div>
  );
}
