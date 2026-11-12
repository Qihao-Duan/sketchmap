import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { TopicBox } from '../layout/map';
import type { View } from './viewport';

interface Props {
  box: TopicBox;
  view: View;
  initialText: string;
  selectAll: boolean;
  onCommit(text: string): void;
  onCancel(): void;
  onTab(text: string): void;
}

export function InlineEditor({ box, view, initialText, selectAll, onCommit, onCancel, onTab }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialText);
  const done = useRef(false);

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.focus();
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [selectAll]);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  const { fontSize, lineHeight, padX, padY, kind } = box.style;
  const k = view.k;
  const width = Math.max(box.w * k, 140);
  const lines = Math.max(1, value.split('\n').length);
  const style: CSSProperties = {
    left: view.tx + box.x * k + (kind === 'line' ? 0 : (box.w * k - width) / 2),
    top: view.ty + box.y * k,
    width,
    minHeight: box.h * k,
    height: lines * lineHeight * k + padY * 2 * k + 4,
    fontSize: fontSize * k,
    lineHeight: `${lineHeight * k}px`,
    padding: `${padY * k}px ${padX * k}px`,
    textAlign: kind === 'line' ? 'left' : 'center',
  };

  return (
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
      onBlur={() => finish(() => onCommit(value))}
    />
  );
}
