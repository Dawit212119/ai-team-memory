import { pool } from "./db";

export interface AuditEntry {
  id: number;
  tenant_id: string;
  actor: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export async function logAuditEvent(entry: {
  tenantId: string;
  actor: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor, action, resource_type, resource_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.tenantId,
      entry.actor,
      entry.action,
      entry.resourceType || null,
      entry.resourceId || null,
      JSON.stringify(entry.details || {}),
      entry.ipAddress || null,
    ]
  );
}

export async function getAuditLog(
  tenantId: string,
  filters?: { action?: string; actor?: string; limit?: number; offset?: number }
): Promise<{ entries: AuditEntry[]; total: number }> {
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];
  let paramIndex = 2;

  if (filters?.action) {
    conditions.push(`action = $${paramIndex++}`);
    values.push(filters.action);
  }
  if (filters?.actor) {
    conditions.push(`actor = $${paramIndex++}`);
    values.push(filters.actor);
  }

  const where = conditions.join(" AND ");
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM audit_log WHERE ${where}`,
    values
  );

  values.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    values
  );

  return {
    entries: result.rows.map(normalizeAuditEntry),
    total: Number(countResult.rows[0]?.count || 0),
  };
}

function normalizeAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: Number(row.id),
    tenant_id: row.tenant_id as string,
    actor: row.actor as string,
    action: row.action as string,
    resource_type: (row.resource_type as string) || null,
    resource_id: (row.resource_id as string) || null,
    details: (row.details as Record<string, unknown>) || {},
    ip_address: (row.ip_address as string) || null,
    created_at: row.created_at as string,
  };
}
