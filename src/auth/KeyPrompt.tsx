import { useState } from 'react';

export function KeyPrompt({ onSubmit, error }: { onSubmit: (key: string) => void; error?: string }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="key-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <h1>Enter your owner key</h1>
      <p>This browser asks once. It's the secret you set with <code>wrangler secret put OWNER_KEY</code>.</p>
      <label htmlFor="owner-key">Owner key</label>
      <input id="owner-key" type="password" autoComplete="current-password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit">Continue</button>
    </form>
  );
}
