import { pool } from "./db";
import type {
  RawPrInput,
  MemoryObjectInput,
  MemoryObjectRow,
  KeywordSearchRow,
  IssueInput,
  IssuePrLinkInput,
  LinkedIssue,
  LinkedPr,
  EntityAlias,
} from "./types";

function toJsonbParam(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" && (!Number.isFinite(v) || Number.isNaN(v))) return null;
    return v;
  });
}

export async function upsertRawPr(input: RawPrInput): Promise<number> {
  const result = await pool.query(
    `
    INSERT INTO raw_prs (
      repo, pr_number, pr_title, pr_body, pr_json, commits_json, files_json, author, created_at
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
    ON CONFLICT (repo, pr_number) DO UPDATE
    SET
      pr_title = EXCLUDED.pr_title,
      pr_body = EXCLUDED.pr_body,
      pr_json = EXCLUDED.pr_json,
      commits_json = EXCLUDED.commits_json,
      files_json = EXCLUDED.files_json,
      author = EXCLUDED.author,
      created_at = EXCLUDED.created_at,
      fetched_at = NOW()
    RETURNING id;
    `,
    [
      input.repo,
      input.prNumber,
      input.prTitle,
      input.prBody,
      toJsonbParam(input.prJson),
      toJsonbParam(input.commitsJson),
      toJsonbParam(input.filesJson),
      input.author,
      input.createdAt,
    ]
  );
  return result.rows[0].id;
}

export async function upsertMemoryObject(memory: MemoryObjectInput): Promise<void> {
  const searchText = [
    memory.prTitle,
    memory.problem,
    memory.rootCause,
    memory.fix,
    memory.reasoning,
    memory.summary,
    memory.riskArea,
    ...(memory.servicesAffected || []),
    ...(memory.filesChanged || []),
  ]
    .filter(Boolean)
    .join(" ");

  await pool.query(
    `
    INSERT INTO memory_objects (
      id, raw_pr_id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
      risk_area, services_affected, summary, files_changed, author, created_at,
      embedding, search_vector, updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16::jsonb,
      to_tsvector('english', $17), NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      raw_pr_id = EXCLUDED.raw_pr_id,
      pr_number = EXCLUDED.pr_number,
      pr_title = EXCLUDED.pr_title,
      problem = EXCLUDED.problem,
      root_cause = EXCLUDED.root_cause,
      fix = EXCLUDED.fix,
      reasoning = EXCLUDED.reasoning,
      risk_area = EXCLUDED.risk_area,
      services_affected = EXCLUDED.services_affected,
      summary = EXCLUDED.summary,
      files_changed = EXCLUDED.files_changed,
      author = EXCLUDED.author,
      created_at = EXCLUDED.created_at,
      embedding = EXCLUDED.embedding,
      search_vector = EXCLUDED.search_vector,
      updated_at = NOW();
    `,
    [
      memory.id,
      memory.rawPrId,
      memory.repo,
      memory.prNumber,
      memory.prTitle,
      memory.problem,
      memory.rootCause || null,
      memory.fix,
      memory.reasoning,
      memory.riskArea || null,
      toJsonbParam(memory.servicesAffected || []),
      memory.summary || null,
      toJsonbParam(memory.filesChanged),
      memory.author,
      memory.createdAt,
      toJsonbParam(memory.embedding),
      searchText,
    ]
  );
}

export async function getMemoryObjectById(id: string): Promise<MemoryObjectRow | null> {
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at
    FROM memory_objects
    WHERE id = $1;
    `,
    [id]
  );
  return result.rows[0] || null;
}

export async function getAllMemoryObjectsForSearch(): Promise<(MemoryObjectRow & { embedding: number[] })[]> {
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at, embedding
    FROM memory_objects;
    `
  );
  return result.rows;
}

