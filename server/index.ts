import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filterJudgment } from "./decision-filter.js";
import { isPerceptionState, ruleJudgment } from "./decision-policy.js";
import { requestJevJudgment } from "./jev-client.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const configuredProvider = process.env.DECISION_PROVIDER ??
  (process.env.TYPESAFE_API_KEY ? "jev" : "rule");

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    provider: configuredProvider,
    hasApiKey: Boolean(process.env.TYPESAFE_API_KEY),
    cameraFramesLeaveBrowser: false,
  });
});

app.post("/api/decision", async (request, response) => {
  if (!isPerceptionState(request.body)) {
    response.status(400).json({ error: "Invalid perception state" });
    return;
  }

  try {
    const startedAt = performance.now();
    const judgment =
      configuredProvider === "jev"
        ? await requestJevJudgment(request.body)
        : ruleJudgment(request.body, Math.round(performance.now() - startedAt));
    response.json(filterJudgment(request.body, judgment));
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : "Decision provider failed",
    });
  }
});

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(resolve(dist, "index.html"));
  });
}

app.listen(port, "127.0.0.1", () => {
  console.log(`Jev media agent API listening on http://127.0.0.1:${port}`);
  console.log(`Decision provider: ${configuredProvider}`);
});
