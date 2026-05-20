import { pool } from "./db";
import { resolveEntity, getAllAliasesForEntity } from "./repository";

export interface ServiceRelationship {
  source: string;
  target: string;
  strength: number;
  co_change_count: number;
  shared_authors: string[];
}

export interface DependencyGraph {
  services: string[];
  relationships: ServiceRelationship[];
  clusters: { name: string; services: string[] }[];
}

export interface ImpactAnalysis {
  service: string;
  directly_affected: { service: string; strength: number; co_change_count: number }[];
  indirectly_affected: { service: string; path: string[]; risk: number }[];
  total_blast_radius: number;
  risk_level: "low" | "medium" | "high" | "critical";
  recommendation: string;
}

async function getExpandedNames(name: string): Promise<string[]> {
  const canonical = await resolveEntity(name.toLowerCase());
  const aliases = await getAllAliasesForEntity(canonical);
  return aliases.length > 0 ? [canonical, ...aliases] : [name];
}

export async function buildServiceGraph(): Promise<DependencyGraph> {
  const result = await pool.query(`
    SELECT
      LOWER(s1.value) as service_a,
      LOWER(s2.value) as service_b,
      COUNT(DISTINCT m.id) as co_change_count,
      ARRAY_AGG(DISTINCT m.author) as shared_authors
    FROM memory_objects m,
      jsonb_array_elements_text(m.services_affected) AS s1(value),
      jsonb_array_elements_text(m.services_affected) AS s2(value)
    WHERE LOWER(s1.value) < LOWER(s2.value)
    GROUP BY LOWER(s1.value), LOWER(s2.value)
    HAVING COUNT(DISTINCT m.id) >= 2
    ORDER BY COUNT(DISTINCT m.id) DESC
  `);

  const allServices = new Set<string>();
  const relationships: ServiceRelationship[] = [];

  const maxCoChange = result.rows.length > 0
    ? Math.max(...result.rows.map((r: { co_change_count: string }) => Number(r.co_change_count)))
    : 1;

  for (const row of result.rows) {
    const source = (row.service_a as string).toLowerCase();
    const target = (row.service_b as string).toLowerCase();
    const coCount = Number(row.co_change_count);
    allServices.add(source);
    allServices.add(target);
    relationships.push({
      source,
      target,
      strength: Math.round((coCount / maxCoChange) * 100) / 100,
      co_change_count: coCount,
      shared_authors: row.shared_authors || [],
    });
  }

  const clusters = detectClusters(relationships, [...allServices]);

  return {
    services: [...allServices].sort(),
    relationships,
    clusters,
  };
}

function detectClusters(
  relationships: ServiceRelationship[],
  services: string[]
): { name: string; services: string[] }[] {
  const adjacency = new Map<string, Set<string>>();
  for (const s of services) adjacency.set(s, new Set());

  for (const rel of relationships) {
    if (rel.strength >= 0.3) {
      adjacency.get(rel.source)?.add(rel.target);
      adjacency.get(rel.target)?.add(rel.source);
    }
  }

  const visited = new Set<string>();
  const clusters: { name: string; services: string[] }[] = [];

  for (const service of services) {
    if (visited.has(service)) continue;
    const cluster: string[] = [];
    const queue = [service];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (cluster.length > 1) {
      clusters.push({
        name: cluster.sort()[0],
        services: cluster.sort(),
      });
    }
  }

  return clusters;
}

export async function analyzeImpact(serviceName: string): Promise<ImpactAnalysis> {
  const canonical = await resolveEntity(serviceName.toLowerCase());
  const names = await getExpandedNames(serviceName);
  const lowerNames = names.map((n) => n.toLowerCase());

  const graph = await buildServiceGraph();

  const directlyAffected: ImpactAnalysis["directly_affected"] = [];
  for (const rel of graph.relationships) {
    if (lowerNames.includes(rel.source)) {
      directlyAffected.push({ service: rel.target, strength: rel.strength, co_change_count: rel.co_change_count });
    } else if (lowerNames.includes(rel.target)) {
      directlyAffected.push({ service: rel.source, strength: rel.strength, co_change_count: rel.co_change_count });
    }
  }
  directlyAffected.sort((a, b) => b.strength - a.strength);

  const indirectlyAffected: ImpactAnalysis["indirectly_affected"] = [];
  const directServices = new Set(directlyAffected.map((d) => d.service));
  for (const direct of directlyAffected) {
    for (const rel of graph.relationships) {
      let hop: string | null = null;
      if (rel.source === direct.service && !lowerNames.includes(rel.target) && !directServices.has(rel.target)) {
        hop = rel.target;
      } else if (rel.target === direct.service && !lowerNames.includes(rel.source) && !directServices.has(rel.source)) {
        hop = rel.source;
      }
      if (hop && !indirectlyAffected.some((i) => i.service === hop)) {
        indirectlyAffected.push({
          service: hop,
          path: [canonical, direct.service, hop],
          risk: Math.round(direct.strength * rel.strength * 100) / 100,
        });
      }
    }
  }
  indirectlyAffected.sort((a, b) => b.risk - a.risk);

  const totalBlast = directlyAffected.length + indirectlyAffected.length;
  const maxStrength = directlyAffected[0]?.strength || 0;

  let riskLevel: ImpactAnalysis["risk_level"];
  if (totalBlast >= 10 || maxStrength >= 0.8) riskLevel = "critical";
  else if (totalBlast >= 5 || maxStrength >= 0.5) riskLevel = "high";
  else if (totalBlast >= 2) riskLevel = "medium";
  else riskLevel = "low";

  const recommendations: Record<string, string> = {
    critical: `Changes to ${canonical} have cascading impact across ${totalBlast} services. Require thorough integration testing and staged rollout.`,
    high: `Changes to ${canonical} affect ${totalBlast} related services. Cross-team review recommended.`,
    medium: `Changes to ${canonical} have moderate blast radius. Standard review process applies.`,
    low: `Changes to ${canonical} are relatively isolated. Normal development workflow.`,
  };

  return {
    service: canonical,
    directly_affected: directlyAffected.slice(0, 15),
    indirectly_affected: indirectlyAffected.slice(0, 15),
    total_blast_radius: totalBlast,
    risk_level: riskLevel,
    recommendation: recommendations[riskLevel],
  };
}

export async function getFileCoChanges(repo: string, filePath: string): Promise<{
  file: string;
  frequently_changed_with: { file: string; co_change_count: number }[];
}> {
  const result = await pool.query(
    `SELECT f2.value as related_file, COUNT(*) as co_count
     FROM memory_objects m,
       jsonb_array_elements_text(m.files_changed) AS f1(value),
       jsonb_array_elements_text(m.files_changed) AS f2(value)
     WHERE m.repo = $1 AND f1.value = $2 AND f2.value != $2
     GROUP BY f2.value
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 20`,
    [repo, filePath]
  );

  return {
    file: filePath,
    frequently_changed_with: result.rows.map((r: { related_file: string; co_count: string }) => ({
      file: r.related_file,
      co_change_count: Number(r.co_count),
    })),
  };
}
