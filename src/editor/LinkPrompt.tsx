import { useState } from 'react';
import { normalizeHref } from '../shared/rich';

export interface LinkPromptProps {
  /** The topic already has a link: offer to remove it. */
  hasLink: boolean;
  /** An http(s) address to link the whole topic to, or null to remove its links. */
  onApply(href: string | null): void;
  onClose(): void;
}

/** ⌘/Ctrl K on a selected topic: link the whole topic. */
export function LinkPrompt({ hasLink, onApply, onClose }: LinkPromptProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const apply = () => {
    const href = normalizeHref(url);
    if (href) onApply(href);
    else setError(true);
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
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      {error && <p role="alert" className="error">Use a web address starting with http:// or https://</p>}
      <div className="row">
        <button type="button" className="primary" onClick={apply}>Link</button>
        {hasLink && <button type="button" onClick={() => onApply(null)}>Remove link</button>}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}
