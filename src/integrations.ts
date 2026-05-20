import crypto from "crypto";
import { pool } from "./db";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encrypted: string): string {
  const [ivHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export interface Integration {
  id: number;
  tenant_id: string;
  provider: string;
  provider_team_id: string | null;
  provider_team_name: string | null;
  scopes: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function saveIntegration(params: {
  tenantId: string;
  provider: string;
  providerTeamId?: string;
  providerTeamName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  scopes?: string;
  connectedBy?: string;
  extra?: Record<string, unknown>;
}): Promise<Integration> {
  const encryptedToken = encrypt(params.accessToken);
  const encryptedRefresh = params.refreshToken ? encrypt(params.refreshToken) : null;

  const result = await pool.query(
    `INSERT INTO integrations (tenant_id, provider, provider_team_id, provider_team_name, access_token, refresh_token, token_expires_at, scopes, connected_by, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, provider, provider_team_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       provider_team_name = EXCLUDED.provider_team_name,
       extra = EXCLUDED.extra,
       updated_at = NOW()
     RETURNING id, tenant_id, provider, provider_team_id, provider_team_name, scopes, connected_by, created_at, updated_at`,
    [
      params.tenantId,
      params.provider,
      params.providerTeamId || null,
      params.providerTeamName || null,
      encryptedToken,
      encryptedRefresh,
      params.tokenExpiresAt || null,
      params.scopes || null,
      params.connectedBy || null,
      JSON.stringify(params.extra || {}),
    ]
  );
  return result.rows[0];
}

export async function getIntegration(tenantId: string, provider: string): Promise<(Integration & { access_token: string }) | null> {
  const result = await pool.query(
    "SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2 ORDER BY updated_at DESC LIMIT 1",
    [tenantId, provider]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    access_token: decrypt(row.access_token),
  };
}

export async function listIntegrations(tenantId: string): Promise<Integration[]> {
  const result = await pool.query(
    "SELECT id, tenant_id, provider, provider_team_id, provider_team_name, scopes, connected_by, created_at, updated_at FROM integrations WHERE tenant_id = $1 ORDER BY provider",
    [tenantId]
  );
  return result.rows;
}

export async function deleteIntegration(tenantId: string, provider: string): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM integrations WHERE tenant_id = $1 AND provider = $2",
    [tenantId, provider]
  );
  return (result.rowCount || 0) > 0;
}

// --- GitHub OAuth ---

export function getGitHubAuthUrl(tenantId: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("GITHUB_CLIENT_ID not configured");

  const state = Buffer.from(JSON.stringify({ tenantId, ts: Date.now() })).toString("base64url");
  const scopes = "repo,read:org";
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${scopes}&state=${state}`;
}

export async function handleGitHubCallback(code: string, state: string): Promise<Integration> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");

  const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
  const tenantId = parsed.tenantId || "default";

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; scope?: string; error?: string };

  if (!tokenData.access_token) throw new Error(tokenData.error || "Failed to get access token");

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "AI-Team-Memory" },
  });
  const userData = await userRes.json() as { login?: string; id?: number };

  return saveIntegration({
    tenantId,
    provider: "github",
    providerTeamId: String(userData.id || "unknown"),
    providerTeamName: userData.login || "unknown",
    accessToken: tokenData.access_token,
    scopes: tokenData.scope,
    connectedBy: userData.login,
  });
}

// --- Slack OAuth ---

export function getSlackAuthUrl(tenantId: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("SLACK_CLIENT_ID not configured");

  const state = Buffer.from(JSON.stringify({ tenantId, ts: Date.now() })).toString("base64url");
  const scopes = "channels:history,channels:read,chat:write,commands,groups:history,groups:read,im:history,im:read,im:write,app_mentions:read,users:read";
  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&state=${state}`;
}

export async function handleSlackCallback(code: string, state: string): Promise<Integration> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Slack OAuth not configured");

  const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
  const tenantId = parsed.tenantId || "default";

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenData = await tokenRes.json() as {
    ok?: boolean;
    access_token?: string;
    team?: { id?: string; name?: string };
    scope?: string;
    authed_user?: { id?: string };
    error?: string;
  };

  if (!tokenData.ok || !tokenData.access_token) throw new Error(tokenData.error || "Slack OAuth failed");

  return saveIntegration({
    tenantId,
    provider: "slack",
    providerTeamId: tokenData.team?.id || "unknown",
    providerTeamName: tokenData.team?.name || "unknown",
    accessToken: tokenData.access_token,
    scopes: tokenData.scope,
    connectedBy: tokenData.authed_user?.id,
    extra: { team_id: tokenData.team?.id, team_name: tokenData.team?.name },
  });
}
