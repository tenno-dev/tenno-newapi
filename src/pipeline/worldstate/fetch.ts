import { buildWorldStateCachePlanModel, buildWorldStateSplitModel } from "../read-models";

export async function getWorldStateSplit() {
  return buildWorldStateSplitModel();
}

export async function getWorldStateCachePlan(locale = "en") {
  return buildWorldStateCachePlanModel(locale);
}
