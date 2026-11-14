import { useState, type ReactNode } from 'react';

interface Props {
  onSubmit: (key: string) => void;
  error?: string;
  /** Just the field and the button, for use inside the sign-in page: no heading, and no grabbing of the keyboard. */
  compact?: boolean;
  /** Anything to put under the button. */
  children?: ReactNode;
}

export function KeyPrompt({ onSubmit, error, compact = false, children }: Props) {
  const [value, setValue] = useState('');
  return (
    <form
      className={compact ? 'key-form' : 'key-prompt'}
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      {!compact && <h1>Enter your owner key</h1>}
      {!compact && <p>This browser asks once. It's the secret you set with <code>wrangler secret put OWNER_KEY</code>.</p>}
      <label htmlFor="owner-key">Owner key</label>
      <input id="owner-key" type="password" autoComplete="current-password" autoFocus={!compact} value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit">Continue</button>
      {children}
    </form>
  );
}
