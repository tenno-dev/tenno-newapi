import { Bindings, QueueMessage, TranslatePingMessage } from "../app/types";
import { ensureQueueTables, pruneOldRuns } from "../pipeline/retention";
import { logQueueFailed } from "../pipeline/persistence";
import { processTranslationMessage } from "./translator";
import { handlePrepareWorldStateRun, handleProcessWorldStateRoot } from "./pipeline";
import { sendWebPushBatch } from "../push/webpush";

export async function handleQueueMessage(
  env: Bindings,
  body: QueueMessage
): Promise<void> {
  await ensureQueueTables(env.sql);

  const rootKey = "rootKey" in body ? body.rootKey : "unknown";
  const payloadKey = "payloadKey" in body ? body.payloadKey : "unknown";

  try {
    if (body?.type === "worldstate.prepare-run") {
      await handlePrepareWorldStateRun(env, body);
    } else if (body?.type === "worldstate.process-root") {
      await handleProcessWorldStateRoot(env, body);
    } else if (body?.type === "worldstate.translate-root") {
      await processTranslationMessage(env, body);
    } else if (body?.type === "worldstate.translate-ping") {
      await sendWebPushBatch(env, [body as TranslatePingMessage]);
    } else {
      throw new Error("Unsupported queue message type");
    }
  } catch (error) {
    const errText = error instanceof Error ? error.message : "unknown error";
    await logQueueFailed(env.sql, {
      runId: body?.runId ?? "unknown",
      rootKey,
      payloadKey,
      targetLanguages: "targetLanguages" in body ? body.targetLanguages : [],
      error: errText,
    });
    throw error;
  }

  await pruneOldRuns(env);
}
