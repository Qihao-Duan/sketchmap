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
  /**
   * The box got wider or higher while its text was typed: where on the map it is now, and which way it
   * grows, so that it can be kept in view.
   */
  onGrow?(place: Bounds, grows: 'left' | 'right' | 'both'): void;
}

const TOO_LONG = 'With this link the topic would be longer than 5000 characters.';
/** What stands in for the text of a topic that has none yet. */
const PLACEHOLDER = 'Topic';

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
  /**
   * The textarea's measured pixel height, and the zoom it was measured at (null until the first layout
   * effect runs). The link field sits under it.
   */
  const [taSize, setTaSize] = useState<{ h: number; k: number } | null>(null);

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
  // As wide as the topic will be with this text: the box grows while one types, up to where the topic's
  // text wraps, so a long text is not typed into a narrow column. Measured on what the topic will show
  // (its marker, and a link as its label: an address is shown shortened), not on the raw text, which an
  // address would make as wide as the address. A word longer than the topic's width is broken by the
  // box, so the box stops at that width. Never narrower than the topic is now.
  const rich = parseRich(value);
  const hasSyntax = rich.plain !== value;
  const limit = box.node.wrap ?? box.style.maxW;
  const shownText = (box.node.emoji ? `${box.node.emoji} ` : '') + rich.plain;
  const widest = wrapText(shownText || PLACEHOLDER, fontSize, limit, measure).reduce((m, line) => Math.max(m, measure(line, fontSize)), 0);
  // While the box is open it never gets narrower: a text that gets shorter, or is shown shorter once a
  // link is recognised in it, would move the box under the caret.
  const widestYet = useRef(0);
  widestYet.current = Math.max(widestYet.current, Math.min(widest, limit));
  const topicW = Math.max(box.w, widestYet.current + padX * 2 + box.badgeW + box.noteW) * k;
  // Around that: the box's own 1.5 px border, and 1 map unit of air on either side, which keeps a line
  // that fits the topic from wrapping in the box at any zoom.
  const air = 3 + 2 * k;
  // The least width leaves room to aim at, and for link syntax to be read.
  const width = Math.max(topicW + air, hasSyntax ? 280 : 140);
  const spare = width - (topicW + air);
  // What the least width adds is room beside the text, not for it: with more room than the topic has,
  // the box would wrap the text later than the topic does (a narrow width set by hand, a low zoom). Only
  // link syntax, which the topic does not show, gets it as room for text.
  const beside = hasSyntax ? 0 : spare;
  const lines = Math.max(1, value.split('\n').length);
  // It grows the way the topic will: away from its parent, and to both sides for the central topic.
  const grows = box.parentId === null ? 'both' : box.side === -1 ? 'left' : 'right';
  const topicLeft = grows === 'both' ? (box.x + box.w / 2) * k - topicW / 2 : grows === 'left' ? (box.x + box.w) * k - topicW : box.x * k;
  // What the least width adds goes where it does not move the text when the box opens on a short topic:
  // around centred text, and after text that starts on the left.
  const left = topicLeft - air / 2 - (kind === 'line' ? 0 : spare / 2);
  const style: CSSProperties = {
    left: view.tx + left,
    top: view.ty + (box.y + textOffset) * k,
    width,
    minHeight,
    height: lines * lineHeight * k + padY * 2 * k + 4,
    fontSize: fontSize * k,
    lineHeight: `${lineHeight * k}px`,
    padding: `${padY * k}px ${(padX + box.noteW) * k + (kind === 'line' ? beside : beside / 2)}px ${padY * k}px ${(padX + box.badgeW) * k + (kind === 'line' ? 0 : beside / 2)}px`,
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
    const h = ta.offsetHeight;
    setTaSize((s) => (s && s.h === h && s.k === k ? s : { h, k }));
  }, [value, k, width]);
  /** The measured height, once it has been measured at the zoom the box is drawn at now. */
  const taH = taSize && taSize.k === k ? taSize.h : null;

  // Says so when typing made the box larger. Not when it opens (its topic was brought into view when it was
  // selected), and not when only the zoom changed: the height measured at the zoom before says nothing
  // about this one, so the comparison starts again once the height at this zoom is in.
  // Larger: an edge further out, which under the least width happens without the box getting wider
  // (a new topic on the left of the map moves to the left as its text grows).
  const shownH = taH || Math.max(minHeight, style.height as number);
  const last = useRef<{ left: number; right: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (taH === null) {
      last.current = null;
      return;
    }
    const was = last.current;
    const now = { left, right: left + width, h: shownH };
    last.current = now;
    if (was && (now.left < was.left - 0.01 || now.right > was.right + 0.01 || now.h > was.h)) {
      onGrow?.({ x: left / k, y: box.y + textOffset, w: width / k, h: shownH / k }, grows);
    }
  });

  return (
    <>
      <textarea
        ref={ref}
        className="inline-editor"
        aria-label="Topic text"
        placeholder={PLACEHOLDER}
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
