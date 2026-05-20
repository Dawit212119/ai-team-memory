import { pool } from "./db";

export interface IncidentInput {
  externalId?: string;
  repo?: string;
  title: string;
  description?: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  status?: string;
  source?: string;
  triggeredAt: string;
  resolvedAt?: string;
  servicesAffected?: string[];
}

export interface Incident {
  id: number;
  external_id: string | null;
  repo: string | null;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  source: string;
  triggered_at: string;
  resolved_at: string | null;
  services_affected: string[];
  related_prs: string[];
  postmortem: string | null;
}

export interface DeployImpactResult {
  query: string;
  time_window: { from: string; to: string };
  prs_in_window: {
    id: string;
    pr_title: string;
    author: string;
    services_affected: string[];
    risk_area: string | null;
    created_at: string;
  }[];
  incidents_after: Incident[];
  likely_causes: {
    pr_id: string;
    pr_title: string;
    overlap_services: string[];
    risk_area: string | null;
  }[];
}

export async function createIncident(input: IncidentInput): Promise<Incident> {
  const result = await pool.query(
    `INSERT INTO incidents (external_id, repo, title, description, severity, status, source, triggered_at, resolved_at, services_affected)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (external_id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       severity = EXCLUDED.severity,
       status = EXCLUDED.status,
       resolved_at = EXCLUDED.resolved_at,
       services_affected = EXCLUDED.services_affected,
       updated_at = NOW()
     RETURNING *`,
    [
      input.externalId || null,
      input.repo || null,
      input.title,
      input.description || null,
      input.severity,
      input.status || "open",
      input.source || "manual",
      input.triggeredAt,
      input.resolvedAt || null,
      JSON.stringify(input.servicesAffected || []),
    ]
  );
  return normalizeIncident(result.rows[0]);
}

