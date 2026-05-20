"use client";

import { useEffect, useState } from "react";
import { getHealth, getTeamOverview, type TeamOverview, type HealthResponse } from "@/lib/api";

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(e.message));
    getTeamOverview().then(setTeam).catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-400 mt-1">Institutional memory from your engineering activity</p>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-200">
          API Error: {error}. Make sure the API server is running on port 3000.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="API Status"
          value={health ? "Online" : "Connecting..."}
          sub={health ? `pgvector: ${health.pgvector ? "enabled" : "fallback"}` : ""}
          color={health ? "green" : "yellow"}
        />
        <StatCard
          label="Contributors"
          value={team?.total_contributors?.toString() || "—"}
          sub="unique authors"
          color="blue"
        />
        <StatCard
          label="Services at Risk"
          value={team?.services_at_risk?.filter((s) => s.bus_factor <= 1).length?.toString() || "—"}
          sub="bus factor ≤ 1"
          color="red"
        />
      </div>

      {team && team.most_active.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold">Most Active Contributors</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-400 border-b border-gray-800">
                <th className="px-6 py-3">Author</th>
                <th className="px-6 py-3">Commits</th>
                <th className="px-6 py-3">Services</th>
              </tr>
            </thead>
            <tbody>
              {team.most_active.slice(0, 10).map((a) => (
                <tr key={a.author} className="border-b border-gray-800/50 hover:bg-gray-800/50">
                  <td className="px-6 py-3 font-medium">{a.author}</td>
                  <td className="px-6 py-3 text-gray-300">{a.total_commits}</td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1">
                      {a.services.slice(0, 5).map((s) => (
                        <span key={s} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded">{s}</span>
                      ))}
                      {a.services.length > 5 && (
                        <span className="text-gray-500 text-xs">+{a.services.length - 5}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {team && team.services_at_risk.filter((s) => s.bus_factor <= 1).length > 0 && (
        <div className="bg-gray-900 border border-red-900/50 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-red-400">Knowledge Concentration Alerts</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {team.services_at_risk
              .filter((s) => s.bus_factor <= 1)
              .slice(0, 12)
              .map((s) => (
                <div key={s.service} className="bg-gray-800 rounded-lg p-3">
                  <div className="font-medium text-red-300">{s.service}</div>
                  <div className="text-sm text-gray-400">
                    Owner: {s.primary_owner || "unknown"} &middot; Bus factor: {s.bus_factor}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    green: "border-green-800 bg-green-950/30",
    blue: "border-blue-800 bg-blue-950/30",
    red: "border-red-800 bg-red-950/30",
    yellow: "border-yellow-800 bg-yellow-950/30",
  };
  return (
    <div className={`rounded-lg border p-5 ${colors[color] || colors.blue}`}>
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{sub}</div>
    </div>
  );
}
