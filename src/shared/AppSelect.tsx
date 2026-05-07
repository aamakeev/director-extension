import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

export type AppSelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  'aria-label'?: string;
};

export function AppSelect({
  value,
  options,
  onChange,
  disabled,
  compact,
  className = '',
  'aria-label': ariaLabel,
}: Props) {
  const uid = useId();
  const listboxId = `asl_${uid}`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    if (!disabled) setOpen((o) => !o);
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const wrapCls =
    `app-select${compact ? ' app-select--compact' : ''}${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`.trim();

  return (
    <div ref={rootRef} class={wrapCls}>
      <button
        ref={triggerRef}
        type="button"
        class="app-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        <span class="app-select__value">{selected?.label ?? ''}</span>
        <span class="app-select__chev" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          id={listboxId}
          class="app-select__menu"
          role="listbox"
          tabIndex={-1}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              class={`app-select__option${o.value === value ? ' is-selected' : ''}`}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
