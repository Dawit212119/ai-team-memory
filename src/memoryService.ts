import { fetchPullRequests, fetchPrCommits, fetchPrFiles, fetchIssues } from "./github";
import { extractMemoryFields, embedText, synthesizeMemories, multiHopReason } from "./llm";
import {
  upsertRawPr,
  upsertMemoryObject,
  getMemoryObjectById as repoGetMemoryById,
  getAllMemoryObjectsForSearch,
  keywordSearch,
  upsertIssue,
  upsertIssuePrLink,
  getLinkedIssuesForPr as repoGetLinkedIssues,
  getMemoriesByService,
  getIssuesByService,
  getTimelineForService,
  getTemporallyRelatedPrs,
  upsertEntityAlias,
  resolveEntity,
  getAllAliasesForEntity,
  getAllEntities as repoGetAllEntities,
} from "./repository";
import type {
  NormalizedMemory,
  SearchResultItem,
  ConfidenceScore,
  SearchResponse,
  SyncResult,
  TimelineResponse,
  MemoryObjectRow,
  EvaluationBenchmark,
  EvaluationResult,
  GitHubPr,
  GitHubCommit,
  GitHubFile,
} from "./types";

function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return -1;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildExtractionInput(pr: GitHubPr, commits: GitHubCommit[], files: GitHubFile[]): string {
  const commitSummaries = commits
    .map((commit) => `- ${commit.commit?.message || ""}`)
    .join("\n");
  const filePaths = files
    .map((f) => f.filename)
    .filter(Boolean)
    .join("\n");
  return [
    `PR Title: ${pr.title || ""}`,
    `PR Description: ${pr.body || ""}`,
    "Commits:",
    commitSummaries || "- (none)",
    "Changed Files:",
    filePaths || "(none)",
  ].join("\n\n");
}

export function normalizeMemoryObject(row: MemoryObjectRow): NormalizedMemory {
  const prNumber = row.pr_number || parsePrNumber(row.id);
  return {
    id: row.id,
    repo: row.repo,
    pr_number: prNumber,
    pr_title: row.pr_title,
    problem: row.problem,
    root_cause: row.root_cause || null,
    fix: row.fix,
    reasoning: row.reasoning,
    risk_area: row.risk_area || null,
    services_affected: row.services_affected || [],
    summary: row.summary || null,
    files_changed: row.files_changed || [],
    author: row.author,
    created_at: row.created_at,
  };
}

