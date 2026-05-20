"use client";

import { useState } from "react";
import { search, synthesize, type SearchResult } from "@/lib/api";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [confidence, setConfidence] = useState<{ answer_confidence: number; evidence_count: number } | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"search" | "ask">("search");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSynthesis(null);
    try {
      if (mode === "ask") {
        const res = await synthesize(query);
        setSynthesis(res.synthesis?.answer || "No relevant memories found.");
        setResults([]);
        setConfidence(null);
      } else {
        const res = await search(query);
        setResults(res.results);
        setConfidence(res.confidence);
      }
    } catch (err) {
      setSynthesis(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Search Memory</h1>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("search")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "search" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setMode("ask")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "ask" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
          >
            Ask AI
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "ask" ? "Ask a question about your codebase..." : "Search team memory..."}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? "..." : mode === "ask" ? "Ask" : "Search"}
          </button>
        </div>
      </form>

      {confidence && (
        <div className="flex gap-4 text-sm text-gray-400">
          <span>Confidence: {(confidence.answer_confidence * 100).toFixed(0)}%</span>
          <span>Evidence: {confidence.evidence_count} items</span>
        </div>
      )}

      {synthesis && (
        <div className="bg-gray-900 border border-indigo-800 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-indigo-400 mb-2">AI Answer</h3>
          <p className="text-gray-200 whitespace-pre-wrap">{synthesis}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <a
                    href={r.sources[0]?.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lg font-semibold text-indigo-400 hover:text-indigo-300"
                  >
                    {r.pr_title}
                  </a>
                  <div className="text-sm text-gray-500 mt-1">{r.repo} &middot; #{r.pr_number}</div>
                </div>
                <span className="bg-gray-800 text-gray-300 text-sm px-2 py-1 rounded">
                  {(r.score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div><span className="text-gray-400 font-medium">Problem:</span> <span className="text-gray-300">{r.problem}</span></div>
                <div><span className="text-gray-400 font-medium">Fix:</span> <span className="text-gray-300">{r.fix}</span></div>
                {r.risk_area && (
                  <div><span className="text-gray-400 font-medium">Risk:</span> <span className="text-yellow-400">{r.risk_area}</span></div>
                )}
              </div>
              {r.services_affected.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {r.services_affected.map((s) => (
                    <span key={s} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
