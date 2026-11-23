import type { RefreshEvent } from "@server/types";
import { useEffect, useEffectEvent, useReducer } from "react";
import {
  EMPTY_PROGRESS,
  applyProgressAction,
  eventEndsRun,
  type ProgressAction,
  type RunProgress,
} from "../lib/refresh-progress";

const EVENT_TYPES = ["snapshot", "company-started", "company-finished", "run-finished"] as const;

interface Tracked {
  runId: number | null;
  progress: RunProgress;
}

type TrackedAction = { runId: number; action: ProgressAction };

/** Progress belongs to one run id; events for an older run are dropped. */
function trackedReducer(state: Tracked, { runId, action }: TrackedAction): Tracked {
  const base = state.runId === runId ? state.progress : EMPTY_PROGRESS;
  return { runId, progress: applyProgressAction(base, action) };
}

/**
 * Follows a refresh run over Server-Sent Events. The server sends a snapshot first, so
 * attaching to a run that is already running (or finished) shows the full state.
 */
export function useRefreshRun(runId: number | null, onRunFinished?: () => void): RunProgress {
  const [tracked, dispatch] = useReducer(trackedReducer, { runId: null, progress: EMPTY_PROGRESS });
  const notifyFinished = useEffectEvent(() => onRunFinished?.());

  useEffect(() => {
    if (runId === null) return;
    const source = new EventSource(`/api/refresh/${runId}/events`);
    const send = (action: ProgressAction): void => dispatch({ runId, action });

    // The server closes the stream after the run ends; closing here stops EventSource reconnecting.
    const finish = (): void => {
      source.close();
      send({ type: "connection", state: "closed" });
    };

    source.onopen = () => send({ type: "connection", state: "open" });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        finish();
        // The page cannot know how the run ended; refetch the latest run so the button is not stuck.
        notifyFinished();
      } else {
        send({ type: "connection", state: "reconnecting" });
      }
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        const event = JSON.parse((message as MessageEvent<string>).data) as RefreshEvent;
        send(event);
        if (eventEndsRun(event)) {
          finish();
          notifyFinished();
        }
      });
    }
    return () => source.close();
  }, [runId]);

  return runId !== null && tracked.runId === runId ? tracked.progress : EMPTY_PROGRESS;
}
