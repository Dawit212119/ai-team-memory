export interface RawPrInput {
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  prJson: Record<string, unknown>;
  commitsJson: Record<string, unknown>[];
  filesJson: Record<string, unknown>[];
  author: string;
  createdAt: string;
}

export interface MemoryObjectInput {
  id: string;
  rawPrId: number;
  repo: string;
  prNumber: number;
  prTitle: string;
  problem: string;
  rootCause: string | null;
  fix: string;
  reasoning: string;
  riskArea: string | null;
  servicesAffected: string[];
  summary: string | null;
  filesChanged: string[];
  author: string;
  createdAt: string;
  embedding: number[];
}

export interface MemoryObjectRow {
  id: string;
  repo: string;
  pr_number: number | null;
  pr_title: string;
  problem: string;
  root_cause: string | null;
  fix: string;
  reasoning: string;
  risk_area: string | null;
  services_affected: string[];
  summary: string | null;
  files_changed: string[];
  author: string;
  created_at: string;
  embedding?: number[];
}

export interface NormalizedMemory {
  id: string;
  repo: string;
  pr_number: number | null;
  pr_title: string;
  problem: string;
  root_cause: string | null;
  fix: string;
  reasoning: string;
  risk_area: string | null;
  services_affected: string[];
  summary: string | null;
  files_changed: string[];
  author: string;
  created_at: string;
}

export interface SearchResultItem extends NormalizedMemory {
  score: number;
  vector_score: number;
  keyword_score: number;
  sources: Citation[];
}

export interface Citation {
  pr_number: number | null;
  url: string | null;
  files_changed: string[];
}

export interface ConfidenceScore {
  answer_confidence: number;
  evidence_count: number;
  source_consistency: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  confidence: ConfidenceScore;
}

export interface ExtractionResult {
  problem: string;
  root_cause: string | null;
  fix: string;
  reasoning: string;
  risk_area: string | null;
  services_affected: string[];
  summary: string | null;
}

export interface SynthesisResult {
  answer: string;
  recurring_patterns: string[];
  key_decisions: string[];
  risk_summary: string;
}

export interface ReasoningStep {
  step: number;
  evidence: string;
  inference: string;
}

export interface MultiHopResult {
  reasoning_chain: ReasoningStep[];
  answer: string;
  confidence: number;
  contributing_factors: string[];
}

export interface TimelinePr {
  id: string;
  pr_number: number | null;
  pr_title: string;
  summary: string | null;
  risk_area: string | null;
  author: string;
  url: string | null;
  created_at: string;
}

export interface TimelinePeriod {
  month: string;
  changes: number;
  prs: TimelinePr[];
}

export interface ArchitecturalShift {
  date: string;
  from: string | null;
  to: string;
  pr: string;
  pr_title: string;
}

export interface TimelineResponse {
  service: string;
  resolved_from: string;
  total_changes: number;
  time_span: { from: string; to: string } | null;
  timeline: TimelinePeriod[];
  architectural_shifts: ArchitecturalShift[];
  contributors_over_time: { month: string; contributors: string[] }[];
}

export interface IssueInput {
  repo: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  author: string;
  labels: string[];
  createdAt: string;
}

export interface IssuePrLinkInput {
  repo: string;
  issueNumber: number;
  prNumber: number;
  linkType: string;
}

export interface LinkedIssue {
  issue_number: number;
  title: string;
  state: string;
  labels: string[];
  link_type: string;
}

export interface LinkedPr {
  id: string;
  pr_number: number;
  pr_title: string;
  problem: string;
  fix: string;
  reasoning: string;
  summary: string | null;
}

export interface EntityAlias {
  canonical: string;
  entity_type: string;
  aliases: string[];
}

export interface KeywordSearchRow extends MemoryObjectRow {
  keyword_rank: number;
}

export interface SyncResult {
  repo: string;
  synced_prs: number;
  memory_ids: string[];
  errors?: { pr_number: number; error: string }[];
}

export interface EvaluationBenchmark {
  question: string;
  expected_pr: string;
}

export interface EvaluationResult {
  total_questions: number;
  top1_accuracy: number;
  top3_accuracy: number;
  average_score: number;
  details: {
    question: string;
    expected_pr: string;
    returned_prs: string[];
    top1_correct: boolean;
    top3_correct: boolean;
    top_score: number;
  }[];
}

export interface GitHubPr {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string } | null;
  created_at: string;
  [key: string]: unknown;
}

export interface GitHubCommit {
  commit: { message: string };
  [key: string]: unknown;
}

export interface GitHubFile {
  filename: string;
  [key: string]: unknown;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string } | null;
  labels: ({ name: string } | string)[];
  created_at: string;
  [key: string]: unknown;
}
