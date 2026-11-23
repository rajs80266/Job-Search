import type { Ats, CompanyCategory, ImportCurlResponse, VerifyResult } from "@server/types";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useCreateCompany, useImportCurl, useVerifyCompany } from "../api/hooks";
import { describeVerify } from "../lib/company-outcome";
import { ATS_LABELS, CATEGORIES, CATEGORY_LABELS } from "../lib/labels";
import {
  FIELD_MAP_TEMPLATE,
  buildRecipe,
  formFromImport,
  slugify,
  type DraftForm,
} from "../lib/recipe-draft";
import { CloseIcon, SpinnerIcon } from "./Icons";

const INPUT = "h-9 w-full rounded-sm border border-line bg-surface px-2 text-sm";
const TEXTAREA = "w-full rounded-sm border border-line bg-surface p-2 font-mono text-xs";
const PRIMARY =
  "inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "h-9 rounded-sm border border-line bg-surface px-3 text-sm font-medium hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1">{children(id)}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function PasteStep({ onParsed }: { onParsed: (imported: ImportCurlResponse) => void }) {
  const [text, setText] = useState("");
  const importCurl = useImportCurl();
  const helpId = useId();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        importCurl.mutate({ text }, { onSuccess: onParsed });
      }}
    >
      <Field label="Request copied from the browser">
        {(id) => (
          <textarea
            id={id}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            spellCheck={false}
            aria-describedby={helpId}
            placeholder={"curl 'https://…/jobs' -H 'accept: application/json' --data-raw '{…}'"}
            className={TEXTAREA}
          />
        )}
      </Field>
      <p id={helpId} className="text-sm text-muted">
        On the careers page, open DevTools → Network, find the request that returns the job list,
        then right-click it → Copy → <strong>Copy as cURL (bash)</strong> or{" "}
        <strong>Copy as fetch</strong>. Cookies, tokens and other browser headers are removed before
        anything is saved; the text goes only to this local server.
      </p>
      {importCurl.isError && (
        <p role="alert" className="text-sm text-danger">
          {messageOf(importCurl.error)}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          className={PRIMARY}
          disabled={text.trim() === "" || importCurl.isPending}
        >
          {importCurl.isPending && <SpinnerIcon />}
          Read request
        </button>
      </div>
    </form>
  );
}

function ResultPanel({ result }: { result: VerifyResult }) {
  return (
    <div
      role="status"
      className={`rounded-sm border p-3 text-sm ${result.ok ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-danger/40 bg-danger-soft text-danger"}`}
    >
      <p className="font-semibold">
        {result.ok ? "Test passed" : "Test failed"}: {describeVerify(result)}
      </p>
      {result.ok && result.sampleTitles.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {result.sampleTitles.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      )}
      {result.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-caution">
          {warning}
        </p>
      ))}
    </div>
  );
}

interface ReviewStepProps {
  imported: ImportCurlResponse;
  existingSlugs: ReadonlySet<string>;
  onBack: () => void;
  onSaved: (message: string) => void;
}

