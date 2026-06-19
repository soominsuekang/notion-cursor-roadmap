/**
 * Agent mode: parallel multi-file edits (RM-8).
 *
 * Collects a batch of per-file edits from the agent and applies them
 * atomically behind a SINGLE user approval, instead of prompting once per
 * file. Patches are computed in parallel; the apply step is transactional --
 * if any file fails to patch cleanly, the whole batch is rolled back so the
 * workspace is never left half-edited.
 */
import { computePatch, writePatch, revert, type Patch } from "./patchEngine";
import { summarize, type EditSummary } from "./editSummary";

export interface FileEdit {
  path: string;
  /** Unified-diff hunks the agent wants to apply to this file. */
  diff: string;
}

export interface ApplyResult {
  applied: string[];
  rolledBack: boolean;
  error?: string;
}

export async function applyMultiFileEdit(
  edits: FileEdit[],
  approve: (summary: EditSummary) => Promise<boolean>,
): Promise<ApplyResult> {
  // Compute every file's patch in parallel.
  const patches: Patch[] = await Promise.all(edits.map((e) => computePatch(e)));

  // A single approval gate for the whole batch.
  const ok = await approve(summarize(patches));
  if (!ok) return { applied: [], rolledBack: false };

  const applied: string[] = [];
  try {
    for (const patch of patches) {
      await writePatch(patch);
      applied.push(patch.path);
    }
    return { applied, rolledBack: false };
  } catch (err) {
    // Transactional rollback: undo everything we already wrote.
    await Promise.all(applied.map((path) => revert(path)));
    return { applied: [], rolledBack: true, error: String(err) };
  }
}
