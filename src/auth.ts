import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { createApiKey, getApiKeyByHash, listApiKeys, revokeApiKey } from "./repository";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const key = `atm_${raw}`;
  const prefix = key.slice(0, 8);
  const hash = hashKey(key);
  return { key, prefix, hash };
}

export async function registerApiKey(tenantId: string, name: string): Promise<{ id: number; key: string; prefix: string }> {
  const { key, prefix, hash } = generateApiKey();
  const id = await createApiKey(hash, prefix, tenantId, name);
  return { id, key, prefix };
}

export async function getKeys(tenantId: string) {
  return listApiKeys(tenantId);
}

export async function revokeKey(id: number) {
  return revokeApiKey(id);
}

export interface AuthenticatedRequest extends Request {
  tenantId?: string;
  apiKeyScopes?: string[];
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Skip auth if AUTH_REQUIRED is not set (development mode)
  if (process.env.AUTH_REQUIRED !== "true") {
    req.tenantId = "default";
    req.apiKeyScopes = ["read", "write", "admin"];
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <api_key>" });
    return;
  }

  const key = authHeader.slice(7);
  const hash = hashKey(key);

  getApiKeyByHash(hash)
    .then((apiKey) => {
      if (!apiKey) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
      if (apiKey.revoked_at) {
        res.status(401).json({ error: "API key has been revoked" });
        return;
      }
      req.tenantId = apiKey.tenant_id;
      req.apiKeyScopes = apiKey.scopes;
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Authentication error" });
    });
}

export function requireScope(scope: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.apiKeyScopes?.includes(scope) && !req.apiKeyScopes?.includes("admin")) {
      res.status(403).json({ error: `Insufficient scope: requires '${scope}'` });
      return;
    }
    next();
  };
}
