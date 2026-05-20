import { pool } from "./db";
import { resolveEntity, getAllAliasesForEntity } from "./repository";

export interface OwnershipScore {
  author: string;
  score: number;
  commit_count: number;
  recent_commits: number;
  files_touched: number;
  last_active: string;
}

export interface ServiceOwnership {
  service: string;
  resolved_from: string;
  owners: OwnershipScore[];
  primary_owner: string | null;
  bus_factor: number;
  concentration_warning: string | null;
}

export interface FileOwnership {
  file_path: string;
  owners: { author: string; touch_count: number; last_touched: string }[];
}

export interface BusFactorReport {
  service: string;
  bus_factor: number;
  risk_level: "low" | "medium" | "high" | "critical";
  top_contributors: { author: string; knowledge_share: number }[];
  recommendation: string;
}

async function getExpandedNames(name: string): Promise<string[]> {
  const canonical = await resolveEntity(name.toLowerCase());
  const aliases = await getAllAliasesForEntity(canonical);
  return aliases.length > 0 ? [canonical, ...aliases] : [name];
}

export async function computeServiceOwnership(serviceName: string): Promise<ServiceOwnership> {
  const canonical = await resolveEntity(serviceName.toLowerCase());
  const names = await getExpandedNames(serviceName);

  const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT
       author,
       COUNT(*) as commit_count,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '90 days') as recent_commits,
       MAX(created_at) as last_active
     FROM memory_objects
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(services_affected) AS s
       WHERE LOWER(s) IN (${placeholders})
     )
     GROUP BY author
     ORDER BY COUNT(*) DESC`,
    names.map((n) => n.toLowerCase())
  );

  const authorFileResult = await pool.query(
    `SELECT
       author,
       COUNT(DISTINCT f.value) as files_touched
     FROM memory_objects,
       jsonb_array_elements_text(files_changed) AS f(value)
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(services_affected) AS s
       WHERE LOWER(s) IN (${placeholders})
     )
     GROUP BY author`,
    names.map((n) => n.toLowerCase())
  );

  const fileTouchMap = new Map<string, number>();
  for (const row of authorFileResult.rows) {
    fileTouchMap.set(row.author, Number(row.files_touched));
  }

  const totalCommits = result.rows.reduce((sum: number, r: { commit_count: string }) => sum + Number(r.commit_count), 0);

  const owners: OwnershipScore[] = result.rows.map((row: { author: string; commit_count: string; recent_commits: string; last_active: string }) => {
    const commitCount = Number(row.commit_count);
    const recentCommits = Number(row.recent_commits);
    const filesTouched = fileTouchMap.get(row.author) || 0;

    const recencyWeight = recentCommits / Math.max(commitCount, 1);
    const volumeWeight = totalCommits > 0 ? commitCount / totalCommits : 0;
    const score = Math.round((volumeWeight * 0.4 + recencyWeight * 0.4 + Math.min(filesTouched / 50, 1) * 0.2) * 100) / 100;

    return {
      author: row.author,
      score,
      commit_count: commitCount,
      recent_commits: recentCommits,
      files_touched: filesTouched,
      last_active: row.last_active,
    };
  });

  owners.sort((a, b) => b.score - a.score);

  const busFactor = computeBusFactor(owners);
  const concentrationWarning = getConcentrationWarning(owners, busFactor);

  return {
    service: canonical,
    resolved_from: serviceName,
    owners,
    primary_owner: owners[0]?.author || null,
    bus_factor: busFactor,
    concentration_warning: concentrationWarning,
  };
}

function computeBusFactor(owners: OwnershipScore[]): number {
  if (owners.length === 0) return 0;

  const totalScore = owners.reduce((s, o) => s + o.score, 0);
  if (totalScore === 0) return 0;

  let accumulated = 0;
  let count = 0;
  for (const owner of owners) {
    accumulated += owner.score / totalScore;
    count++;
    if (accumulated >= 0.5) break;
  }
  return count;
}

function getConcentrationWarning(owners: OwnershipScore[], busFactor: number): string | null {
  if (owners.length === 0) return "No contributors found for this service.";
  if (busFactor === 1) {
    const top = owners[0];
    const share = owners.length > 1
      ? Math.round((top.score / owners.reduce((s, o) => s + o.score, 0)) * 100)
      : 100;
    return `Critical: ${top.author} holds ${share}% of knowledge. Bus factor is 1.`;
  }
  if (busFactor === 2 && owners.length > 3) {
    return `Warning: Only 2 people hold most knowledge of this service.`;
  }
  return null;
}

export async function computeBusFactorReport(serviceName: string): Promise<BusFactorReport> {
  const ownership = await computeServiceOwnership(serviceName);
  const totalScore = ownership.owners.reduce((s, o) => s + o.score, 0);

  const riskLevel: BusFactorReport["risk_level"] =
    ownership.bus_factor <= 1
      ? "critical"
      : ownership.bus_factor === 2
        ? "high"
        : ownership.bus_factor <= 3
          ? "medium"
          : "low";

  const topContributors = ownership.owners.slice(0, 5).map((o) => ({
    author: o.author,
    knowledge_share: totalScore > 0 ? Math.round((o.score / totalScore) * 100) / 100 : 0,
  }));

  let recommendation: string;
  switch (riskLevel) {
    case "critical":
      recommendation = `Pair programming and code review rotation urgently needed. Consider onboarding a second contributor to ${ownership.service}.`;
      break;
    case "high":
      recommendation = `Increase review participation from other team members. Document key decisions and architecture for ${ownership.service}.`;
      break;
    case "medium":
      recommendation = `Good knowledge distribution. Continue encouraging cross-team reviews.`;
      break;
    default:
      recommendation = `Healthy knowledge distribution across the team.`;
  }

  return {
    service: ownership.service,
    bus_factor: ownership.bus_factor,
    risk_level: riskLevel,
    top_contributors: topContributors,
    recommendation,
  };
}

export async function computeFileOwnership(repo: string, filePath: string): Promise<FileOwnership> {
  const result = await pool.query(
    `SELECT
       author,
       COUNT(*) as touch_count,
       MAX(created_at) as last_touched
     FROM memory_objects,
       jsonb_array_elements_text(files_changed) AS f(value)
     WHERE repo = $1 AND f.value = $2
     GROUP BY author
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
    [repo, filePath]
  );

  return {
    file_path: filePath,
    owners: result.rows.map((r: { author: string; touch_count: string; last_touched: string }) => ({
      author: r.author,
      touch_count: Number(r.touch_count),
      last_touched: r.last_touched,
    })),
  };
}

