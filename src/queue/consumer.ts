import { Bindings, QueueMessage } from "../app/types";
import { ensureQueueTables, pruneOldRuns } from "../pipeline/retention";
import { logQueueFailed } from "../pipeline/persistence";
import { processTranslationMessage } from "./translator";
import { handlePrepareWorldStateRun, handleProcessWorldStateRoot } from "./pipeline";

export async function handleTranslateQueue(
  batch: MessageBatch<QueueMessage>,
  env: Bindings
): Promise<void> {
  await ensureQueueTables(env.TENNODEV_WORLDSTATE_D1);

  for (const message of batch.messages) {
    const body = message.body;
    const rootKey = "rootKey" in body ? body.rootKey : "unknown";
    const payloadKey = "payloadKey" in body ? body.payloadKey : "unknown";

    try {
      if (body?.type === "worldstate.prepare-run") {
        await handlePrepareWorldStateRun(env, body);
      } else if (body?.type === "worldstate.process-root") {
        await handleProcessWorldStateRoot(env, body);
      } else if (body?.type === "worldstate.translate-root") {
        await processTranslationMessage(env, body);
      } else {
        throw new Error("Unsupported queue message type");
      }

      message.ack();
    } catch (error) {
      const errText = error instanceof Error ? error.message : "unknown error";
      await logQueueFailed(env.TENNODEV_WORLDSTATE_D1, {
        runId: body?.runId ?? "unknown",
        rootKey,
        payloadKey,
        targetLanguages: body?.targetLanguages ?? [],
        error: errText,
      });
      message.retry();
    }
  }

  await pruneOldRuns(env);
}