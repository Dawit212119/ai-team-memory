import crypto from "crypto";
import type { Request, Response } from "express";
import { insertWebhookEvent, markWebhookProcessed } from "./repository";
import { syncRepository } from "./memoryService";

function verifyGitHubSignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  const event = req.headers["x-github-event"] as string;
  const deliveryId = req.headers["x-github-delivery"] as string;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!event) {
    res.status(400).json({ error: "Missing X-GitHub-Event header" });
    return;
  }

  // Verify signature if webhook secret is configured
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = JSON.stringify(req.body);
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  }

  const payload = req.body;
  const repo = payload.repository?.full_name || null;

  // Store webhook event
  const eventId = await insertWebhookEvent(event, deliveryId || null, repo, payload);

  // Respond immediately — process async
  res.status(202).json({ received: true, event, delivery_id: deliveryId });

  // Process in background
  if (eventId > 0) {
    processWebhookEvent(eventId, event, repo, payload).catch((err) => {
      console.error(`Webhook processing error: ${err.message}`);
    });
  }
}

async function processWebhookEvent(
  eventId: number,
  event: string,
  repo: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    if (event === "pull_request" && repo) {
      const action = payload.action as string;
      if (["opened", "closed", "synchronize", "reopened"].includes(action)) {
        const prNumber = (payload.pull_request as Record<string, unknown>)?.number;
        console.log(`Webhook: PR #${prNumber} ${action} on ${repo} — syncing...`);
        await syncRepository(repo, 1);
      }
    }

    if (event === "push" && repo) {
      console.log(`Webhook: push to ${repo} — scheduling sync...`);
      await syncRepository(repo, 5);
    }

    if (event === "issues" && repo) {
      const action = payload.action as string;
      if (["opened", "closed", "reopened", "edited"].includes(action)) {
        console.log(`Webhook: issue ${action} on ${repo}`);
        // Issues are synced as part of syncRepository
      }
    }

    await markWebhookProcessed(eventId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markWebhookProcessed(eventId, message);
  }
}

export function webhookStatus() {
  return {
    endpoint: "POST /webhooks/github",
    supported_events: ["pull_request", "push", "issues"],
    signature_verification: !!process.env.GITHUB_WEBHOOK_SECRET,
    setup_instructions: {
      url: "https://your-domain.com/webhooks/github",
      content_type: "application/json",
      events: ["Pull requests", "Pushes", "Issues"],
      secret: "Set GITHUB_WEBHOOK_SECRET env var to match",
    },
  };
}
