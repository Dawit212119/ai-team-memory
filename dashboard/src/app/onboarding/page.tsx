"use client";

import { useState } from "react";
import { synthesize, getTeamOverview, getTimeline, type TeamOverview, type TimelineResponse } from "@/lib/api";

export default function OnboardingPage() {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState<{
    team: TeamOverview | null;
    timeline: TimelineResponse | null;
    synthesis: string | null;
  } | null>(null);

  async function generateBriefing() {
    setLoading(true);
    try {
      const [team, synth] = await Promise.all([
        getTeamOverview().catch(() => null),
        synthesize("What are the most important architectural decisions and patterns in this codebase? What should a new engineer know?").catch(() => null),
      ]);

      let timeline: TimelineResponse | null = null;
      if (repo.trim()) {
        timeline = await getTimeline(repo.trim()).catch(() => null);
      }

      setBriefing({
        team,
        timeline,
        synthesis: synth?.synthesis?.answer || null,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">New Engineer Onboarding</h1>
        <p className="text-gray-400 mt-1">Get up to speed with what matters in your codebase</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3">Generate Your Briefing</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="Service name (optional, e.g. router)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={generateBriefing}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? "Generating..." : "Generate Briefing"}
          </button>
        </div>
      </div>

      {briefing && (
        <div className="space-y-6">
          {briefing.synthesis && (
            <div className="bg-gray-900 border border-indigo-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-indigo-400 mb-3">What You Should Know</h2>
              <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{briefing.synthesis}</p>
            </div>
          )}

          {briefing.team && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Who to Talk To</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {briefing.team.most_active.slice(0, 6).map((a) => (
                  <div key={a.author} className="bg-gray-800 rounded-lg p-3">
                    <div className="font-medium">{a.author}</div>
                    <div className="text-sm text-gray-400 mt-1">
                      {a.total_commits} commits across {a.services.slice(0, 3).join(", ")}
                      {a.services.length > 3 ? ` +${a.services.length - 3} more` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.team && briefing.team.services_at_risk.length > 0 && (
            <div className="bg-gray-900 border border-yellow-900/50 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-yellow-400 mb-3">Areas Needing Help</h2>
              <p className="text-sm text-gray-400 mb-3">
                These services have low bus factors — your contributions here would be especially valuable.
              </p>
              <div className="flex flex-wrap gap-2">
                {briefing.team.services_at_risk
                  .filter((s) => s.bus_factor <= 1)
                  .slice(0, 10)
                  .map((s) => (
                    <span key={s.service} className="bg-yellow-900/30 border border-yellow-800 text-yellow-200 text-sm px-3 py-1 rounded-full">
                      {s.service} (owner: {s.primary_owner})
                    </span>
                  ))}
              </div>
            </div>
          )}

          {briefing.timeline && briefing.timeline.timeline.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Recent Activity in {briefing.timeline.service}</h2>
              <div className="space-y-3">
                {briefing.timeline.timeline.slice(-4).map((period) => (
                  <div key={period.month}>
                    <div className="text-sm font-medium text-gray-300">{period.month} — {period.changes} changes</div>
                    <ul className="mt-1 space-y-1">
                      {period.prs.slice(0, 3).map((pr) => (
                        <li key={pr.id} className="text-sm text-gray-400 pl-4">
                          {pr.url ? (
                            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300">
                              {pr.pr_title}
                            </a>
                          ) : (
                            pr.pr_title
                          )}
                          <span className="text-gray-600"> by {pr.author}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