function ReviewStep({ imported, existingSlugs, onBack, onSaved }: ReviewStepProps) {
  const [form, setForm] = useState<DraftForm>(() => formFromImport(imported));
  const [tested, setTested] = useState<{ recipeJson: string; result: VerifyResult } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const verify = useVerifyCompany();
  const create = useCreateCompany();
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<DraftForm>): void =>
    setForm((current) => ({ ...current, ...patch }));
  const slugTaken = existingSlugs.has(form.slug);
  const missing =
    !form.name.trim() || !form.slug || !form.category || !form.careersUrl.trim()
      ? "Name, slug, category and careers URL are required"
      : slugTaken
        ? `A company with the slug "${form.slug}" already exists`
        : null;

  const built = buildRecipe(form);
  const currentJson = "recipe" in built ? JSON.stringify(built.recipe) : null;
  const testPassed = tested?.result.ok === true && tested.recipeJson === currentJson;
  const testIsStale = tested !== null && tested.recipeJson !== currentJson;

  const runTest = (): void => {
    if (!("recipe" in built)) return;
    setProblem(null);
    verify.mutate(
      { slug: form.slug, recipe: built.recipe },
      {
        onSuccess: (result) => setTested({ recipeJson: JSON.stringify(built.recipe), result }),
        onError: (error) => {
          setTested(null);
          setProblem(messageOf(error));
        },
      },
    );
  };

  const save = async (): Promise<void> => {
    if (!("recipe" in built)) return;
    setSaving(true);
    setProblem(null);
    try {
      await create.mutateAsync(built.recipe);
      const result = await verify.mutateAsync({ slug: form.slug });
      onSaved(
        result.ok
          ? `${form.name.trim()} saved and verified (${describeVerify(result)})`
          : `${form.name.trim()} saved but not verified: ${result.error ?? "unknown error"}`,
      );
    } catch (error) {
      setProblem(messageOf(error));
      setSaving(false);
    }
  };

  const { detectedAts, strippedHeaders, warnings } = imported;
  const blocker = missing ?? ("error" in built ? built.error : null);

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-sm bg-sunken p-3 text-sm">
        <p>
          <span className="font-medium">Request:</span>{" "}
          <code className="font-mono text-xs break-all">
            {imported.draft.fetch.method ?? "GET"} {imported.draft.fetch.url}
          </code>
        </p>
        <p>
          <span className="font-medium">ATS:</span>{" "}
          {detectedAts ? `${ATS_LABELS[detectedAts]} (recognised from the URL)` : "not recognised"}
        </p>
        <p className="text-muted">
          {strippedHeaders.length === 0
            ? "No headers were removed."
            : `Removed ${strippedHeaders.length} header${strippedHeaders.length === 1 ? "" : "s"}: ${strippedHeaders.join(", ")}.`}
        </p>
        {warnings.map((warning) => (
          <p key={warning} className="text-caution">
            {warning}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Company name">
          {(id) => (
            <input
              id={id}
              className={INPUT}
              value={form.name}
              onChange={(event) =>
                update({
                  name: event.target.value,
                  ...(!form.slugEdited && { slug: slugify(event.target.value) }),
                })
              }
            />
          )}
        </Field>
        <Field label="Slug" hint="File name and id. Cannot be changed later.">
          {(id) => (
            <input
              id={id}
              className={`${INPUT} font-mono`}
              value={form.slug}
              aria-invalid={slugTaken}
              onChange={(event) => update({ slug: slugify(event.target.value), slugEdited: true })}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              className={INPUT}
              value={form.category}
              onChange={(event) => update({ category: event.target.value as CompanyCategory })}
            >
              <option value="" disabled>
                Choose…
              </option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Careers site URL">
          {(id) => (
            <input
              id={id}
              type="url"
              className={INPUT}
              value={form.careersUrl}
              onChange={(event) => update({ careersUrl: event.target.value })}
            />
          )}
        </Field>
        <Field label="ATS adapter" hint="Chosen from the URL. Change it only if it is wrong.">
          {(id) => (
            <select
              id={id}
              className={INPUT}
              value={form.ats}
              onChange={(event) => {
                const ats = event.target.value as Ats;
                update({
                  ats,
                  ...(ats === "generic" &&
                    !form.fieldMapJson.trim() && { fieldMapJson: FIELD_MAP_TEMPLATE }),
                });
              }}
            >
              {Object.entries(ATS_LABELS)
                .filter(([ats]) => ats !== "manual")
                .map(([ats, label]) => (
                  <option key={ats} value={ats}>
                    {label}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field
          label="Keywords"
          hint="Comma-separated, at most 6: one search per keyword. Empty = one unfiltered search."
        >
          {(id) => (
            <input
              id={id}
              className={INPUT}
              value={form.keywords}
              onChange={(event) => update({ keywords: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Location filter (optional)"
          hint="The ATS's own location value from the real request."
        >
          {(id) => (
            <input
              id={id}
              className={INPUT}
              value={form.location}
              onChange={(event) => update({ location: event.target.value })}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 self-center text-sm">
          <input
            type="checkbox"
            className="accent-accent"
            checked={form.indiaFiltered}
            onChange={(event) => update({ indiaFiltered: event.target.checked })}
          />
          The request already returns only India jobs
        </label>
      </div>

      <details open={form.ats === "generic"} className="text-sm">
        <summary className="font-medium">Request and field map (JSON)</summary>
        <div className="mt-2 space-y-3">
          <Field label="Request (fetch)">
            {(id) => (
              <textarea
                id={id}
                rows={7}
                spellCheck={false}
                className={TEXTAREA}
                value={form.fetchJson}
                onChange={(event) => update({ fetchJson: event.target.value })}
              />
            )}
          </Field>
          {form.ats === "generic" && (
            <Field
              label="Field map"
              hint="Dot paths into the JSON response, e.g. data.jobs and locations.0.name. Set url or urlTemplate, not both."
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={8}
                  spellCheck={false}
                  className={TEXTAREA}
                  value={form.fieldMapJson}
                  onChange={(event) => update({ fieldMapJson: event.target.value })}
                />
              )}
            </Field>
          )}
        </div>
      </details>

      {blocker && <p className="text-sm text-muted">{blocker}</p>}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {tested && <ResultPanel result={tested.result} />}
      {testIsStale && (
        <p className="text-sm text-caution">
          You changed the recipe after the test. Test it again.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button type="button" className={SECONDARY} onClick={onBack} disabled={saving}>
          Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className={SECONDARY}
            onClick={runTest}
            disabled={blocker !== null || verify.isPending || saving}
          >
            {verify.isPending && !saving ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => void save()}
            disabled={!testPassed || saving}
            title={testPassed ? undefined : "Run a passing test first"}
          >
            {saving && <SpinnerIcon />}
            Save company
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddCompanyDialogProps {
  open: boolean;
  existingSlugs: ReadonlySet<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function AddCompanyDialog({ open, existingSlugs, onClose, onSaved }: AddCompanyDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [imported, setImported] = useState<ImportCurlResponse | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = (): void => {
    setImported(null);
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-sm bg-surface p-0 text-ink shadow-2xl backdrop:animate-fade-in backdrop:bg-ink/40 open:animate-drawer-in"
    >
      {open && (
        <div>
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Add company
              </h2>
              <p className="text-sm text-muted">
                {imported
                  ? "Step 2 of 2: review, test and save"
                  : "Step 1 of 2: paste the job-list request"}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="rounded-sm p-1 text-muted hover:bg-sunken hover:text-ink"
            >
              <CloseIcon />
            </button>
          </header>
          <div className="px-5 py-4">
            {imported ? (
              <ReviewStep
                imported={imported}
                existingSlugs={existingSlugs}
                onBack={() => setImported(null)}
                onSaved={(message) => {
                  setImported(null);
                  onSaved(message);
                }}
              />
            ) : (
              <PasteStep onParsed={setImported} />
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
