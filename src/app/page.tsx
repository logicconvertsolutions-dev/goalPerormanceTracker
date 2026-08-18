export default function Home() {
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-fg mb-4">
            Performance Tracker
          </h1>
          <p className="text-lg text-fg-2 mb-8">
            Activity management for WFG Associates
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-panel border border-line rounded-lg p-8 lift">
          <div className="space-y-8">
            {/* Status Badge */}
            <div className="inline-block">
              <span className="inline-flex items-center rounded-full bg-acc-dim border border-acc-line px-3 py-1 text-sm font-medium text-acc">
                <span className="mr-2 h-2 w-2 bg-acc rounded-full animate-pulse"></span>
                Phase 0: Foundation
              </span>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tech Stack */}
              <div className="bg-panel-2 rounded border border-line p-4 lift">
                <h3 className="text-sm font-semibold text-fg-2 uppercase tracking-wide mb-3">
                  Tech Stack
                </h3>
                <ul className="space-y-2">
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2 text-acc">✓</span>
                    Next.js 14 + TypeScript
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2 text-acc">✓</span>
                    Tailwind CSS
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2 text-acc">✓</span>
                    Supabase (PostgreSQL)
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2 text-acc">✓</span>
                    Vitest + Playwright
                  </li>
                </ul>
              </div>

              {/* Next Steps */}
              <div className="bg-panel-2 rounded border border-line p-4 lift">
                <h3 className="text-sm font-semibold text-fg-2 uppercase tracking-wide mb-3">
                  Next: Phase 1
                </h3>
                <ul className="space-y-2">
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2">→</span>
                    Database Schema
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2">→</span>
                    RLS Policies
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2">→</span>
                    Hierarchy & Closure
                  </li>
                  <li className="flex items-center text-sm text-fg-3">
                    <span className="mr-2">→</span>
                    pgTAP Tests
                  </li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-6 border-t border-line text-center">
              <p className="text-xs text-fg-4">
                Built with spec-driven development • Multi-tenant architecture
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
