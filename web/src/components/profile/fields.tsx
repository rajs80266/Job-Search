import { useId, useState, type ReactNode } from "react";
import { parseList, sameList } from "../../lib/profile-edit";

export const FIELD_INPUT =
  "h-8 w-full rounded-sm border border-line bg-surface px-2 text-sm placeholder:text-muted";

/** Comma-separated list. Keeps what the user is typing, so "a, " does not lose its comma. */
export function TagInput({
  label,
  values,
  onChange,
  placeholder,
  hideLabel = false,
}: {
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(values.join(", "));
  const [seen, setSeen] = useState<readonly string[]>(values);

  // The list changed from outside (revert, another row removed): follow it.
  if (!sameList(values, seen)) {
    setSeen(values);
    if (!sameList(parseList(text), values)) setText(values.join(", "));
  }

  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1 block text-xs text-muted"}>
        {label}
      </label>
      <input
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = parseList(event.target.value);
          setText(event.target.value);
          setSeen(next);
          onChange(next);
        }}
        className={FIELD_INPUT}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(event) => {
          if (!Number.isNaN(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
        }}
        className={`${FIELD_INPUT} font-mono`}
      />
      {hint && <p className="mt-0.5 text-[0.6875rem] text-muted">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hideLabel = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1 block text-xs text-muted"}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_INPUT}
      />
    </div>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-8 rounded-sm px-2 text-sm text-muted hover:bg-danger-soft hover:text-danger"
    >
      Remove
    </button>
  );
}

export function AddButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 rounded-sm border border-dashed border-line px-3 text-sm font-medium text-accent hover:border-accent"
    >
      + {children}
    </button>
  );
}

export function EditorSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="border border-line bg-surface">
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
