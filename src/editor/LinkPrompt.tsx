import { useState } from 'react';
import { normalizeHref } from '../shared/rich';

export interface LinkPromptProps {
  /** The topic already has a link: offer to remove it. */
  hasLink: boolean;
  /** Applies the link (or removes links, with null); returns an error message to show, or null when done. */
  onApply(href: string | null): string | null;
  onClose(): void;
}

/** ⌘/Ctrl K on a selected topic: link the whole topic. */
export function LinkPrompt({ hasLink, onApply, onClose }: LinkPromptProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const href = normalizeHref(url);
    setError(href ? onApply(href) : 'Use a web address starting with http:// or https://');
  };
  return (
    <aside
      className="float link-prompt"
      aria-label="Link"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <label className="field">
        <span className="flabel">Link the whole topic to</span>
        <input
          autoFocus
          aria-label="Link URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={apply}>Link</button>
        {hasLink && <button type="button" onClick={() => setError(onApply(null))}>Remove link</button>}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}
