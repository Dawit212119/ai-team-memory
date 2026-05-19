import { App, ExpressReceiver, type BlockAction, type SlackActionMiddlewareArgs, type AllMiddlewareArgs } from "@slack/bolt";
import type { Express } from "express";
import {
  searchMemories,
  explainService,
  getTimeline,
  synthesize,
} from "./memoryService";
import type { SearchResultItem, NormalizedMemory } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;

let slackApp: App | null = null;
let receiver: ExpressReceiver | null = null;

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "_No data_";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function prUrl(repo: string, prNumber: number | null): string | null {
  if (!repo || !prNumber) return null;
  return `https://github.com/${repo}/pull/${prNumber}`;
}

function resultBlocks(results: SearchResultItem[], query: string) {
  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔍 Results for: ${truncate(query, 60)}`, emoji: true },
    },
  ];

  if (results.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No matching memories found. Try syncing a repo first with the API." },
    });
    return blocks;
  }

  for (const r of results.slice(0, 3)) {
    const url = prUrl(r.repo, r.pr_number);
    const title = url ? `<${url}|${r.pr_title}>` : r.pr_title;
    const score = (r.score * 100).toFixed(0);

    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*${title}* (${score}% match)`,
            `> *Problem:* ${truncate(r.problem, 200)}`,
            `> *Fix:* ${truncate(r.fix, 200)}`,
            r.risk_area ? `> *Risk:* ${r.risk_area}` : null,
            r.services_affected?.length ? `> *Services:* ${r.services_affected.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Details", emoji: true },
          action_id: `memory_detail_${r.id}`,
          value: r.id,
        },
      }
    );
  }

  if (results.length > 3) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `_${results.length - 3} more results not shown. Use the API for full results._` },
      ],
    });
  }

  return blocks;
}

function serviceBlocks(data: Record<string, unknown>, command: string) {
  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 ${command}: ${data.service}`, emoji: true },
    },
  ];

  if (command === "explain") {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total PRs:* ${data.total_prs}` },
        { type: "mrkdwn", text: `*Total Issues:* ${data.total_issues}` },
        { type: "mrkdwn", text: `*Contributors:* ${(data.contributors as string[])?.length || 0}` },
      ],
    });

    const riskAreas = data.risk_areas as { area: string; count: number }[];
    if (riskAreas?.length) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Risk Areas:*\n" + riskAreas.slice(0, 5).map((r) => `• ${r.area} (${r.count})`).join("\n"),
        },
      });
    }

    const majorPrs = data.major_prs as { pr_title: string; url: string | null; summary: string | null }[];
    if (majorPrs?.length) {
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Recent Major PRs:*\n" +
              majorPrs
                .slice(0, 5)
                .map((p) => {
                  const link = p.url ? `<${p.url}|${p.pr_title}>` : p.pr_title;
                  return `• ${link}: ${truncate(p.summary, 100)}`;
                })
                .join("\n"),
          },
        }
      );
    }
  }

  if (command === "timeline") {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total Changes:* ${data.total_changes}` },
        {
          type: "mrkdwn",
          text: `*Time Span:* ${(data.time_span as { from: string; to: string } | null)?.from?.slice(0, 10) || "N/A"} → ${(data.time_span as { from: string; to: string } | null)?.to?.slice(0, 10) || "N/A"}`,
        },
      ],
    });

    const timeline = data.timeline as { month: string; changes: number; prs: { pr_title: string; url: string | null }[] }[];
    if (timeline?.length) {
      const recent = timeline.slice(-3);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Recent Activity:*\n" +
            recent
              .map((period) => {
                const prList = period.prs
                  .slice(0, 3)
                  .map((p) => (p.url ? `<${p.url}|${p.pr_title}>` : p.pr_title))
                  .join(", ");
                return `• *${period.month}* (${period.changes} changes): ${prList}`;
              })
              .join("\n"),
        },
      });
    }

    const shifts = data.architectural_shifts as { date: string; from: string | null; to: string; pr_title: string }[];
    if (shifts?.length) {
      blocks.push(
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Architectural Shifts:*\n" +
              shifts
                .slice(-5)
                .map((s) => `• ${s.date.slice(0, 10)}: ${s.from || "none"} → ${s.to} (${s.pr_title})`)
                .join("\n"),
          },
        }
      );
    }
  }

  return blocks;
}

