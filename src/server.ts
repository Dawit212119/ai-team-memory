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
import { initSlack, slackStatus } from "./slack";
import { computeServiceOwnership, computeBusFactorReport, computeFileOwnership, getTeamOverview } from "./ownership";
import { createIncident, updateIncident, getIncidentById, listIncidents, whatBrokeAfterDeploy, getIncidentStats } from "./incidents";
import { buildServiceGraph, analyzeImpact, getFileCoChanges } from "./dependencies";
import { logAuditEvent, getAuditLog } from "./audit";
import { getGitHubAuthUrl, handleGitHubCallback, getSlackAuthUrl, handleSlackCallback, listIntegrations, deleteIntegration } from "./integrations";
import { ingestSlackMessage, fetchAndIngestSlackHistory, getSlackInsights } from "./slackIngestion";

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
      ownership: "GET /ownership/service/{name}",
      bus_factor: "GET /bus-factor/service/{name}",
      team: "GET /team/overview",
      file_owners: "GET /ownership/file/{repo}/{path}",
      dependency_graph: "GET /dependencies/graph",
      impact_analysis: "GET /dependencies/impact/{service}",
      incidents: "POST /incidents",
      incident_stats: "GET /incidents/stats",
      deploy_impact: "GET /deploy-impact?time=&hours=",
      integrations: "GET /integrations",
      connect_github: "GET /auth/github",
      connect_slack: "GET /auth/slack",
      slack_ingest: "POST /slack/ingest-channel",
      slack_insights: "GET /slack/insights",
      audit_log: "GET /audit-log",
      webhooks: "POST /webhooks/github",
      slack: "GET /slack/status",
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

// Slack status
app.get("/slack/status", (_req, res) => res.json(slackStatus()));

// --- OAuth Callbacks (public, before auth middleware) ---
app.get("/auth/github", (req, res) => {
  try {
    const tenantId = (req.query.tenant as string) || "default";
    return res.redirect(getGitHubAuthUrl(tenantId));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/auth/github/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: "Missing code or state" });
    await handleGitHubCallback(code as string, state as string);
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3001";
    return res.redirect(`${dashboardUrl}/settings?connected=github`);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/auth/slack", (req, res) => {
  try {
    const tenantId = (req.query.tenant as string) || "default";
    return res.redirect(getSlackAuthUrl(tenantId));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/auth/slack/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: "Missing code or state" });
    await handleSlackCallback(code as string, state as string);
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3001";
    return res.redirect(`${dashboardUrl}/settings?connected=slack`);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

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
    await logAuditEvent({ tenantId, actor: req.keyPrefix || "system", action: "api_key.create", resourceType: "api_key", resourceId: String(result.id), details: { name }, ipAddress: req.ip });
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
    const keyId = Number(req.params.id as string);
    await revokeKey(keyId);
    await logAuditEvent({ tenantId: (req as AuthenticatedRequest).tenantId || "default", actor: (req as AuthenticatedRequest).keyPrefix || "system", action: "api_key.revoke", resourceType: "api_key", resourceId: String(keyId) });
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

