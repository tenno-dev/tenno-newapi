import { Bindings, TranslateQueueMessage } from "../app/types";
import {
  logQueueProcessed,
  writeDummyTranslationArtifact,
} from "../pipeline/persistence";

export async function processDummyTranslationMessage(
  env: Bindings,
  message: TranslateQueueMessage
): Promise<void> {
  const payload = await env.TENNODEV_WORLDSTATE_KV.get(message.payloadKey);
  const payloadSize = payload?.length ?? 0;

  await writeDummyTranslationArtifact(env, {
    runId: message.runId,
    rootKey: message.rootKey,
    sourceLocale: message.sourceLocale,
    targetLanguages: message.targetLanguages,
    payloadKey: message.payloadKey,
    payloadSize,
  });

  await logQueueProcessed(env.TENNODEV_WORLDSTATE_D1, {
    runId: message.runId,
    rootKey: message.rootKey,
    payloadKey: message.payloadKey,
    targetLanguages: message.targetLanguages,
    payloadSize,
  });
}