function detailBlocks(memory: NormalizedMemory) {
  const url = prUrl(memory.repo, memory.pr_number);
  const title = url ? `<${url}|${memory.pr_title}>` : memory.pr_title;

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📄 Memory: ${truncate(memory.pr_title, 60)}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*PR:* ${title}`,
          `*Author:* ${memory.author}`,
          `*Date:* ${memory.created_at?.slice(0, 10)}`,
          `*Repo:* ${memory.repo}`,
          memory.risk_area ? `*Risk Area:* ${memory.risk_area}` : null,
          memory.services_affected?.length ? `*Services:* ${memory.services_affected.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Problem:*\n${truncate(memory.problem, 500)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Root Cause:*\n${truncate(memory.root_cause, 500)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Fix:*\n${truncate(memory.fix, 500)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reasoning:*\n${truncate(memory.reasoning, 500)}`,
      },
    },
    memory.files_changed?.length
      ? {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*Files changed:* ${memory.files_changed.slice(0, 10).join(", ")}${memory.files_changed.length > 10 ? ` (+${memory.files_changed.length - 10} more)` : ""}`,
            },
          ],
        }
      : null,
  ].filter(Boolean);
}

export function initSlack(expressApp: Express): App | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!signingSecret || !botToken) {
    console.log("Slack: disabled (SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN not set)");
    return null;
  }

  receiver = new ExpressReceiver({
    signingSecret,
    endpoints: "/slack/events",
    app: expressApp,
  });

  slackApp = new App({
    token: botToken,
    receiver,
  });

  // /memory <query> — search team memory
  slackApp.command("/memory", async ({ command, ack, respond }) => {
    await ack();
    const query = command.text?.trim();
    if (!query) {
      await respond({ text: "Usage: `/memory <search query>`\nExample: `/memory why did auth break last week?`" });
      return;
    }

    try {
      await respond({ text: `Searching for: _${truncate(query, 100)}_…`, response_type: "ephemeral" });
      const { results, confidence } = await searchMemories(query);
      const blocks = resultBlocks(results, query);
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Confidence: ${(confidence.answer_confidence * 100).toFixed(0)}% | Evidence: ${confidence.evidence_count} items | Consistency: ${(confidence.source_consistency * 100).toFixed(0)}%`,
          },
        ],
      });
      await respond({ blocks, response_type: "ephemeral" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await respond({ text: `Error searching: ${msg}` });
    }
  });

  // /whychanged <service> — show service timeline
  slackApp.command("/whychanged", async ({ command, ack, respond }) => {
    await ack();
    const service = command.text?.trim();
    if (!service) {
      await respond({ text: "Usage: `/whychanged <service-name>`\nExample: `/whychanged auth`" });
      return;
    }

    try {
      const timeline = await getTimeline(service);
      const blocks = serviceBlocks(timeline as unknown as Record<string, unknown>, "timeline");
      await respond({ blocks, response_type: "ephemeral" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await respond({ text: `Error: ${msg}` });
    }
  });

  // /whoowns <service> — explain who works on a service
  slackApp.command("/whoowns", async ({ command, ack, respond }) => {
    await ack();
    const service = command.text?.trim();
    if (!service) {
      await respond({ text: "Usage: `/whoowns <service-name>`\nExample: `/whoowns router`" });
      return;
    }

    try {
      const explanation = await explainService(service);
      const blocks = serviceBlocks(explanation as unknown as Record<string, unknown>, "explain");
      await respond({ blocks, response_type: "ephemeral" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await respond({ text: `Error: ${msg}` });
    }
  });

  // /askmemory <question> — synthesize an answer from team memory
  slackApp.command("/askmemory", async ({ command, ack, respond }) => {
    await ack();
    const query = command.text?.trim();
    if (!query) {
      await respond({ text: "Usage: `/askmemory <question>`\nExample: `/askmemory what patterns caused incidents this quarter?`" });
      return;
    }

    try {
      await respond({ text: `Thinking about: _${truncate(query, 100)}_…`, response_type: "ephemeral" });
      const result = await synthesize(query);
      const blocks: Block[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "🧠 AI Synthesis", emoji: true },
        },
      ];

      if (result.synthesis) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Question:* ${query}` },
        });
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Answer:*\n${truncate(result.synthesis.answer, 1500)}` },
        });

        if (result.synthesis.recurring_patterns?.length) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Recurring Patterns:*\n" + result.synthesis.recurring_patterns.map((p: string) => `• ${p}`).join("\n"),
            },
          });
        }

        if (result.sources?.length) {
          blocks.push(
            { type: "divider" },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text:
                    "*Sources:* " +
                    result.sources
                      .slice(0, 5)
                      .map((s: { url?: string | null; pr_title?: string; id: string }) =>
                        s.url ? `<${s.url}|${s.pr_title || s.id}>` : s.id
                      )
                      .join(" | "),
                },
              ],
            }
          );
        }
      } else {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: "No relevant memories found. Try syncing a repo first." },
        });
      }

      await respond({ blocks, response_type: "ephemeral" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await respond({ text: `Error: ${msg}` });
    }
  });

  // Handle "Details" button clicks
  slackApp.action<BlockAction>(/^memory_detail_/, async (args) => {
    const { action, ack, respond } = args as SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs;
    await ack();
    const memoryId = (action as { value?: string }).value;
    if (!memoryId) return;

    try {
      const { getMemoryObjectById, normalizeMemoryObject } = await import("./memoryService");
      const row = await getMemoryObjectById(memoryId);
      if (!row) {
        await respond({ text: `Memory object \`${memoryId}\` not found.`, replace_original: false });
        return;
      }
      const normalized = normalizeMemoryObject(row);
      const blocks = detailBlocks(normalized);
      await respond({ blocks: blocks as never[], replace_original: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await respond({ text: `Error loading details: ${msg}`, replace_original: false });
    }
  });

  // Handle direct messages and mentions
  slackApp.event("app_mention", async ({ event, say }) => {
    const text = event.text?.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) {
      await say({ text: "Hi! I'm the AI Team Memory bot. Try asking me a question about your codebase.", thread_ts: event.ts });
      return;
    }

    try {
      const { results, confidence } = await searchMemories(text);
      const blocks = resultBlocks(results, text);
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Confidence: ${(confidence.answer_confidence * 100).toFixed(0)}%`,
          },
        ],
      });
      await say({ blocks, thread_ts: event.ts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await say({ text: `Error: ${msg}`, thread_ts: event.ts });
    }
  });

  slackApp.event("message", async ({ event, say }) => {
    const msg = event as { channel_type?: string; text?: string; ts?: string; bot_id?: string };
    if (msg.channel_type !== "im" || msg.bot_id) return;

    const text = msg.text?.trim();
    if (!text) return;

    try {
      const result = await synthesize(text);
      if (result.synthesis) {
        const blocks: Block[] = [
          {
            type: "section",
            text: { type: "mrkdwn", text: truncate(result.synthesis.answer, 2000) },
          },
        ];
        if (result.sources?.length) {
          blocks.push({
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text:
                  "Sources: " +
                  result.sources
                    .slice(0, 3)
                    .map((s: { url?: string | null; id: string }) => (s.url ? `<${s.url}|${s.id}>` : s.id))
                    .join(" | "),
              },
            ],
          });
        }
        await say({ blocks, thread_ts: msg.ts });
      } else {
        await say({ text: "I couldn't find relevant memories for that question. Make sure a repo has been synced.", thread_ts: msg.ts });
      }
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err);
      await say({ text: `Error: ${msg2}` });
    }
  });

  console.log("Slack: bot initialized (commands: /memory, /whychanged, /whoowns, /askmemory)");
  return slackApp;
}

export function slackStatus() {
  const configured = !!(process.env.SLACK_SIGNING_SECRET && process.env.SLACK_BOT_TOKEN);
  return {
    enabled: configured,
    commands: configured
      ? ["/memory", "/whychanged", "/whoowns", "/askmemory"]
      : [],
    events: configured
      ? ["app_mention", "message.im"]
      : [],
    setup_instructions: configured
      ? "Slack bot is active."
      : {
          step_1: "Create a Slack app at https://api.slack.com/apps",
          step_2: "Enable Event Subscriptions, point to: https://your-domain.com/slack/events",
          step_3: "Add bot scopes: commands, chat:write, app_mentions:read, im:read, im:write",
          step_4: "Create slash commands: /memory, /whychanged, /whoowns, /askmemory",
          step_5: "Set SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN env vars",
        },
  };
}
