"use client";

import { useEffect, useState } from "react";
import { getEntities, explainService, getTimeline, type EntityItem, type ServiceExplanation, type TimelineResponse } from "@/lib/api";

export default function ServicesPage() {
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ServiceExplanation | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getEntities().then(setEntities).catch(() => {});
  }, []);

  async function selectService(name: string) {
    setSelected(name);
    setLoading(true);
    try {
      const [exp, tl] = await Promise.all([explainService(name), getTimeline(name)]);
      setExplanation(exp);
      setTimeline(tl);
    } catch {
      setExplanation(null);
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Service Catalog</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {entities.map((e) => (
          <button
            key={e.canonical}
            onClick={() => selectService(e.canonical)}
            className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selected === e.canonical
                ? "bg-indigo-600 text-white"
                : "bg-gray-900 border border-gray-800 text-gray-300 hover:border-gray-600"
            }`}
          >
            <div className="font-medium">{e.canonical}</div>
            <div className="text-xs opacity-60">{e.aliases.length} aliases</div>
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400">Loading...</div>}

      {explanation && !loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold">{explanation.service}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{explanation.total_prs}</div>
              <div className="text-sm text-gray-400">PRs</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{explanation.total_issues}</div>
              <div className="text-sm text-gray-400">Issues</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{explanation.contributors.length}</div>
              <div className="text-sm text-gray-400">Contributors</div>
            </div>
          </div>

          {explanation.risk_areas.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Risk Areas</h3>
              <div className="flex flex-wrap gap-2">
                {explanation.risk_areas.map((r) => (
                  <span key={r.area} className="bg-yellow-900/30 border border-yellow-800 text-yellow-200 text-sm px-3 py-1 rounded-full">
                    {r.area} ({r.count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {explanation.major_prs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Major PRs</h3>
              <div className="space-y-2">
                {explanation.major_prs.slice(0, 5).map((pr) => (
                  <div key={pr.id} className="bg-gray-800 rounded-lg p-3">
                    <a href={pr.url || "#"} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-medium">
                      {pr.pr_title}
                    </a>
                    {pr.summary && <p className="text-sm text-gray-400 mt-1">{pr.summary}</p>}
                    <div className="text-xs text-gray-500 mt-1">{pr.created_at?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {timeline && !loading && timeline.timeline.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Timeline</h2>
          <div className="space-y-3">
            {timeline.timeline.slice(-6).map((period) => (
              <div key={period.month} className="flex items-start gap-4">
                <div className="w-20 text-sm text-gray-400 font-mono pt-1">{period.month}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="h-2 bg-indigo-500 rounded-full"
                      style={{ width: `${Math.min(period.changes * 20, 100)}%` }}
                    />
                    <span className="text-xs text-gray-500">{period.changes} changes</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {period.prs.slice(0, 2).map((p) => p.pr_title).join(" | ")}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {timeline.architectural_shifts.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-800">
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Architectural Shifts</h3>
              {timeline.architectural_shifts.slice(-3).map((s, i) => (
                <div key={i} className="text-sm text-gray-300 mb-1">
                  {s.date.slice(0, 10)}: <span className="text-gray-500">{s.from || "—"}</span> &rarr; <span className="text-yellow-300">{s.to}</span>
                  <span className="text-gray-500"> ({s.pr_title})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