export async function updateIncident(id: number, updates: Partial<IncidentInput> & { postmortem?: string; relatedPrs?: string[] }): Promise<Incident | null> {
  const setClauses: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) { setClauses.push(`title = $${paramIndex++}`); values.push(updates.title); }
  if (updates.description !== undefined) { setClauses.push(`description = $${paramIndex++}`); values.push(updates.description); }
  if (updates.severity !== undefined) { setClauses.push(`severity = $${paramIndex++}`); values.push(updates.severity); }
  if (updates.status !== undefined) { setClauses.push(`status = $${paramIndex++}`); values.push(updates.status); }
  if (updates.resolvedAt !== undefined) { setClauses.push(`resolved_at = $${paramIndex++}`); values.push(updates.resolvedAt); }
  if (updates.servicesAffected !== undefined) { setClauses.push(`services_affected = $${paramIndex++}`); values.push(JSON.stringify(updates.servicesAffected)); }
  if (updates.postmortem !== undefined) { setClauses.push(`postmortem = $${paramIndex++}`); values.push(updates.postmortem); }
  if (updates.relatedPrs !== undefined) { setClauses.push(`related_prs = $${paramIndex++}`); values.push(JSON.stringify(updates.relatedPrs)); }

  if (setClauses.length === 1) return getIncidentById(id);

  values.push(id);
  const result = await pool.query(
    `UPDATE incidents SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0] ? normalizeIncident(result.rows[0]) : null;
}

export async function getIncidentById(id: number): Promise<Incident | null> {
  const result = await pool.query("SELECT * FROM incidents WHERE id = $1", [id]);
  return result.rows[0] ? normalizeIncident(result.rows[0]) : null;
}

export async function listIncidents(filters?: {
  status?: string;
  severity?: string;
  service?: string;
  limit?: number;
}): Promise<Incident[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(filters.status);
  }
  if (filters?.severity) {
    conditions.push(`severity = $${paramIndex++}`);
    values.push(filters.severity);
  }
  if (filters?.service) {
    conditions.push(`services_affected @> $${paramIndex++}::jsonb`);
    values.push(JSON.stringify([filters.service]));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit || 50;
  values.push(limit);

  const result = await pool.query(
    `SELECT * FROM incidents ${where} ORDER BY triggered_at DESC LIMIT $${paramIndex}`,
    values
  );
  return result.rows.map(normalizeIncident);
}

export async function whatBrokeAfterDeploy(
  timeRef: string,
  hoursWindow = 24
): Promise<DeployImpactResult> {
  const refDate = new Date(timeRef);
  const windowStart = new Date(refDate.getTime() - hoursWindow * 60 * 60 * 1000);
  const windowEnd = new Date(refDate.getTime() + hoursWindow * 60 * 60 * 1000);

  const prsResult = await pool.query(
    `SELECT id, pr_title, author, services_affected, risk_area, created_at
     FROM memory_objects
     WHERE created_at BETWEEN $1 AND $2
     ORDER BY created_at DESC`,
    [windowStart.toISOString(), refDate.toISOString()]
  );

  const incidentsResult = await pool.query(
    `SELECT * FROM incidents
     WHERE triggered_at BETWEEN $1 AND $2
     ORDER BY triggered_at ASC`,
    [refDate.toISOString(), windowEnd.toISOString()]
  );

  const prs = prsResult.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    pr_title: r.pr_title as string,
    author: r.author as string,
    services_affected: (r.services_affected as string[]) || [],
    risk_area: (r.risk_area as string) || null,
    created_at: r.created_at as string,
  }));

  const incidents = incidentsResult.rows.map(normalizeIncident);

  const likelyCauses: DeployImpactResult["likely_causes"] = [];
  for (const incident of incidents) {
    for (const pr of prs) {
      const overlap = pr.services_affected.filter((s: string) =>
        incident.services_affected.some((is) => is.toLowerCase() === s.toLowerCase())
      );
      if (overlap.length > 0) {
        likelyCauses.push({
          pr_id: pr.id,
          pr_title: pr.pr_title,
          overlap_services: overlap,
          risk_area: pr.risk_area,
        });
      }
    }
  }

  return {
    query: `What broke after ${timeRef}?`,
    time_window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
    prs_in_window: prs,
    incidents_after: incidents,
    likely_causes: likelyCauses,
  };
}

export async function getIncidentStats(): Promise<{
  total: number;
  open: number;
  resolved: number;
  by_severity: Record<string, number>;
  by_service: { service: string; count: number }[];
  mttr_hours: number | null;
}> {
  const totalResult = await pool.query("SELECT COUNT(*) as count FROM incidents");
  const openResult = await pool.query("SELECT COUNT(*) as count FROM incidents WHERE status = 'open'");
  const resolvedResult = await pool.query("SELECT COUNT(*) as count FROM incidents WHERE status = 'resolved'");

  const severityResult = await pool.query(
    "SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity"
  );
  const bySeverity: Record<string, number> = {};
  for (const row of severityResult.rows) {
    bySeverity[row.severity] = Number(row.count);
  }

  const serviceResult = await pool.query(
    `SELECT s.value as service, COUNT(*) as count
     FROM incidents, jsonb_array_elements_text(services_affected) AS s(value)
     GROUP BY s.value
     ORDER BY COUNT(*) DESC
     LIMIT 10`
  );

  const mttrResult = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - triggered_at)) / 3600) as avg_hours
     FROM incidents
     WHERE resolved_at IS NOT NULL`
  );

  return {
    total: Number(totalResult.rows[0]?.count || 0),
    open: Number(openResult.rows[0]?.count || 0),
    resolved: Number(resolvedResult.rows[0]?.count || 0),
    by_severity: bySeverity,
    by_service: serviceResult.rows.map((r: { service: string; count: string }) => ({
      service: r.service,
      count: Number(r.count),
    })),
    mttr_hours: mttrResult.rows[0]?.avg_hours ? Math.round(Number(mttrResult.rows[0].avg_hours) * 10) / 10 : null,
  };
}

function normalizeIncident(row: Record<string, unknown>): Incident {
  return {
    id: Number(row.id),
    external_id: (row.external_id as string) || null,
    repo: (row.repo as string) || null,
    title: row.title as string,
    description: (row.description as string) || null,
    severity: row.severity as string,
    status: row.status as string,
    source: row.source as string,
    triggered_at: row.triggered_at as string,
    resolved_at: (row.resolved_at as string) || null,
    services_affected: (row.services_affected as string[]) || [],
    related_prs: (row.related_prs as string[]) || [],
    postmortem: (row.postmortem as string) || null,
  };
}
