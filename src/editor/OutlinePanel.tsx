import { useState } from 'react';

interface Props {
  initialText: string;
  /** Returns an error message to show, or null when the outline was applied. */
  onApply(text: string): string | null;
  onClose(): void;
  lost?: string[];
}

export function OutlinePanel({ initialText, onApply, onClose, lost }: Props) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <aside
      className="float outline-panel"
      aria-label="Markdown outline"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
    >
      <h2>Map as a Markdown outline</h2>
      <p className="muted">Edit the text and apply it, or paste an outline copied from Notion. Headings and indented lists both work.</p>
      {lost && lost.length > 0 && <p className="muted">Not kept in Markdown: {lost.join(', ')}. Replace removes them from the map.</p>}
      <textarea
        autoFocus
        aria-label="Outline text"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={() => setError(onApply(text))}>Replace map with this</button>
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}