// --- Ownership Intelligence ---
app.get("/ownership/service/:name", requireScope("read"), async (req, res) => {
  try {
    return res.json(await computeServiceOwnership(req.params.name as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/bus-factor/service/:name", requireScope("read"), async (req, res) => {
  try {
    return res.json(await computeBusFactorReport(req.params.name as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/team/overview", requireScope("read"), async (_req, res) => {
  try {
    return res.json(await getTeamOverview());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/ownership/file/:repo/*path", requireScope("read"), async (req, res) => {
  try {
    const repo = req.params.repo as string;
    const filePath = req.params.path as string;
    return res.json(await computeFileOwnership(repo, filePath));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Dependency Intelligence ---
app.get("/dependencies/graph", requireScope("read"), async (_req, res) => {
  try {
    return res.json(await buildServiceGraph());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/dependencies/impact/:service", requireScope("read"), async (req, res) => {
  try {
    return res.json(await analyzeImpact(req.params.service as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/dependencies/file-cochanges/:repo/*path", requireScope("read"), async (req, res) => {
  try {
    return res.json(await getFileCoChanges(req.params.repo as string, req.params.path as string));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Incident Memory ---
app.post("/incidents", requireScope("write"), async (req, res) => {
  try {
    const { title, severity, triggered_at } = req.body || {};
    if (!title || !triggered_at)
      return res.status(400).json({ error: "title and triggered_at are required" });
    const incident = await createIncident({
      externalId: req.body.external_id,
      repo: req.body.repo,
      title,
      description: req.body.description,
      severity: severity || "unknown",
      status: req.body.status,
      source: req.body.source,
      triggeredAt: triggered_at,
      resolvedAt: req.body.resolved_at,
      servicesAffected: req.body.services_affected,
    });
    return res.status(201).json(incident);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/incidents", requireScope("read"), async (req, res) => {
  try {
    const incidents = await listIncidents({
      status: req.query.status as string,
      severity: req.query.severity as string,
      service: req.query.service as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json(incidents);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/incidents/stats", requireScope("read"), async (_req, res) => {
  try {
    return res.json(await getIncidentStats());
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/incidents/:id", requireScope("read"), async (req, res) => {
  try {
    const incident = await getIncidentById(Number(req.params.id as string));
    if (!incident) return res.status(404).json({ error: "incident not found" });
    return res.json(incident);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/incidents/:id", requireScope("write"), async (req, res) => {
  try {
    const incident = await updateIncident(Number(req.params.id as string), {
      title: req.body.title,
      description: req.body.description,
      severity: req.body.severity,
      status: req.body.status,
      resolvedAt: req.body.resolved_at,
      servicesAffected: req.body.services_affected,
      postmortem: req.body.postmortem,
      relatedPrs: req.body.related_prs,
    });
    if (!incident) return res.status(404).json({ error: "incident not found" });
    return res.json(incident);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/deploy-impact", requireScope("read"), async (req, res) => {
  try {
    const time = req.query.time as string;
    if (!time) return res.status(400).json({ error: "time query parameter is required (ISO 8601)" });
    const hours = req.query.hours ? Number(req.query.hours) : 24;
    return res.json(await whatBrokeAfterDeploy(time, hours));
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

// --- Audit Log ---
app.get("/audit-log", requireScope("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = req.tenantId || "default";
    return res.json(await getAuditLog(tenantId, {
      action: req.query.action as string,
      actor: req.query.actor as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    }));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Integrations ---
app.get("/integrations", requireScope("read"), async (req: AuthenticatedRequest, res) => {
  try {
    return res.json(await listIntegrations(req.tenantId || "default"));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/integrations/:provider", requireScope("admin"), async (req: AuthenticatedRequest, res) => {
  try {
    const deleted = await deleteIntegration(req.tenantId || "default", req.params.provider as string);
    if (!deleted) return res.status(404).json({ error: "integration not found" });
    await logAuditEvent({ tenantId: req.tenantId || "default", actor: req.keyPrefix || "system", action: "integration.disconnect", resourceType: "integration", resourceId: req.params.provider as string });
    return res.json({ disconnected: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// --- Slack Ingestion ---
app.post("/slack/ingest-channel", requireScope("write"), async (req: AuthenticatedRequest, res) => {
  try {
    const { channel_id, limit } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: "channel_id is required" });
    return res.json(await fetchAndIngestSlackHistory(req.tenantId || "default", channel_id, Number(limit) || 100));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/slack/insights", requireScope("read"), async (req: AuthenticatedRequest, res) => {
  try {
    return res.json(await getSlackInsights(req.tenantId || "default"));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/slack/ingest-message", requireScope("write"), async (req: AuthenticatedRequest, res) => {
  try {
    const { channel_id, message_ts, text, user_name, channel_name, thread_ts } = req.body || {};
    if (!channel_id || !message_ts || !text)
      return res.status(400).json({ error: "channel_id, message_ts, and text are required" });
    return res.json(await ingestSlackMessage(req.tenantId || "default", {
      channel_id, message_ts, text, user_name, channel_name, thread_ts,
    }));
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
  initSlack(app);
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
