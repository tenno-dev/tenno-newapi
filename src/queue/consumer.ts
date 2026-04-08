import { Bindings, QueueMessage, TranslatePingMessage } from "../app/types";
import { ensureQueueTables, pruneOldRuns } from "../pipeline/retention";
import { logQueueFailed } from "../pipeline/persistence";
import { processTranslationMessage } from "./translator";
import { handlePrepareWorldStateRun, handleProcessWorldStateRoot } from "./pipeline";
import { sendWebPushBatch } from "../push/webpush";

export async function handleTranslateQueue(
  batch: MessageBatch<QueueMessage>,
  env: Bindings
): Promise<void> {
  await ensureQueueTables(env.TENNODEV_WORLDSTATE_D1);

  const pingMessages: TranslatePingMessage[] = [];

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
      } else if (body?.type === "worldstate.translate-ping") {
        pingMessages.push(body);
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
        targetLanguages: ("targetLanguages" in body ? body.targetLanguages : []) as string[],
        error: errText,
      });
      message.retry();
    }
  }

  // Process all collected ping messages together (deduplicated)
  if (pingMessages.length > 0) {
    await sendWebPushBatch(env, pingMessages);
  }

  await pruneOldRuns(env);
}