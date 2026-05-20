const API_BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

export interface SearchResult {
  id: string;
  repo: string;
  pr_number: number | null;
  pr_title: string;
  problem: string;
  fix: string;
  reasoning: string;
  risk_area: string | null;
  services_affected: string[];
  summary: string | null;
  score: number;
  sources: { pr_number: number | null; url: string | null; files_changed: string[] }[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  confidence: { answer_confidence: number; evidence_count: number; source_consistency: number };
}

export interface OwnershipResponse {
  service: string;
  resolved_from: string;
  owners: {
    author: string;
    score: number;
    commit_count: number;
    recent_commits: number;
    files_touched: number;
    last_active: string;
  }[];
  primary_owner: string | null;
  bus_factor: number;
  concentration_warning: string | null;
}

export interface TeamOverview {
  total_contributors: number;
  services_at_risk: { service: string; bus_factor: number; primary_owner: string | null }[];
  most_active: { author: string; total_commits: number; services: string[] }[];
}

export interface TimelineResponse {
  service: string;
  total_changes: number;
  time_span: { from: string; to: string } | null;
  timeline: {
    month: string;
    changes: number;
    prs: { id: string; pr_title: string; summary: string | null; author: string; url: string | null; created_at: string }[];
  }[];
  architectural_shifts: { date: string; from: string | null; to: string; pr_title: string }[];
}

export interface ServiceExplanation {
  service: string;
  total_prs: number;
  total_issues: number;
  contributors: string[];
  risk_areas: { area: string; count: number }[];
  major_prs: { id: string; pr_title: string; summary: string | null; url: string | null; created_at: string }[];
}

export interface EntityItem {
  canonical: string;
  entity_type: string;
  aliases: string[];
}

export interface HealthResponse {
  status: string;
  pgvector: boolean;
}

export function search(q: string) {
  return apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(q)}`);
}

export function getOwnership(service: string) {
  return apiFetch<OwnershipResponse>(`/ownership/service/${encodeURIComponent(service)}`);
}

export function getBusFactor(service: string) {
  return apiFetch<{ service: string; bus_factor: number; risk_level: string; top_contributors: { author: string; knowledge_share: number }[]; recommendation: string }>(`/bus-factor/service/${encodeURIComponent(service)}`);
}

export function getTeamOverview() {
  return apiFetch<TeamOverview>("/team/overview");
}

export function getTimeline(service: string) {
  return apiFetch<TimelineResponse>(`/timeline/service/${encodeURIComponent(service)}`);
}

export function explainService(service: string) {
  return apiFetch<ServiceExplanation>(`/explain/service/${encodeURIComponent(service)}`);
}

export function getEntities() {
  return apiFetch<EntityItem[]>("/entities");
}

export function getHealth() {
  return apiFetch<HealthResponse>("/health");
}

export function syncRepo(repo: string, limit = 20) {
  return apiFetch<{ repo: string; synced_prs: number; memory_ids: string[] }>("/sync-repo", {
    method: "POST",
    body: JSON.stringify({ repo, limit }),
  });
}

export function synthesize(query: string) {
  return apiFetch<{ query: string; synthesis: { answer: string; recurring_patterns: string[] } | null; sources: { id: string; pr_title?: string; url?: string | null }[] }>("/synthesize", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}
