"use client";

import { useEffect, useState } from "react";

interface Integration {
  id: number;
  provider: string;
  provider_team_name: string | null;
  scopes: string | null;
  connected_by: string | null;
  created_at: string;
}

const API_BASE = "/api";

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [justConnected, setJustConnected] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected) {
      setJustConnected(connected);
      window.history.replaceState({}, "", "/settings");
    }
    fetchIntegrations();
  }, []);

  async function fetchIntegrations() {
    try {
      const res = await fetch(`${API_BASE}/integrations`);
      if (res.ok) setIntegrations(await res.json());
    } catch {}
    setLoading(false);
  }

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${provider}? This will remove the saved credentials.`)) return;
    try {
      await fetch(`${API_BASE}/integrations/${provider}`, { method: "DELETE" });
      setIntegrations((prev) => prev.filter((i) => i.provider !== provider));
    } catch {}
  }

  const apiUrl = typeof window !== "undefined" ? window.location.origin.replace(":3001", ":3000") : "";
  const githubConnected = integrations.some((i) => i.provider === "github");
  const slackConnected = integrations.some((i) => i.provider === "slack");
  const githubIntegration = integrations.find((i) => i.provider === "github");
  const slackIntegration = integrations.find((i) => i.provider === "slack");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings & Integrations</h1>
        <p className="text-gray-400 mt-1">Connect your tools to build institutional memory</p>
      </div>

      {justConnected && (
        <div className="bg-green-900/50 border border-green-700 rounded-lg p-4 text-green-200">
          Successfully connected {justConnected}!
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* GitHub */}
        <div className={`bg-gray-900 border rounded-lg p-6 ${githubConnected ? "border-green-800" : "border-gray-800"}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-xl">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-lg">GitHub</h3>
                <p className="text-sm text-gray-400">Sync PRs, commits, and code changes</p>
              </div>
            </div>
            {githubConnected && (
              <span className="bg-green-900/50 text-green-300 text-xs px-2 py-1 rounded-full">Connected</span>
            )}
          </div>

          {githubConnected && githubIntegration ? (
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-lg p-3 text-sm">
                <div><span className="text-gray-400">Account:</span> {githubIntegration.provider_team_name}</div>
                <div><span className="text-gray-400">Connected:</span> {githubIntegration.created_at?.slice(0, 10)}</div>
                <div><span className="text-gray-400">Connected by:</span> {githubIntegration.connected_by}</div>
              </div>
              <button
                onClick={() => disconnect("github")}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Disconnect GitHub
              </button>
            </div>
          ) : (
            <a
              href={`${apiUrl}/auth/github`}
              className="inline-block bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Connect GitHub
            </a>
          )}
        </div>

        {/* Slack */}
        <div className={`bg-gray-900 border rounded-lg p-6 ${slackConnected ? "border-green-800" : "border-gray-800"}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-xl">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-lg">Slack</h3>
                <p className="text-sm text-gray-400">Capture decisions and context from channels</p>
              </div>
            </div>
            {slackConnected && (
              <span className="bg-green-900/50 text-green-300 text-xs px-2 py-1 rounded-full">Connected</span>
            )}
          </div>

          {slackConnected && slackIntegration ? (
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-lg p-3 text-sm">
                <div><span className="text-gray-400">Workspace:</span> {slackIntegration.provider_team_name}</div>
                <div><span className="text-gray-400">Connected:</span> {slackIntegration.created_at?.slice(0, 10)}</div>
              </div>
              <button
                onClick={() => disconnect("slack")}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Disconnect Slack
              </button>
            </div>
          ) : (
            <a
              href={`${apiUrl}/auth/slack`}
              className="inline-block bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Add to Slack
            </a>
          )}
        </div>
      </div>

      {/* Coming Soon */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-gray-400">Coming Soon</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: "Linear", desc: "Import tickets and project context" },
            { name: "Notion", desc: "Ingest docs, runbooks, and ADRs" },
            { name: "PagerDuty", desc: "Incident history and postmortems" },
          ].map((tool) => (
            <div key={tool.name} className="bg-gray-900 border border-gray-800 rounded-lg p-4 opacity-60">
              <h3 className="font-medium">{tool.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{tool.desc}</p>
              <span className="text-xs text-gray-600 mt-2 inline-block">Coming soon</span>
            </div>
          ))}
        </div>
      </div>

      {/* API Configuration */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-3">API Configuration</h2>
        <div className="bg-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 space-y-1">
          <div>API Base URL: <span className="text-indigo-400">{apiUrl || "http://localhost:3000"}</span></div>
          <div>Dashboard URL: <span className="text-indigo-400">{typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}</span></div>
        </div>
      </div>
    </div>
  );
}
