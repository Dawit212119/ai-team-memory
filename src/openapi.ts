export function getOpenApiSpec() {
  const port = Number(process.env.PORT) || 3000;
  const localhostUrl = `http://localhost:${port}`;
  const loopbackUrl = `http://127.0.0.1:${port}`;
  const baseUrl = process.env.API_PUBLIC_URL || loopbackUrl;

  const serversSet: { url: string; description: string }[] = [];
  const add = (url: string, description: string) => {
    if (!serversSet.some((s) => s.url === url)) {
      serversSet.push({ url, description });
    }
  };
  add(baseUrl, "Primary (matches API_PUBLIC_URL or default)");
  if (!process.env.API_PUBLIC_URL) {
    add(loopbackUrl, "Loopback IPv4");
    add(localhostUrl, "localhost hostname");
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "AI Team Memory API",
      description:
        "Automatic institutional memory from engineering activity. Ingest GitHub PRs, extract structured knowledge, and search semantically.",
      version: "0.1.0",
    },
    servers: serversSet,
    tags: [
      { name: "Health", description: "Service health" },
      { name: "Ingestion", description: "GitHub sync" },
      { name: "Memory", description: "Engineering memory objects" },
      { name: "Search", description: "Semantic and hybrid search" },
      { name: "Intelligence", description: "Synthesis, reasoning, timeline" },
      { name: "Entities", description: "Entity resolution" },
    ],
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
        HealthResponse: {
          type: "object",
          properties: { status: { type: "string", example: "ok" } },
          required: ["status"],
        },
        SyncRepoBody: {
          type: "object",
          properties: {
            repo: { type: "string", example: "vercel/next.js" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          required: ["repo"],
        },
        SyncRepoResponse: {
          type: "object",
          properties: {
            repo: { type: "string" },
            synced_prs: { type: "integer" },
            memory_ids: { type: "array", items: { type: "string" } },
          },
          required: ["repo", "synced_prs", "memory_ids"],
        },
        ConfidenceScore: {
          type: "object",
          properties: {
            answer_confidence: { type: "number" },
            evidence_count: { type: "integer" },
            source_consistency: { type: "number" },
          },
        },
        SearchResponse: {
          type: "object",
          properties: {
            query: { type: "string" },
            results: { type: "array", items: { $ref: "#/components/schemas/MemoryObject" } },
            confidence: { $ref: "#/components/schemas/ConfidenceScore" },
          },
        },
        MemoryObject: {
          type: "object",
          properties: {
            id: { type: "string", example: "owner/repo#42" },
            repo: { type: "string" },
            pr_number: { type: "integer" },
            pr_title: { type: "string" },
            problem: { type: "string" },
            root_cause: { type: "string", nullable: true },
            fix: { type: "string" },
            reasoning: { type: "string" },
            risk_area: { type: "string", nullable: true },
            services_affected: { type: "array", items: { type: "string" } },
            summary: { type: "string", nullable: true },
            files_changed: { type: "array", items: { type: "string" } },
            author: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            score: { type: "number" },
          },
        },
        SynthesizeBody: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        ReasonBody: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        EntityBody: {
          type: "object",
          properties: {
            canonical: { type: "string" },
            alias: { type: "string" },
            entity_type: { type: "string", default: "service" },
          },
          required: ["canonical", "alias"],
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Service is healthy",
              content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
            },
          },
        },
      },
      "/sync-repo": {
        post: {
          tags: ["Ingestion"],
          summary: "Sync pull requests from a GitHub repo",
          operationId: "postSyncRepo",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SyncRepoBody" } } },
          },
          responses: {
            "200": {
              description: "Sync complete",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SyncRepoResponse" } } },
            },
            "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "500": { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/search": {
        get: {
          tags: ["Search"],
          summary: "Hybrid semantic + keyword search",
          operationId: "getSearch",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Search results", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } },
            "400": { description: "Missing query", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/synthesize": {
        post: {
          tags: ["Intelligence"],
          summary: "Synthesize memories into a coherent explanation",
          operationId: "postSynthesize",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SynthesizeBody" } } },
          },
          responses: {
            "200": { description: "Synthesis result" },
            "400": { description: "Missing query" },
          },
        },
      },
      "/reason": {
        post: {
          tags: ["Intelligence"],
          summary: "Multi-hop reasoning over engineering data",
          operationId: "postReason",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReasonBody" } } },
          },
          responses: { "200": { description: "Reasoning result" } },
        },
      },
      "/memory/{id}": {
        get: {
          tags: ["Memory"],
          summary: "Get memory by ID",
          operationId: "getMemoryById",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Memory object", content: { "application/json": { schema: { $ref: "#/components/schemas/MemoryObject" } } } },
            "404": { description: "Not found" },
          },
        },
      },
      "/timeline/service/{name}": {
        get: {
          tags: ["Intelligence"],
          summary: "Timeline reconstruction for a service",
          operationId: "getServiceTimeline",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Timeline data" } },
        },
      },
      "/explain/service/{name}": {
        get: {
          tags: ["Intelligence"],
          summary: "Explain a service's history and ownership",
          operationId: "getServiceExplain",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Service explanation" } },
        },
      },
      "/entities": {
        get: {
          tags: ["Entities"],
          summary: "List all entity aliases",
          operationId: "getEntities",
          responses: { "200": { description: "Entity list" } },
        },
        post: {
          tags: ["Entities"],
          summary: "Add entity alias",
          operationId: "postEntity",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EntityBody" } } },
          },
          responses: { "200": { description: "Alias created" } },
        },
      },
      "/evaluate": {
        post: {
          tags: ["Search"],
          summary: "Run evaluation benchmarks",
          operationId: "postEvaluate",
          responses: { "200": { description: "Evaluation results" } },
        },
      },
    },
  };
}
