import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Bounds, TopicBox } from '../layout/map';
import { wrapText, type Measure } from '../layout/wrap';
import { linkRange, normalizeHref, parseRich } from '../shared/rich';
import type { View } from './viewport';

interface Props {
  box: TopicBox;
  view: View;
  /** Measures text the way the layout does, so the box can be as wide as the topic will be. */
  measure: Measure;
  initialText: string;
  selectAll: boolean;
  onCommit(text: string): void;
  onCancel(): void;
  onTab(text: string): void;
  /** The box got wider or higher while its text was typed: where on the map it is now, so it can be kept in view. */
  onGrow?(place: Bounds): void;
}

const TOO_LONG = 'With this link the topic would be longer than 5000 characters.';

export function InlineEditor({ box, view, measure, initialText, selectAll, onCommit, onCancel, onTab, onGrow }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialText);
  const done = useRef(false);
  const [link, setLink] = useState<{ start: number; end: number; error: string | null } | null>(null);
  const [url, setUrl] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  /** True while focus moves between the textarea and the link field on purpose, so neither blur ends the edit. */
  const moving = useRef(false);
  const caret = useRef<number | null>(null);
  /** The textarea's measured pixel height (null until the first layout effect runs), so the link field sits under it. */
  const [taH, setTaH] = useState<number | null>(null);

  const focusQuietly = (el: HTMLElement | null) => {
    moving.current = true;
    el?.focus();
    moving.current = false;
  };

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.focus();
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [selectAll]);
  useLayoutEffect(() => {
    if (link) focusQuietly(urlRef.current);
  }, [link === null]);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    focusQuietly(ref.current);
    ref.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  /** Returns false, leaving the text unchanged, when the link would push the topic past 5000 characters. */
  const applyLink = (start: number, end: number, href: string): boolean => {
    const next = linkRange(valueRef.current, start, end, href);
    if (next.text.length > 5000) return false;
    caret.current = next.caret;
    setValue(next.text);
    return true;
  };

  const { fontSize, lineHeight, padX, padY, kind } = box.style;
  const k = view.k;
  // Start below the image (if any), so the box never covers it, even while an image-only topic gets its first text.
  const textOffset = box.image ? box.image.y + box.image.h : 0;
  const minHeight = (box.h - textOffset) * k;
  // As wide as the topic will be with this text: it grows while one types, up to where the topic's text
  // wraps, so a long text is not typed into a narrow column. The 6 px are the border and a little air,
  // which keep a line that fits the topic from wrapping in the box. Never narrower than the topic is now.
  const widest = wrapText(value || ' ', fontSize, box.node.wrap ?? box.style.maxW, measure).reduce((m, line) => Math.max(m, measure(line, fontSize)), 0);
  const typed = (widest + padX * 2 + box.badgeW + box.noteW) * k + 6;
  const width = Math.max(box.w * k, typed, parseRich(value).plain !== value ? 280 : 140);
  const lines = Math.max(1, value.split('\n').length);
  // It grows the way the topic will: away from its parent, and to both sides for the central topic.
  const left = box.parentId === null ? (box.x + box.w / 2) * k - width / 2 : box.side === -1 ? (box.x + box.w) * k - width : box.x * k;
  const style: CSSProperties = {
    left: view.tx + left,
    top: view.ty + (box.y + textOffset) * k,
    width,
    minHeight,
    height: lines * lineHeight * k + padY * 2 * k + 4,
    fontSize: fontSize * k,
    lineHeight: `${lineHeight * k}px`,
    padding: `${padY * k}px ${(padX + box.noteW) * k}px ${padY * k}px ${(padX + box.badgeW) * k}px`,
    textAlign: kind === 'line' ? 'left' : 'center',
  };

  // Grow the textarea to fit its raw text (link syntax, full URLs): the layout box is measured on the short,
  // displayed text, so the fixed height above can be too small. jsdom has no layout, so this is a no-op there.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    // .inline-editor is box-sizing: border-box, so scrollHeight (content + padding, no border) needs its
    // border added back; otherwise the applied height is short by the border width and the last line clips.
    const border = ta.offsetHeight - ta.clientHeight;
    ta.style.height = `${Math.max(minHeight, ta.scrollHeight + border)}px`;
    setTaH(ta.offsetHeight);
  }, [value, k]);

  // Says so when typing made the box larger. Not when it opens (its topic was brought into view when it was
  // selected), and not when only the zoom changed.
  const shownH = taH || Math.max(minHeight, style.height as number);
  const last = useRef<{ w: number; h: number; k: number } | null>(null);
  useLayoutEffect(() => {
    if (taH === null) return;
    const was = last.current;
    last.current = { w: width, h: shownH, k };
    if (was && was.k === k && (width > was.w || shownH > was.h)) onGrow?.({ x: left / k, y: box.y + textOffset, w: width / k, h: shownH / k });
  });

  return (
    <>
      <textarea
        ref={ref}
        className="inline-editor"
        aria-label="Topic text"
        placeholder="Topic"
        spellCheck={false}
        maxLength={5000}
        value={value}
        style={style}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            const ta = e.currentTarget;
            const [start, end] = ta.selectionStart === ta.selectionEnd ? [0, ta.value.length] : [ta.selectionStart, ta.selectionEnd];
            setUrl('');
            setLink({ start, end, error: null });
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finish(() => onCommit(value));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(onCancel);
          } else if (e.key === 'Tab') {
            e.preventDefault();
            finish(() => onTab(value));
          }
        }}
        onPaste={(e) => {
          const ta = e.currentTarget;
          if (ta.selectionStart === ta.selectionEnd) return;
          const pasted = e.clipboardData.getData('text/plain').trim();
          const href = /^https?:\/\/\S+$/i.test(pasted) ? normalizeHref(pasted) : null;
          if (!href) return;
          e.preventDefault();
          applyLink(ta.selectionStart, ta.selectionEnd, href);
        }}
        onBlur={(e) => {
          if (moving.current || (urlRef.current !== null && e.relatedTarget === urlRef.current)) return;
          finish(() => onCommit(valueRef.current));
        }}
      />
      {link && (
        <>
          <input
            ref={urlRef}
            className="inline-link"
            aria-label="Link URL"
            placeholder="Paste or type a link, then Enter"
            value={url}
            style={{ left: style.left, top: (style.top as number) + (taH ?? (style.height as number)) + 6, width }}
            onChange={(e) => {
              setUrl(e.target.value);
              setLink({ ...link, error: null });
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                const href = normalizeHref(url);
                if (!href) {
                  setLink({ ...link, error: 'Use a web address starting with http:// or https://' });
                  return;
                }
                if (!applyLink(link.start, link.end, href)) {
                  setLink({ ...link, error: TOO_LONG });
                  return;
                }
                focusQuietly(ref.current);
                setLink(null);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                focusQuietly(ref.current);
                setLink(null);
              } else if (e.key === 'Tab') {
                e.preventDefault();
              }
            }}
            onBlur={(e) => {
              if (moving.current) return;
              setLink(null);
              // Back into the text: keep editing. Anywhere else: the edit is over.
              if (e.relatedTarget === ref.current) return;
              finish(() => onCommit(valueRef.current));
            }}
          />
          {link.error && (
            <p className="inline-link-error error" role="alert" style={{ left: style.left, top: (style.top as number) + (taH ?? (style.height as number)) + 44 }}>
              {link.error}
            </p>
          )}
        </>
      )}
    </>
  );
}
