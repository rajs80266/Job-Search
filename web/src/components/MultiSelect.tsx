import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon } from "./Icons";

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Adds a filter box inside the list; worth it for long lists. */
  searchable?: boolean;
  emptyMessage?: string;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  emptyMessage = "Nothing to choose from",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const toggle = (value: string): void =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-sm hover:border-muted"
      >
        {label}
        {selected.length > 0 && (
          <span className="rounded-sm bg-accent px-1.5 text-xs font-semibold text-white">
            {selected.length}
          </span>
        )}
        <ChevronDownIcon className="text-muted" />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className="absolute left-0 z-20 mt-1 w-64 animate-fade-in rounded-sm border border-line bg-surface shadow-lg"
        >
          {searchable && (
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={`Find ${label.toLowerCase()}…`}
              aria-label={`Find ${label.toLowerCase()}`}
              autoFocus
              className="w-full border-b border-line bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:bg-accent-soft/40"
            />
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 && (
              <li className="px-2.5 py-2 text-sm text-muted">{emptyMessage}</li>
            )}
            {options.length > 0 && visible.length === 0 && (
              <li className="px-2.5 py-2 text-sm text-muted">No match</li>
            )}
            {visible.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-sm hover:bg-sunken">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => toggle(option.value)}
                    className="accent-accent"
                  />
                  {option.label}
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-t border-line px-2.5 py-1.5 text-left text-sm text-accent hover:bg-sunken"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
