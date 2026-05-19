import "dotenv/config";

import express from "express";
import cors from "cors";
import rateLimit, { type Options } from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { initDb, hasPgvector } from "./db";
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
import { authMiddleware, requireScope, registerApiKey, getKeys, revokeKey, type AuthenticatedRequest } from "./auth";
import { handleGitHubWebhook, webhookStatus } from "./webhooks";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cors({ origin: true }));

// Rate limiting
const tenantKeyGen: Options["keyGenerator"] = (req) => (req as AuthenticatedRequest).tenantId || "default";

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  keyGenerator: tenantKeyGen,
  validate: { xForwardedForHeader: false },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Sync rate limited — max 5 per minute" },
  keyGenerator: tenantKeyGen,
  validate: { xForwardedForHeader: false },
});

// Swagger docs (no auth required)
const openapiSpec = getOpenApiSpec();
const swaggerExpressOptions = { customSiteTitle: "AI Team Memory API" };
const swaggerRouter = express.Router();
const swaggerFileMiddlewares = swaggerUi.serveFiles(openapiSpec, swaggerExpressOptions);
swaggerFileMiddlewares.forEach((mw: express.RequestHandler) => swaggerRouter.use(mw));
swaggerRouter.use(swaggerUi.setup(openapiSpec, swaggerExpressOptions));
app.use("/api-docs", swaggerRouter);
app.get("/openapi.json", (_req, res) => res.json(openapiSpec));

// Public routes
app.get("/", async (_req, res) => {
  const hasVec = await hasPgvector();
  res.status(200).json({
    service: "AI Team Memory API",
    version: "0.1.0",
    pgvector: hasVec,
    auth_required: process.env.AUTH_REQUIRED === "true",
    docs_ui: "/api-docs/",
    endpoints: {
      health: "GET /health",
      sync_repo: "POST /sync-repo",
      search: "GET /search?q=",
      synthesize: "POST /synthesize",
      multi_hop: "POST /reason",
      memory: "GET /memory/{id}",
      timeline: "GET /timeline/service/{name}",
      explain: "GET /explain/service/{name}",
      entities: "GET /entities",
      webhooks: "POST /webhooks/github",
      api_keys: "POST /api-keys",
      evaluate: "POST /evaluate",
    },
  });
});

app.get("/docs", (_req, res) => res.redirect(302, "/api-docs/"));
app.get("/swagger", (_req, res) => res.redirect(302, "/api-docs/"));
app.get("/health", async (_req, res) => {
  const hasVec = await hasPgvector();
  res.json({ status: "ok", pgvector: hasVec });
});

// Webhook endpoint (no API key auth — uses signature verification)
app.post("/webhooks/github", handleGitHubWebhook);
app.get("/webhooks/status", (_req, res) => res.json(webhookStatus()));

// Auth middleware for all API routes below
app.use(authMiddleware);
app.use(apiLimiter);

// --- API Key Management ---
app.post("/api-keys", requireScope("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== "string")
      return res.status(400).json({ error: "name is required" });
    const tenantId = req.tenantId || "default";
    const result = await registerApiKey(tenantId, name);
    return res.status(201).json({
      id: result.id,
      key: result.key,
      prefix: result.prefix,
      tenant_id: tenantId,
      note: "Save this key — it cannot be retrieved again",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api-keys", requireScope("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    return res.json(await getKeys(req.tenantId || "default"));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api-keys/:id", requireScope("admin"), async (req, res) => {
  try {
    await revokeKey(Number(req.params.id as string));
    return res.json({ revoked: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Sync ---
app.post("/sync-repo", requireScope("write"), syncLimiter, async (req, res) => {
  try {
    const { repo, limit } = req.body || {};
    if (!repo || typeof repo !== "string")
      return res.status(400).json({ error: "repo is required (owner/name)" });
    return res.json(await syncRepository(repo, Number(limit) || 20));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Search (with confidence) ---
app.get("/search", requireScope("read"), async (req, res) => {
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

// --- Synthesize ---
app.post("/synthesize", requireScope("read"), async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string")
      return res.status(400).json({ error: "query is required" });
    return res.json(await synthesize(query));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Multi-hop reasoning ---
app.post("/reason", requireScope("read"), async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string")
      return res.status(400).json({ error: "query is required" });
    return res.json(await multiHopQuery(query));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Memory detail ---
app.get("/memory/:id", requireScope("read"), async (req, res) => {
  try {
    const row = await getMemoryObjectById(req.params.id as string);
    if (!row) return res.status(404).json({ error: "memory object not found" });
    const normalized = normalizeMemoryObject(row);
    const linkedIssues = await getLinkedIssuesForPr(row.repo, row.pr_number || 0);
    return res.json({ ...normalized, linked_issues: linkedIssues });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Timeline ---
app.get("/timeline/service/:name", requireScope("read"), async (req, res) => {
  try {
    return res.json(await getTimeline(req.params.name as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Explain service ---
app.get("/explain/service/:name", requireScope("read"), async (req, res) => {
  try {
    return res.json(await explainService(req.params.name as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Entity resolution ---
app.get("/entities", requireScope("read"), async (_req, res) => {
  try {
    return res.json(await getAllEntities());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/entities", requireScope("write"), async (req, res) => {
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

// --- Issue links ---
app.get("/issues/:repo/:issueNumber/prs", requireScope("read"), async (req, res) => {
  try {
    const repo = req.params.repo as string;
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

// --- Evaluate ---
app.post("/evaluate", requireScope("read"), async (req, res) => {
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
  const hasVec = await hasPgvector();
  const port = Number(process.env.PORT) || 3000;
  console.log(`pgvector: ${hasVec ? "enabled" : "not available (using JSONB fallback)"}`);
  console.log(`Auth: ${process.env.AUTH_REQUIRED === "true" ? "required" : "disabled (dev mode)"}`);
  app.listen(port, () => console.log(`AI Team Memory API listening on ${port}`));
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
