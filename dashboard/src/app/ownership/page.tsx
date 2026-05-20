"use client";

import { useEffect, useState } from "react";
import { getTeamOverview, getOwnership, type TeamOverview, type OwnershipResponse } from "@/lib/api";

export default function OwnershipPage() {
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<OwnershipResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getTeamOverview().then(setTeam).catch(() => {});
  }, []);

  async function selectService(name: string) {
    setSelectedService(name);
    setLoading(true);
    try {
      setOwnership(await getOwnership(name));
    } catch {
      setOwnership(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Ownership & Bus Factor</h1>

      {team && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-red-900/50 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-400 mb-4">Critical Risk (Bus Factor = 1)</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {team.services_at_risk
                .filter((s) => s.bus_factor <= 1)
                .map((s) => (
                  <button
                    key={s.service}
                    onClick={() => selectService(s.service)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedService === s.service ? "bg-red-900/50 border border-red-700" : "bg-gray-800 hover:bg-gray-750"
                    }`}
                  >
                    <span className="font-medium">{s.service}</span>
                    <span className="text-gray-400 ml-2">owner: {s.primary_owner}</span>
                  </button>
                ))}
            </div>
          </div>

          <div className="bg-gray-900 border border-yellow-900/50 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-400 mb-4">Moderate Risk (Bus Factor = 2)</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {team.services_at_risk
                .filter((s) => s.bus_factor === 2)
                .map((s) => (
                  <button
                    key={s.service}
                    onClick={() => selectService(s.service)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedService === s.service ? "bg-yellow-900/50 border border-yellow-700" : "bg-gray-800 hover:bg-gray-750"
                    }`}
                  >
                    <span className="font-medium">{s.service}</span>
                    <span className="text-gray-400 ml-2">owner: {s.primary_owner}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-400">Loading ownership data...</div>}

      {ownership && !loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{ownership.service}</h2>
            <div className={`text-sm px-3 py-1 rounded-full ${
              ownership.bus_factor <= 1
                ? "bg-red-900/50 text-red-300"
                : ownership.bus_factor === 2
                  ? "bg-yellow-900/50 text-yellow-300"
                  : "bg-green-900/50 text-green-300"
            }`}>
              Bus Factor: {ownership.bus_factor}
            </div>
          </div>

          {ownership.concentration_warning && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-200">
              {ownership.concentration_warning}
            </div>
          )}

          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-400 border-b border-gray-800">
                <th className="pb-2">Author</th>
                <th className="pb-2">Score</th>
                <th className="pb-2">Commits</th>
                <th className="pb-2">Recent (90d)</th>
                <th className="pb-2">Files</th>
                <th className="pb-2">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {ownership.owners.map((o) => (
                <tr key={o.author} className="border-b border-gray-800/50">
                  <td className="py-2 font-medium">{o.author}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${o.score * 100}%` }} />
                      </div>
                      <span className="text-sm text-gray-400">{(o.score * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-gray-300">{o.commit_count}</td>
                  <td className="py-2 text-gray-300">{o.recent_commits}</td>
                  <td className="py-2 text-gray-300">{o.files_touched}</td>
                  <td className="py-2 text-gray-500 text-sm">{o.last_active?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
