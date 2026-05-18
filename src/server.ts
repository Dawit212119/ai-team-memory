import "dotenv/config";

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { initDb } from "./db";
import { getOpenApiSpec } from "./openapi";
import {
  syncRepository,
  searchMemories,
  getMemoryObjectById,
  normalizeMemoryObject,
  explainService,
  runEvaluation,
  getLinkedIssuesForPr,
  getTimeline,
  synthesize,
  multiHopQuery,
  initDefaultEntities,
  getAllEntities,
  upsertEntityAlias,
} from "./memoryService";
import { getLinkedPrsForIssue } from "./repository";

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

const openapiSpec = getOpenApiSpec();
const swaggerExpressOptions = { customSiteTitle: "AI Team Memory API" };
const swaggerRouter = express.Router();
const swaggerFileMiddlewares = swaggerUi.serveFiles(openapiSpec, swaggerExpressOptions);
swaggerFileMiddlewares.forEach((mw: express.RequestHandler) => swaggerRouter.use(mw));
swaggerRouter.use(swaggerUi.setup(openapiSpec, swaggerExpressOptions));
app.use("/api-docs", swaggerRouter);

app.get("/openapi.json", (_req, res) => res.json(openapiSpec));

app.get("/", (_req, res) => {
  res.status(200).json({
    service: "AI Team Memory API",
    version: "0.1.0",
    docs_ui: "/api-docs/",
    health: "/health",
    sync_repo: "POST /sync-repo",
    search: "GET /search?q=",
    synthesize: "POST /synthesize",
    multi_hop: "POST /reason",
    memory: "GET /memory/{id}",
    timeline: "GET /timeline/service/{name}",
    explain: "GET /explain/service/{name}",
    entities: "GET /entities",
    evaluate: "POST /evaluate",
  });
});

app.get("/docs", (_req, res) => res.redirect(302, "/api-docs/"));
app.get("/swagger", (_req, res) => res.redirect(302, "/api-docs/"));
app.get("/health", async (_req, res) => res.json({ status: "ok" }));

app.post("/sync-repo", async (req, res) => {
  try {
    const { repo, limit } = req.body || {};
    if (!repo || typeof repo !== "string")
      return res.status(400).json({ error: "repo is required (owner/name)" });
    return res.json(await syncRepository(repo, Number(limit) || 20));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== "string")
      return res.status(400).json({ error: "q query parameter is required" });
    const { results, confidence } = await searchMemories(q);
    return res.json({ query: q, results, confidence });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/synthesize", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string")
      return res.status(400).json({ error: "query is required" });
    return res.json(await synthesize(query));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/reason", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string")
      return res.status(400).json({ error: "query is required" });
    return res.json(await multiHopQuery(query));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/memory/:id", async (req, res) => {
  try {
    const row = await getMemoryObjectById(req.params.id);
    if (!row) return res.status(404).json({ error: "memory object not found" });
    const normalized = normalizeMemoryObject(row);
    const linkedIssues = await getLinkedIssuesForPr(row.repo, row.pr_number || 0);
    return res.json({ ...normalized, linked_issues: linkedIssues });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/timeline/service/:name", async (req, res) => {
  try {
    return res.json(await getTimeline(req.params.name));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/explain/service/:name", async (req, res) => {
  try {
    return res.json(await explainService(req.params.name));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/entities", async (_req, res) => {
  try {
    return res.json(await getAllEntities());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/entities", async (req, res) => {
  try {
    const { canonical, alias, entity_type } = req.body || {};
    if (!canonical || !alias)
      return res.status(400).json({ error: "canonical and alias are required" });
    await upsertEntityAlias(canonical, alias.toLowerCase(), entity_type || "service");
    return res.json({ canonical, alias: alias.toLowerCase(), entity_type: entity_type || "service" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/issues/:repo/:issueNumber/prs", async (req, res) => {
  try {
    const repo = req.params.repo;
    const issueNumber = Number(req.params.issueNumber);
    return res.json({
      repo,
      issue_number: issueNumber,
      linked_prs: await getLinkedPrsForIssue(repo, issueNumber),
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/evaluate", async (req, res) => {
  try {
    const { benchmarks } = req.body || {};
    if (!Array.isArray(benchmarks) || benchmarks.length === 0)
      return res.status(400).json({ error: "benchmarks array is required" });
    return res.json(await runEvaluation(benchmarks));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

async function main() {
  await initDb();
  await initDefaultEntities();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`AI Team Memory API listening on ${port}`));
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