export async function getTeamOverview(): Promise<{
  total_contributors: number;
  services_at_risk: { service: string; bus_factor: number; primary_owner: string | null }[];
  most_active: { author: string; total_commits: number; services: string[] }[];
}> {
  const servicesResult = await pool.query(
    `SELECT DISTINCT LOWER(s.value) as service_name
     FROM memory_objects,
       jsonb_array_elements_text(services_affected) AS s(value)
     ORDER BY 1`
  );

  const servicesAtRisk: { service: string; bus_factor: number; primary_owner: string | null }[] = [];
  for (const row of servicesResult.rows) {
    const ownership = await computeServiceOwnership(row.service_name);
    if (ownership.bus_factor <= 2 && ownership.owners.length > 0) {
      servicesAtRisk.push({
        service: ownership.service,
        bus_factor: ownership.bus_factor,
        primary_owner: ownership.primary_owner,
      });
    }
  }

  const activeResult = await pool.query(
    `SELECT
       author,
       COUNT(*) as total_commits,
       ARRAY_AGG(DISTINCT LOWER(s.value)) as services
     FROM memory_objects,
       jsonb_array_elements_text(services_affected) AS s(value)
     GROUP BY author
     ORDER BY COUNT(*) DESC
     LIMIT 10`
  );

  const totalContribs = await pool.query("SELECT COUNT(DISTINCT author) as count FROM memory_objects");

  return {
    total_contributors: Number(totalContribs.rows[0]?.count || 0),
    services_at_risk: servicesAtRisk,
    most_active: activeResult.rows.map((r: { author: string; total_commits: string; services: string[] }) => ({
      author: r.author,
      total_commits: Number(r.total_commits),
      services: r.services,
    })),
  };
}
