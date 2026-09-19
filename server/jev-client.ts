import type {
  AgentAction,
  JevJudgment,
  PerceptionState,
} from "../shared/types.js";
import { ACTIONS, buildJevRequest } from "./decision-policy.js";

interface JevAnswer {
  model?: string;
  answers?: {
    action?: {
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    };
    close_intent?: { noul?: number };
    intentional_control?: { noul?: number };
    signal_quality?: {
      score?: number;
      probabilities?: Record<string, number>;
    };
  };
}

export async function requestJevJudgment(
  state: PerceptionState,
): Promise<JevJudgment> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is required when DECISION_PROVIDER=jev");
  }

  const baseUrl = (process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(
    /\/$/,
    "",
  );
  const requestedModel = process.env.TYPESAFE_MODEL ?? "jev-latest";
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildJevRequest(state, requestedModel)),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Jev request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as JevAnswer;
  const answer = body.answers?.action;
  const rawAction = answer?.choice ?? "none";
  const candidateAction: AgentAction = ACTIONS.includes(rawAction as AgentAction)
    ? (rawAction as AgentAction)
    : "none";

  return {
    candidateAction,
    confidence: answer?.confidence ?? answer?.probabilities?.[rawAction] ?? 0,
    probabilities: (answer?.probabilities ?? {}) as Partial<
      Record<AgentAction, number>
    >,
    intentionalControlProbability:
      body.answers?.intentional_control?.noul ?? 0,
    signalQualityScore: body.answers?.signal_quality?.score ?? 0,
    closeIntentProbability: body.answers?.close_intent?.noul ?? 0,
    provider: "jev",
    model: body.model ?? requestedModel,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}