export async function keywordSearch(query: string): Promise<KeywordSearchRow[]> {
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS keyword_rank
    FROM memory_objects
    WHERE search_vector @@ plainto_tsquery('english', $1)
    ORDER BY keyword_rank DESC
    LIMIT 20;
    `,
    [query]
  );
  return result.rows;
}

export async function upsertIssue(input: IssueInput): Promise<void> {
  await pool.query(
    `
    INSERT INTO issues (repo, issue_number, title, body, state, author, labels, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    ON CONFLICT (repo, issue_number) DO UPDATE
    SET title=EXCLUDED.title, body=EXCLUDED.body, state=EXCLUDED.state,
        author=EXCLUDED.author, labels=EXCLUDED.labels, fetched_at=NOW();
    `,
    [
      input.repo,
      input.issueNumber,
      input.title,
      input.body || null,
      input.state,
      input.author,
      toJsonbParam(input.labels || []),
      input.createdAt,
    ]
  );
}

export async function upsertIssuePrLink(input: IssuePrLinkInput): Promise<void> {
  await pool.query(
    `
    INSERT INTO issue_pr_links (repo, issue_number, pr_number, link_type)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (repo, issue_number, pr_number) DO UPDATE
    SET link_type=EXCLUDED.link_type;
    `,
    [input.repo, input.issueNumber, input.prNumber, input.linkType]
  );
}

export async function getLinkedIssuesForPr(repo: string, prNumber: number): Promise<LinkedIssue[]> {
  const result = await pool.query(
    `
    SELECT i.issue_number, i.title, i.state, i.labels, l.link_type
    FROM issue_pr_links l
    JOIN issues i ON i.repo = l.repo AND i.issue_number = l.issue_number
    WHERE l.repo = $1 AND l.pr_number = $2;
    `,
    [repo, prNumber]
  );
  return result.rows;
}

export async function getLinkedPrsForIssue(repo: string, issueNumber: number): Promise<LinkedPr[]> {
  const result = await pool.query(
    `
    SELECT m.id, m.pr_number, m.pr_title, m.problem, m.fix, m.reasoning, m.summary
    FROM issue_pr_links l
    JOIN memory_objects m ON m.repo = l.repo AND m.pr_number = l.pr_number
    WHERE l.repo = $1 AND l.issue_number = $2;
    `,
    [repo, issueNumber]
  );
  return result.rows;
}

export async function getMemoriesByService(serviceName: string): Promise<MemoryObjectRow[]> {
  const pattern = `%${serviceName}%`;
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at
    FROM memory_objects
    WHERE
      services_affected::text ILIKE $1
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(files_changed) f
        WHERE f ILIKE $1
      )
      OR problem ILIKE $1
      OR fix ILIKE $1
      OR summary ILIKE $1
    ORDER BY created_at DESC;
    `,
    [pattern]
  );
  return result.rows;
}

export async function getIssuesByService(serviceName: string): Promise<Record<string, unknown>[]> {
  const pattern = `%${serviceName}%`;
  const result = await pool.query(
    `
    SELECT issue_number, repo, title, body, state, author, labels, created_at
    FROM issues
    WHERE title ILIKE $1 OR body ILIKE $1
    ORDER BY created_at DESC
    LIMIT 20;
    `,
    [pattern]
  );
  return result.rows;
}

export async function getTimelineForService(serviceName: string): Promise<MemoryObjectRow[]> {
  const pattern = `%${serviceName}%`;
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at
    FROM memory_objects
    WHERE
      services_affected::text ILIKE $1
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(files_changed) f WHERE f ILIKE $1)
      OR problem ILIKE $1 OR fix ILIKE $1 OR summary ILIKE $1
    ORDER BY created_at ASC;
    `,
    [pattern]
  );
  return result.rows;
}

export async function getRelatedMemories(
  memoryIds: string[]
): Promise<(MemoryObjectRow & { embedding: number[] })[]> {
  if (memoryIds.length === 0) return [];
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, root_cause, fix, reasoning,
           risk_area, services_affected, summary, files_changed, author, created_at, embedding
    FROM memory_objects
    WHERE id = ANY($1);
    `,
    [memoryIds]
  );
  return result.rows;
}

export async function getTemporallyRelatedPrs(
  repo: string,
  createdAt: string,
  windowHours = 72
): Promise<MemoryObjectRow[]> {
  const result = await pool.query(
    `
    SELECT id, repo, pr_number, pr_title, problem, fix, summary, risk_area, author, created_at
    FROM memory_objects
    WHERE repo = $1
      AND created_at BETWEEN ($2::timestamptz - interval '1 hour' * $3)
                         AND ($2::timestamptz + interval '1 hour' * $3)
    ORDER BY created_at ASC;
    `,
    [repo, createdAt, windowHours]
  );
  return result.rows;
}

export async function upsertEntityAlias(
  canonical: string,
  alias: string,
  entityType = "service"
): Promise<void> {
  await pool.query(
    `
    INSERT INTO entity_aliases (canonical, alias, entity_type)
    VALUES ($1, $2, $3)
    ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical;
    `,
    [canonical, alias, entityType]
  );
}

export async function resolveEntity(name: string): Promise<string> {
  const result = await pool.query(
    "SELECT canonical FROM entity_aliases WHERE alias = $1",
    [name.toLowerCase()]
  );
  return result.rows[0]?.canonical || name;
}

export async function getAllAliasesForEntity(canonical: string): Promise<string[]> {
  const result = await pool.query(
    "SELECT alias FROM entity_aliases WHERE canonical = $1",
    [canonical]
  );
  return result.rows.map((r: { alias: string }) => r.alias);
}

export async function getAllEntities(): Promise<EntityAlias[]> {
  const result = await pool.query(
    `
    SELECT canonical, entity_type, array_agg(alias ORDER BY alias) AS aliases
    FROM entity_aliases
    GROUP BY canonical, entity_type
    ORDER BY canonical;
    `
  );
  return result.rows;
}
