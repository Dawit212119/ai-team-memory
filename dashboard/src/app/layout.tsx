import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Team Memory",
  description: "Institutional memory from engineering activity",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="px-3 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 rounded-md transition-colors">
      {children}
    </a>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-gray-950">
      <body className="h-full text-gray-100">
        <nav className="bg-gray-900 border-b border-gray-800">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-2">
                <a href="/" className="text-lg font-bold text-white tracking-tight">
                  AI Team Memory
                </a>
                <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">beta</span>
              </div>
              <div className="flex items-center gap-1">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/search">Search</NavLink>
                <NavLink href="/services">Services</NavLink>
                <NavLink href="/ownership">Ownership</NavLink>
                <NavLink href="/onboarding">Onboarding</NavLink>
                <NavLink href="/settings">Settings</NavLink>
              </div>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