function parsePrNumber(memoryId: string): number | null {
  const match = memoryId && memoryId.match(/#(\d+)$/);
  return match ? Number(match[1]) : null;
}

function buildPrUrl(repo: string, prNumber: number | null): string | null {
  if (!repo || !prNumber) return null;
  return `https://github.com/${repo}/pull/${prNumber}`;
}

function addCitations(normalized: NormalizedMemory & { score: number; vector_score: number; keyword_score: number }): SearchResultItem {
  return {
    ...normalized,
    sources: [
      {
        pr_number: normalized.pr_number,
        url: buildPrUrl(normalized.repo, normalized.pr_number),
        files_changed: normalized.files_changed,
      },
    ],
  };
}

function computeConfidence(results: { finalScore: number; memory: NormalizedMemory }[]): ConfidenceScore {
  if (results.length === 0) return { answer_confidence: 0, evidence_count: 0, source_consistency: 0 };

  const THRESHOLD = 0.15;
  const evidenceCount = results.filter((r) => r.finalScore > THRESHOLD).length;
  const topScore = results[0].finalScore;
  const scoreGap = results.length > 1 ? results[0].finalScore - results[1].finalScore : results[0].finalScore;
  const answerConfidence = Math.min(
    1,
    topScore * 0.6 + Math.min(scoreGap, 0.3) * 0.4 + Math.min(evidenceCount / 10, 0.3) * 0.3
  );

  const riskAreas = results
    .slice(0, 5)
    .map((r) => r.memory.risk_area)
    .filter(Boolean);
  const uniqueRisks = new Set(riskAreas);
  const sourceConsistency =
    riskAreas.length > 0 ? 1 - (uniqueRisks.size - 1) / Math.max(riskAreas.length, 1) : 0;

  return {
    answer_confidence: Math.round(answerConfidence * 100) / 100,
    evidence_count: evidenceCount,
    source_consistency: Math.round(sourceConsistency * 100) / 100,
  };
}

const ENTITY_ALIASES: Record<string, string[]> = {
  auth: ["auth-service", "authentication", "auth", "login-api", "login", "signin", "sign-in"],
  router: ["router", "routing", "app-router", "pages-router", "next-router"],
  turbopack: ["turbopack", "turbo", "turbo-pack", "bundler"],
  testing: ["testing", "tests", "test", "jest", "playwright", "e2e"],
  cache: ["cache", "caching", "lru", "response-cache", "segment-cache"],
  image: ["image", "next/image", "image-optimizer", "next-image"],
  middleware: ["middleware", "edge-middleware", "routing-middleware"],
  devtools: ["devtools", "dev-tools", "developer-tools"],
  build: ["build", "webpack", "compilation", "bundling"],
  rendering: ["rendering", "ssr", "rsc", "server-components", "react-server-components"],
};

export async function initDefaultEntities(): Promise<void> {
  for (const [canonical, aliases] of Object.entries(ENTITY_ALIASES)) {
    for (const alias of aliases) {
      await upsertEntityAlias(canonical, alias.toLowerCase(), "service");
    }
  }
}

async function resolveServiceName(name: string): Promise<string> {
  return resolveEntity(name.toLowerCase());
}

async function getExpandedServiceNames(name: string): Promise<string[]> {
  const canonical = await resolveServiceName(name);
  const aliases = await getAllAliasesForEntity(canonical);
  return aliases.length > 0 ? [canonical, ...aliases] : [name];
}

const CLOSING_KEYWORDS_RE = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

function parseClosingKeywords(text: string): number[] {
  if (!text) return [];
  const issues: number[] = [];
  let match;
  while ((match = CLOSING_KEYWORDS_RE.exec(text)) !== null) {
    issues.push(Number(match[1]));
  }
  CLOSING_KEYWORDS_RE.lastIndex = 0;
  return [...new Set(issues)];
}

export async function syncRepository(repo: string, limit = 20): Promise<SyncResult> {
  const prs = await fetchPullRequests(repo, limit);
  const results: string[] = [];
  const errors: { pr_number: number; error: string }[] = [];

  for (const pr of prs) {
    try {
      const [commits, files] = await Promise.all([
        fetchPrCommits(repo, pr.number),
        fetchPrFiles(repo, pr.number),
      ]);

      const rawPrId = await upsertRawPr({
        repo,
        prNumber: pr.number,
        prTitle: pr.title || "",
        prBody: pr.body || "",
        prJson: pr as unknown as Record<string, unknown>,
        commitsJson: commits as unknown as Record<string, unknown>[],
        filesJson: files as unknown as Record<string, unknown>[],
        author: pr.user?.login || "unknown",
        createdAt: pr.created_at,
      });

      const extracted = await extractMemoryFields(buildExtractionInput(pr, commits, files));
      const filesChanged = files.map((f) => f.filename).filter(Boolean);
      const memoryId = `${repo}#${pr.number}`;
      const embeddingInput = [
        pr.title || "",
        extracted.problem || "",
        extracted.root_cause || "",
        extracted.reasoning || "",
        extracted.summary || "",
        ...(extracted.services_affected || []),
      ].join("\n");
      const embedding = await embedText(embeddingInput);

      await upsertMemoryObject({
        id: memoryId,
        rawPrId,
        repo,
        prNumber: pr.number,
        prTitle: pr.title || "",
        problem: extracted.problem || "",
        rootCause: extracted.root_cause || null,
        fix: extracted.fix || "",
        reasoning: extracted.reasoning || "",
        riskArea: extracted.risk_area || null,
        servicesAffected: extracted.services_affected || [],
        summary: extracted.summary || null,
        filesChanged,
        author: pr.user?.login || "unknown",
        createdAt: pr.created_at,
        embedding,
      });

      const linkedIssueNumbers = parseClosingKeywords(pr.body || "");
      for (const commitObj of commits) {
        for (const num of parseClosingKeywords(commitObj.commit?.message || "")) {
          linkedIssueNumbers.push(num);
        }
      }
      for (const issueNum of [...new Set(linkedIssueNumbers)]) {
        await upsertIssuePrLink({
          repo,
          issueNumber: issueNum,
          prNumber: pr.number,
          linkType: "closes",
        });
      }
      results.push(memoryId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to process PR #${pr.number}: ${message}`);
      errors.push({ pr_number: pr.number, error: message });
    }
  }

  try {
    const issues = await fetchIssues(repo, Math.min(limit, 30));
    for (const issue of issues) {
      await upsertIssue({
        repo,
        issueNumber: issue.number,
        title: issue.title || "",
        body: issue.body || "",
        state: issue.state,
        author: issue.user?.login || "unknown",
        labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
        createdAt: issue.created_at,
      });
    }
  } catch (_) {
    // Issues ingestion is best-effort
  }

  return {
    repo,
    synced_prs: results.length,
    memory_ids: results,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function searchMemories(query: string): Promise<SearchResponse> {
  const [queryEmbedding, allRows, kwRows] = await Promise.all([
    embedText(query),
    getAllMemoryObjectsForSearch(),
    keywordSearch(query),
  ]);

  const kwScoreMap = new Map<string, number>();
  if (kwRows.length > 0) {
    const maxKwRank = Math.max(...kwRows.map((r) => r.keyword_rank));
    for (const row of kwRows) {
      kwScoreMap.set(row.id, maxKwRank > 0 ? row.keyword_rank / maxKwRank : 0);
    }
  }

  const scored = allRows.map((row) => {
    const vectorScore = cosineSimilarity(queryEmbedding, row.embedding);
    const keywordScore = kwScoreMap.get(row.id) || 0;
    const finalScore = vectorScore * 0.7 + keywordScore * 0.3;
    return { vectorScore, keywordScore, finalScore, memory: normalizeMemoryObject(row) };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const confidence = computeConfidence(scored);

  const results = scored.slice(0, 5).map((item) =>
    addCitations({
      ...item.memory,
      score: item.finalScore,
      vector_score: item.vectorScore,
      keyword_score: item.keywordScore,
    })
  );

  return { results, confidence };
}

export async function getTimeline(serviceName: string): Promise<TimelineResponse> {
  const canonical = await resolveServiceName(serviceName);
  const names = await getExpandedServiceNames(serviceName);

  let allMemories: MemoryObjectRow[] = [];
  for (const name of names) {
    const mems = await getTimelineForService(name);
    allMemories.push(...mems);
  }

  const seen = new Set<string>();
  allMemories = allMemories.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  allMemories.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const periods: Record<string, MemoryObjectRow[]> = {};
  for (const m of allMemories) {
    const month = new Date(m.created_at).toISOString().slice(0, 7);
    if (!periods[month]) periods[month] = [];
    periods[month].push(m);
  }

  const contributorTimeline: Record<string, Set<string>> = {};
  for (const m of allMemories) {
    const month = new Date(m.created_at).toISOString().slice(0, 7);
    if (!contributorTimeline[month]) contributorTimeline[month] = new Set();
    contributorTimeline[month].add(m.author);
  }

  const riskShifts: { date: string; from: string | null; to: string; pr: string; pr_title: string }[] = [];
  let prevRisk: string | null = null;
  for (const m of allMemories) {
    if (m.risk_area && m.risk_area !== prevRisk) {
      riskShifts.push({
        date: m.created_at,
        from: prevRisk,
        to: m.risk_area,
        pr: m.id,
        pr_title: m.pr_title,
      });
      prevRisk = m.risk_area;
    }
  }

  return {
    service: canonical,
    resolved_from: serviceName,
    total_changes: allMemories.length,
    time_span:
      allMemories.length > 0
        ? { from: allMemories[0].created_at, to: allMemories[allMemories.length - 1].created_at }
        : null,
    timeline: Object.entries(periods).map(([month, mems]) => ({
      month,
      changes: mems.length,
      prs: mems.map((m) => ({
        id: m.id,
        pr_number: m.pr_number || parsePrNumber(m.id),
        pr_title: m.pr_title,
        summary: m.summary,
        risk_area: m.risk_area,
        author: m.author,
        url: buildPrUrl(m.repo, m.pr_number || parsePrNumber(m.id)),
        created_at: m.created_at,
      })),
    })),
    architectural_shifts: riskShifts,
    contributors_over_time: Object.entries(contributorTimeline).map(([month, authors]) => ({
      month,
      contributors: [...authors],
    })),
  };
}

export async function synthesize(query: string) {
  const { results } = await searchMemories(query);
  if (results.length === 0) {
    return {
      query,
      synthesis: null,
      sources: [],
      confidence: { answer_confidence: 0, evidence_count: 0, source_consistency: 0 },
    };
  }

  const synthesis = await synthesizeMemories(query, results);

  return {
    query,
    synthesis,
    sources: results.map((r) => ({
      id: r.id,
      pr_number: r.pr_number,
      pr_title: r.pr_title,
      url: r.sources[0]?.url,
      score: r.score,
    })),
    confidence: {
      answer_confidence:
        Math.round(
          Math.min(1, (results[0].score + (synthesis.recurring_patterns?.length || 0) * 0.05)) * 100
        ) / 100,
      evidence_count: results.length,
      source_consistency:
        results.filter((r) => r.risk_area === results[0].risk_area).length / results.length,
    },
  };
}

export async function multiHopQuery(query: string) {
  const { results } = await searchMemories(query);
  if (results.length === 0) {
    return { query, answer: null, reasoning_chain: [], confidence: 0 };
  }

  const topResult = results[0];
  const [temporalPrs, linkedIssues] = await Promise.all([
    getTemporallyRelatedPrs(topResult.repo, topResult.created_at, 72),
    repoGetLinkedIssues(topResult.repo, topResult.pr_number || 0),
  ]);

  const contextParts = [
    "=== Primary search results ===",
    ...results.map(
      (r) =>
        `PR ${r.id}: "${r.pr_title}" (score=${r.score.toFixed(3)})\n  Problem: ${r.problem}\n  Fix: ${r.fix}\n  Risk: ${r.risk_area}`
    ),
    "",
    "=== Temporally related PRs (within 72h of top result) ===",
    ...temporalPrs.map(
      (p) =>
        `PR ${p.id}: "${p.pr_title}" by ${p.author} at ${p.created_at}\n  Problem: ${p.problem}\n  Fix: ${p.fix}`
    ),
  ];

  if (linkedIssues.length > 0) {
    contextParts.push("", "=== Linked issues ===");
    for (const iss of linkedIssues) {
      contextParts.push(
        `Issue #${iss.issue_number}: "${iss.title}" [${iss.state}] (${iss.link_type})`
      );
    }
  }

  const authorOverlap: Record<string, number> = {};
  for (const p of temporalPrs) {
    authorOverlap[p.author] = (authorOverlap[p.author] || 0) + 1;
  }
  const frequentAuthors = Object.entries(authorOverlap)
    .filter(([, c]) => c > 1)
    .map(([a]) => a);
  if (frequentAuthors.length > 0) {
    contextParts.push("", `=== Contributor overlap: ${frequentAuthors.join(", ")} ===`);
  }

  const reasoning = await multiHopReason(query, contextParts.join("\n"));

  return {
    query,
    answer: reasoning.answer,
    reasoning_chain: reasoning.reasoning_chain,
    contributing_factors: reasoning.contributing_factors,
    confidence: reasoning.confidence,
    evidence: {
      search_results: results.length,
      temporal_prs: temporalPrs.length,
      linked_issues: linkedIssues.length,
      contributor_overlap: frequentAuthors,
    },
    sources: results.map((r) => ({
      id: r.id,
      pr_number: r.pr_number,
      url: r.sources[0]?.url,
      score: r.score,
    })),
  };
}

export async function explainService(serviceName: string) {
  const canonical = await resolveServiceName(serviceName);
  const names = await getExpandedServiceNames(serviceName);

  let memories: MemoryObjectRow[] = [];
  let issues: Record<string, unknown>[] = [];
  for (const name of names) {
    memories.push(...(await getMemoriesByService(name)));
    issues.push(...(await getIssuesByService(name)));
  }

  const seenM = new Set<string>();
  memories = memories.filter((m) => {
    if (seenM.has(m.id)) return false;
    seenM.add(m.id);
    return true;
  });
  const seenI = new Set<string>();
  issues = issues.filter((i) => {
    const k = `${i.repo}#${i.issue_number}`;
    if (seenI.has(k)) return false;
    seenI.add(k);
    return true;
  });

  memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const contributors = [...new Set(memories.map((m) => m.author))];
  const riskAreas: Record<string, number> = {};
  for (const m of memories) {
    if (m.risk_area) riskAreas[m.risk_area] = (riskAreas[m.risk_area] || 0) + 1;
  }

  return {
    service: canonical,
    resolved_from: serviceName,
    total_prs: memories.length,
    total_issues: issues.length,
    contributors,
    risk_areas: Object.entries(riskAreas)
      .sort((a, b) => b[1] - a[1])
      .map(([area, count]) => ({ area, count })),
    major_prs: memories.slice(0, 10).map((m) => ({
      id: m.id,
      pr_number: m.pr_number || parsePrNumber(m.id),
      pr_title: m.pr_title,
      summary: m.summary,
      risk_area: m.risk_area,
      url: buildPrUrl(m.repo, m.pr_number || parsePrNumber(m.id)),
      created_at: m.created_at,
    })),
    recent_changes: memories.slice(0, 5).map((m) => ({
      pr_title: m.pr_title,
      summary: m.summary,
      files_changed: m.files_changed,
      created_at: m.created_at,
    })),
    related_issues: issues.slice(0, 10).map((i) => ({
      issue_number: i.issue_number,
      title: i.title,
      state: i.state,
      url: `https://github.com/${i.repo}/issues/${i.issue_number}`,
    })),
  };
}

export async function runEvaluation(benchmarks: EvaluationBenchmark[]): Promise<EvaluationResult> {
  let top1 = 0;
  let top3 = 0;
  let totalScore = 0;
  const details: EvaluationResult["details"] = [];

  for (const bench of benchmarks) {
    const { results } = await searchMemories(bench.question);
    const returnedIds = results.map((r) => r.id);
    const top1Match = returnedIds[0] === bench.expected_pr;
    const top3Match = returnedIds.slice(0, 3).includes(bench.expected_pr);
    const topScore = results[0]?.score || 0;
    if (top1Match) top1++;
    if (top3Match) top3++;
    totalScore += topScore;
    details.push({
      question: bench.question,
      expected_pr: bench.expected_pr,
      returned_prs: returnedIds.slice(0, 3),
      top1_correct: top1Match,
      top3_correct: top3Match,
      top_score: topScore,
    });
  }

  return {
    total_questions: benchmarks.length,
    top1_accuracy: benchmarks.length > 0 ? top1 / benchmarks.length : 0,
    top3_accuracy: benchmarks.length > 0 ? top3 / benchmarks.length : 0,
    average_score: benchmarks.length > 0 ? totalScore / benchmarks.length : 0,
    details,
  };
}

export {
  repoGetMemoryById as getMemoryObjectById,
  repoGetLinkedIssues as getLinkedIssuesForPr,
  repoGetAllEntities as getAllEntities,
  upsertEntityAlias,
};
