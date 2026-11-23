import type { Profile } from "@server/types";
import { useCallback, useState } from "react";
import { useProfile, useProfilePreview, useSaveProfile } from "../api/hooks";
import { SpinnerIcon } from "../components/Icons";
import { TierPreview } from "../components/profile/TierPreview";
import {
  AdjacentKeywords,
  CitiesEditor,
  CoreKeywords,
  NegativeTerms,
  WeightsEditor,
} from "../components/profile/ProfileEditors";
import { ErrorState } from "../components/StateViews";
import { Toast, type ToastMessage } from "../components/Toast";
import { sameProfile } from "../lib/profile-edit";
import { useDebounced } from "../lib/use-debounced";

const PREVIEW_DELAY_MS = 700;

export function ProfilePage() {
  const profileQuery = useProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const saved = profileQuery.data;
  const current = draft ?? saved;
  const dirty = Boolean(saved && draft && !sameProfile(saved, draft));

  const settled = useDebounced(current ?? null, PREVIEW_DELAY_MS);
  const previewQuery = useProfilePreview(settled);
  const waiting = current !== settled;
  const previewError = previewQuery.isError ? previewQuery.error.message : null;
  const canSave = dirty && !waiting && !previewQuery.isFetching && !previewError && !save.isPending;

  if (profileQuery.isError) {
    return (
      <ErrorState
        title="Could not load the profile"
        message={profileQuery.error.message}
        onRetry={() => void profileQuery.refetch()}
      />
    );
  }
  if (!current) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading the profile…
      </p>
    );
  }

  const edit = (next: Profile): void => setDraft(next);

  const submit = (): void => {
    if (!draft) return;
    save.mutate(draft, {
      onSuccess: (result) => {
        setDraft(null);
        setToast({
          id: Date.now(),
          text: `Profile saved. ${result.rescored} jobs re-scored.`,
        });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {dirty ? "Unsaved changes" : "Matches the saved profile"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={!dirty || save.isPending}
            className="h-9 rounded-sm px-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
          >
            Revert
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending && <SpinnerIcon />}
            Save and re-score
          </button>
        </div>
      </div>

      {save.isError && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {save.error.message}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <WeightsEditor profile={current} onChange={edit} />
          <CoreKeywords profile={current} onChange={edit} />
          <AdjacentKeywords profile={current} onChange={edit} />
          <NegativeTerms profile={current} onChange={edit} />
          <CitiesEditor profile={current} onChange={edit} />
        </div>
        <div className="lg:sticky lg:top-4">
          <TierPreview
            preview={previewQuery.data}
            loading={waiting || previewQuery.isFetching}
            error={previewError}
          />
        </div>
      </div>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
