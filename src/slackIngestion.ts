import { pool } from "./db";
import { extractMemoryFields, embedText } from "./llm";
import { upsertMemoryObject } from "./repository";
import { getIntegration } from "./integrations";

const DECISION_PATTERNS = [
  /we('re| are) going (to|with)/i,
  /decided to/i,
  /let's (go with|use|switch|move|migrate)/i,
  /approved/i,
  /shipping/i,
  /rolling back/i,
  /reverting/i,
  /the plan is/i,
  /action item/i,
  /conclusion:/i,
  /tldr/i,
  /summary:/i,
  /root cause/i,
  /post-?mortem/i,
  /incident/i,
  /outage/i,
  /broke/i,
  /deploy/i,
  /released/i,
];

const SERVICE_PATTERN = /(?:auth|api|router|cache|database|db|redis|queue|worker|cron|cdn|gateway|proxy|middleware|frontend|backend|infra|ci|cd|pipeline|deploy|k8s|kubernetes|docker|aws|gcp|s3|lambda|cloudflare)/gi;

function isLikelyDecision(text: string): boolean {
  return DECISION_PATTERNS.some((p) => p.test(text));
}

function extractServiceMentions(text: string): string[] {
  const matches = text.match(SERVICE_PATTERN) || [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

interface SlackMessage {
  channel_id: string;
  channel_name?: string;
  message_ts: string;
  thread_ts?: string;
  user_id?: string;
  user_name?: string;
  text: string;
}

export async function ingestSlackMessage(tenantId: string, msg: SlackMessage): Promise<{ ingested: boolean; is_decision: boolean }> {
  if (!msg.text || msg.text.length < 20) return { ingested: false, is_decision: false };

  const isDecision = isLikelyDecision(msg.text);
  const services = extractServiceMentions(msg.text);

  await pool.query(
    `INSERT INTO slack_messages (tenant_id, channel_id, channel_name, message_ts, thread_ts, user_id, user_name, text, is_decision, services_mentioned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, channel_id, message_ts) DO UPDATE SET
       text = EXCLUDED.text,
       is_decision = EXCLUDED.is_decision,
       services_mentioned = EXCLUDED.services_mentioned`,
    [
      tenantId,
      msg.channel_id,
      msg.channel_name || null,
      msg.message_ts,
      msg.thread_ts || null,
      msg.user_id || null,
      msg.user_name || null,
      msg.text,
      isDecision,
      JSON.stringify(services),
    ]
  );

  if (isDecision && msg.text.length > 50) {
    try {
      await convertToMemory(tenantId, msg, services);
    } catch {
      // Best-effort memory conversion
    }
  }

  return { ingested: true, is_decision: isDecision };
}

async function convertToMemory(tenantId: string, msg: SlackMessage, services: string[]): Promise<void> {
  const extracted = await extractMemoryFields(
    `Slack message from ${msg.user_name || "unknown"} in #${msg.channel_name || msg.channel_id}:\n\n${msg.text}`
  );

  const memoryId = `slack:${tenantId}:${msg.channel_id}:${msg.message_ts}`;
  const embeddingInput = [
    extracted.problem || "",
    extracted.fix || "",
    extracted.reasoning || "",
    extracted.summary || msg.text.slice(0, 500),
    ...services,
  ].join("\n");

  const embedding = await embedText(embeddingInput);

  await upsertMemoryObject({
    id: memoryId,
    rawPrId: 0,
    repo: `slack:#${msg.channel_name || msg.channel_id}`,
    prNumber: 0,
    prTitle: `Slack: ${msg.text.slice(0, 100)}`,
    problem: extracted.problem || msg.text.slice(0, 500),
    rootCause: extracted.root_cause || null,
    fix: extracted.fix || "",
    reasoning: extracted.reasoning || "",
    riskArea: extracted.risk_area || null,
    servicesAffected: services.length > 0 ? services : (extracted.services_affected || []),
    summary: extracted.summary || null,
    filesChanged: [],
    author: msg.user_name || msg.user_id || "unknown",
    createdAt: new Date(Number(msg.message_ts) * 1000).toISOString(),
    embedding,
  });
}

export async function fetchAndIngestSlackHistory(tenantId: string, channelId: string, limit = 100): Promise<{ ingested: number; decisions: number }> {
  const integration = await getIntegration(tenantId, "slack");
  if (!integration) throw new Error("Slack not connected for this tenant");

  const res = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  });
  const data = await res.json() as { ok?: boolean; messages?: { ts: string; text?: string; user?: string; thread_ts?: string }[]; error?: string };

  if (!data.ok) throw new Error(data.error || "Failed to fetch Slack history");

  let ingested = 0;
  let decisions = 0;

  for (const msg of data.messages || []) {
    if (!msg.text) continue;
    const result = await ingestSlackMessage(tenantId, {
      channel_id: channelId,
      message_ts: msg.ts,
      thread_ts: msg.thread_ts,
      user_id: msg.user,
      text: msg.text,
    });
    if (result.ingested) ingested++;
    if (result.is_decision) decisions++;
  }

  return { ingested, decisions };
}

export async function getSlackInsights(tenantId: string): Promise<{
  total_messages: number;
  decisions_captured: number;
  services_mentioned: { service: string; count: number }[];
  recent_decisions: { text: string; user_name: string | null; channel_name: string | null; created_at: string }[];
}> {
  const totalResult = await pool.query(
    "SELECT COUNT(*) as count FROM slack_messages WHERE tenant_id = $1",
    [tenantId]
  );
  const decisionsResult = await pool.query(
    "SELECT COUNT(*) as count FROM slack_messages WHERE tenant_id = $1 AND is_decision = true",
    [tenantId]
  );
  const servicesResult = await pool.query(
    `SELECT s.value as service, COUNT(*) as count
     FROM slack_messages, jsonb_array_elements_text(services_mentioned) AS s(value)
     WHERE tenant_id = $1
     GROUP BY s.value
     ORDER BY COUNT(*) DESC LIMIT 10`,
    [tenantId]
  );
  const recentResult = await pool.query(
    `SELECT text, user_name, channel_name, created_at
     FROM slack_messages
     WHERE tenant_id = $1 AND is_decision = true
     ORDER BY created_at DESC LIMIT 10`,
    [tenantId]
  );

  return {
    total_messages: Number(totalResult.rows[0]?.count || 0),
    decisions_captured: Number(decisionsResult.rows[0]?.count || 0),
    services_mentioned: servicesResult.rows.map((r: { service: string; count: string }) => ({
      service: r.service,
      count: Number(r.count),
    })),
    recent_decisions: recentResult.rows,
  };
}
