import type { JobListItem, JobStatus } from "@server/types";
import { useEffect, useId, useRef, useState } from "react";
import { formatAbsolute } from "../lib/format";
import { CATEGORY_LABELS, JOB_STATUS_VALUES, STATUS_LABELS } from "../lib/labels";
import { KeywordChips, TierBadge } from "./Badges";
import { CloseIcon, ExternalLinkIcon, SpinnerIcon } from "./Icons";

const NOTES_MAX_LENGTH = 5000;
const EXCERPT_CHARS = 1500;

interface NotesDrawerProps {
  /** The job being edited, or null when the drawer is closed. */
  job: JobListItem | null;
  saving: boolean;
  onClose: () => void;
  onChangeStatus: (job: JobListItem, status: JobStatus | null) => void;
  onSaveNotes: (job: JobListItem, notes: string) => void;
}

export function NotesDrawer({
  job,
  saving,
  onClose,
  onChangeStatus,
  onSaveNotes,
}: NotesDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<{ jobId: string; text: string } | null>(null);

  const isOpen = job !== null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const notes = job && draft?.jobId === job.id ? draft.text : (job?.notes ?? "");
  const dirty = job !== null && notes !== job.notes;

  const requestClose = (): void => {
    if (dirty && !window.confirm("Discard your unsaved notes?")) return;
    setDraft(null);
    onClose();
  };

  const save = (): void => {
    if (job && dirty) onSaveNotes(job, notes);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-md bg-surface p-0 text-ink shadow-2xl backdrop:animate-fade-in backdrop:bg-ink/30 open:animate-drawer-in"
    >
      {job && (
        <div className="flex h-full flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base leading-snug font-semibold">
                {job.title}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {job.companyName} · {CATEGORY_LABELS[job.category]}
              </p>
              <p className="text-sm text-muted">{job.locationRaw || "No location given"}</p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close notes"
              className="rounded-sm p-1 text-muted hover:bg-sunken hover:text-ink"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <TierBadge tier={job.relevanceTier} score={job.relevanceScore} />
              <KeywordChips keywords={job.matchedKeywords} limit={6} />
            </div>

            <a
              href={job.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              Open posting <ExternalLinkIcon />
              <span className="sr-only">(opens in a new tab)</span>
            </a>

            <div>
              <label htmlFor="drawer-status" className="block text-sm font-medium">
                Status
              </label>
              <select
                id="drawer-status"
                value={job.status ?? ""}
                onChange={(event) =>
                  onChangeStatus(job, (event.target.value || null) as JobStatus | null)
                }
                className="mt-1 h-9 w-full rounded-sm border border-line bg-surface px-2 text-sm"
              >
                <option value="">No status</option>
                {JOB_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              {job.statusUpdatedAt && (
                <p className="mt-1 text-xs text-muted">
                  Updated {formatAbsolute(job.statusUpdatedAt)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="drawer-notes" className="block text-sm font-medium">
                Notes
              </label>
              <textarea
                id="drawer-notes"
                value={notes}
                maxLength={NOTES_MAX_LENGTH}
                rows={8}
                onChange={(event) => setDraft({ jobId: job.id, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
                }}
                placeholder="Referral, recruiter name, interview dates…"
                className="mt-1 w-full resize-y rounded-sm border border-line bg-surface p-2 text-sm placeholder:text-muted"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span aria-live="polite">{dirty ? "Unsaved changes" : "Saved"}</span>
                <span className="font-mono">
                  {notes.length}/{NOTES_MAX_LENGTH}
                </span>
              </div>
            </div>

            <details className="text-sm">
              <summary className="font-medium">Posting excerpt</summary>
              <p className="mt-2 whitespace-pre-line text-muted">
                {job.descriptionSnippet
                  ? `${job.descriptionSnippet.slice(0, EXCERPT_CHARS)}${job.descriptionSnippet.length > EXCERPT_CHARS ? "…" : ""}`
                  : "This company's listing gives no description."}
              </p>
            </details>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={!dirty || saving}
              className="h-9 rounded-sm px-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {saving && <SpinnerIcon />}
              Save notes
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
