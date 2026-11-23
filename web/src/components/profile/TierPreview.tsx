import type { ProfileSaveResponse, RelevanceTier } from "@server/types";
import { TIERS, TIER_LABELS } from "../../lib/labels";
import { SpinnerIcon } from "../Icons";

function Delta({ before, after }: { before: number; after: number }) {
  const change = after - before;
  if (change === 0) return <span className="text-muted">no change</span>;
  const good = change > 0;
  return (
    <span className={`font-mono ${good ? "text-accent-strong" : "text-caution"}`}>
      {change > 0 ? "+" : "−"}
      {Math.abs(change)}
    </span>
  );
}

interface TierPreviewProps {
  preview: ProfileSaveResponse | undefined;
  loading: boolean;
  error: string | null;
}

/** How many open India jobs sit in each tier now, and after saving the profile as edited. */
export function TierPreview({ preview, loading, error }: TierPreviewProps) {
  return (
    <section aria-label="Preview" className="border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">Effect on your jobs</h2>
          <p className="text-xs text-muted">Open India jobs, re-scored from stored text.</p>
        </div>
        {loading && (
          <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
            <SpinnerIcon className="size-3.5" /> Calculating…
          </span>
        )}
      </header>
      <div className="p-4">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : !preview ? (
          <p className="text-sm text-muted">Calculating…</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Jobs per tier before and after the change</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Tier
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Now
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  After
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier: RelevanceTier) => (
                <tr key={tier} className="border-t border-line">
                  <th scope="row" className="py-1.5 font-medium">
                    {TIER_LABELS[tier]}
                  </th>
                  <td className="py-1.5 text-right font-mono">{preview.before[tier]}</td>
                  <td className="py-1.5 text-right font-mono">{preview.after[tier]}</td>
                  <td className="py-1.5 text-right">
                    <Delta before={preview.before[tier]} after={preview.after[tier]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview && (
          <p className="mt-2 text-xs text-muted">
            {preview.rescored} stored jobs are re-scored when you save. No job is fetched again.
          </p>
        )}
      </div>
    </section>
  );
}
