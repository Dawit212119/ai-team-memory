import OpenAI from "openai";
import type { ExtractionResult, SynthesisResult, MultiHopResult, NormalizedMemory } from "./types";

let cachedProvider: string | undefined;
let client: OpenAI | undefined;

interface ProviderConfig {
  apiKey: string;
  baseURL: string | undefined;
  extractModel: string;
  embedModel: string;
  defaultHeaders: Record<string, string> | undefined;
}

function getProvider(): string {
  return (process.env.LLM_PROVIDER || "openai").toLowerCase();
}

function getProviderConfig(provider: string): ProviderConfig {
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      extractModel: process.env.OPENAI_EXTRACT_MODEL || "gpt-4.1-mini",
      embedModel: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small",
      defaultHeaders: undefined,
    };
  }

  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      extractModel: process.env.OPENROUTER_EXTRACT_MODEL || "openai/gpt-4.1-mini",
      embedModel: process.env.OPENROUTER_EMBED_MODEL || "openai/text-embedding-3-small",
      defaultHeaders: {
        ...(process.env.OPENROUTER_HTTP_REFERER
          ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER }
          : {}),
        ...(process.env.OPENROUTER_X_TITLE
          ? { "X-Title": process.env.OPENROUTER_X_TITLE }
          : {}),
      },
    };
  }

  if (provider === "mindflow") {
    if (!process.env.MINDFLOW_API_KEY) throw new Error("Missing MINDFLOW_API_KEY");
    if (!process.env.MINDFLOW_BASE_URL) throw new Error("Missing MINDFLOW_BASE_URL");
    return {
      apiKey: process.env.MINDFLOW_API_KEY,
      baseURL: process.env.MINDFLOW_BASE_URL,
      extractModel: process.env.MINDFLOW_EXTRACT_MODEL || "gpt-4.1-mini",
      embedModel: process.env.MINDFLOW_EMBED_MODEL || "text-embedding-3-small",
      defaultHeaders: undefined,
    };
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}

function getClient(): OpenAI {
  const provider = getProvider();
  if (!client || cachedProvider !== provider) {
    const config = getProviderConfig(provider);
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      defaultHeaders: config.defaultHeaders,
    });
    cachedProvider = provider;
  }
  return client;
}

export async function extractMemoryFields(inputText: string): Promise<ExtractionResult> {
  const llm = getClient();
  const provider = getProvider();
  const { extractModel: model } = getProviderConfig(provider);

  const completion = await llm.responses.create({
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          "You extract structured engineering decision memory from GitHub pull request data.",
          "Return strict JSON with keys: problem, root_cause, fix, reasoning, risk_area, services_affected, summary.",
          "- problem: what user-facing or system issue was addressed",
          "- root_cause: the underlying technical cause (null if not clear from data)",
          "- fix: what was changed to resolve it",
          "- reasoning: why this approach was chosen",
          "- risk_area: one of: auth, database, api, config, testing, build, docs, performance, security, infra, ui, other",
          "- services_affected: array of service/module names inferred from file paths and description (empty array if unclear)",
          "- summary: one-sentence plain-english summary of the change",
          "Rules: never invent facts. If uncertain, use null. Infer conservatively from provided text only.",
        ].join("\n"),
      },
      { role: "user", content: inputText },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "memory_extraction",
        schema: {
          type: "object",
          properties: {
            problem: { type: "string" },
            root_cause: { type: ["string", "null"] },
            fix: { type: "string" },
            reasoning: { type: "string" },
            risk_area: { type: ["string", "null"] },
            services_affected: { type: "array", items: { type: "string" } },
            summary: { type: ["string", "null"] },
          },
          required: ["problem", "root_cause", "fix", "reasoning", "risk_area", "services_affected", "summary"],
          additionalProperties: false,
        },
      },
    },
  });

  const output = completion.output_text || "{}";
  const parsed = JSON.parse(output);

  return {
    problem: (parsed.problem || "").trim(),
    root_cause: parsed.root_cause ? parsed.root_cause.trim() : null,
    fix: (parsed.fix || "").trim(),
    reasoning: (parsed.reasoning || "").trim(),
    risk_area: parsed.risk_area ? parsed.risk_area.trim() : null,
    services_affected: Array.isArray(parsed.services_affected) ? parsed.services_affected : [],
    summary: parsed.summary ? parsed.summary.trim() : null,
  };
}

export async function embedText(text: string): Promise<number[]> {
  const llm = getClient();
  const provider = getProvider();
  const { embedModel: model } = getProviderConfig(provider);
  const embedding = await llm.embeddings.create({ model, input: text });
  return embedding.data[0].embedding;
}

export async function synthesizeMemories(
  query: string,
  memories: NormalizedMemory[]
): Promise<SynthesisResult> {
  const llm = getClient();
  const provider = getProvider();
  const { extractModel: model } = getProviderConfig(provider);

  const memorySummaries = memories
    .map(
      (m, i) =>
        [
          `[${i + 1}] PR: ${m.pr_title} (${m.id})`,
          `  Problem: ${m.problem}`,
          m.root_cause ? `  Root cause: ${m.root_cause}` : null,
          `  Fix: ${m.fix}`,
          `  Reasoning: ${m.reasoning}`,
          m.risk_area ? `  Risk area: ${m.risk_area}` : null,
          m.summary ? `  Summary: ${m.summary}` : null,
        ]
          .filter(Boolean)
          .join("\n")
    )
    .join("\n\n");

  const completion = await llm.responses.create({
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          "You synthesize engineering decision memories into a coherent explanation.",
          "Given a question and multiple related PR memories, produce:",
          "- answer: a clear, grounded explanation combining evidence from all sources",
          "- recurring_patterns: array of patterns seen across multiple PRs",
          "- key_decisions: array of important architectural/engineering decisions",
          "- risk_summary: overall risk assessment based on the evidence",
          "Never invent facts. Only reference what is present in the memories.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Question: ${query}\n\nRelated engineering memories:\n\n${memorySummaries}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "memory_synthesis",
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            recurring_patterns: { type: "array", items: { type: "string" } },
            key_decisions: { type: "array", items: { type: "string" } },
            risk_summary: { type: "string" },
          },
          required: ["answer", "recurring_patterns", "key_decisions", "risk_summary"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(completion.output_text || "{}") as SynthesisResult;
}

export async function multiHopReason(query: string, context: string): Promise<MultiHopResult> {
  const llm = getClient();
  const provider = getProvider();
  const { extractModel: model } = getProviderConfig(provider);

  const completion = await llm.responses.create({
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          "You perform multi-hop reasoning over engineering decision data.",
          "Given a complex question, PR memories, issue links, and temporal data:",
          "- Build a reasoning chain connecting evidence across PRs and issues",
          "- Identify causal relationships and contributor patterns",
          "- Produce a final answer grounded in the evidence",
          "Never speculate beyond what the data supports.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Question: ${query}\n\nEvidence:\n${context}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "multi_hop_reasoning",
        schema: {
          type: "object",
          properties: {
            reasoning_chain: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "integer" },
                  evidence: { type: "string" },
                  inference: { type: "string" },
                },
                required: ["step", "evidence", "inference"],
                additionalProperties: false,
              },
            },
            answer: { type: "string" },
            confidence: { type: "number" },
            contributing_factors: { type: "array", items: { type: "string" } },
          },
          required: ["reasoning_chain", "answer", "confidence", "contributing_factors"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(completion.output_text || "{}") as MultiHopResult;
}
