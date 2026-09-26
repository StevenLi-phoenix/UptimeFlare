// Core report: the droplet runs every api.lishuyu.app service as a plugin of one process
// ("core"), so one enam probe of GET https://api.lishuyu.app/health replaces a probe per
// service. /health answers { ok, plugins: { <pluginId>: <phase> } } with 200 when every
// enabled plugin is serving and 503 when one is not; it reports health only, so the
// latency shown for derived rows is the network latency of that single probe.

export type PluginHealth = { ok: boolean; code?: string }
export type CoreReport = Record<string, PluginHealth>
export type CheckStatus = { ping: number; up: boolean; err: string; report?: CoreReport }

/** A plugin serves in these phases (probation = newly deployed, still answering). */
const SERVING = new Set(['active', 'probation'])

export function parseCoreReport(body: unknown): CoreReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const plugins = (body as { plugins?: unknown }).plugins
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return null
  const report: CoreReport = {}
  for (const [pluginId, phase] of Object.entries(plugins as Record<string, unknown>)) {
    if (typeof phase !== 'string') continue
    report[pluginId] = SERVING.has(phase) ? { ok: true } : { ok: false, code: phase }
  }
  return report
}

// `plugin` undefined = a row that only tracks core reachability.
export function deriveReportedStatus(
  plugin: string | undefined,
  core: CheckStatus
): { ping: number; up: boolean; err: string } {
  if (!core.up) return { ping: 0, up: false, err: `Core unreachable: ${core.err}` }
  if (plugin === undefined) return { ping: core.ping, up: true, err: '' }
  const health = core.report?.[plugin]
  if (!health) return { ping: core.ping, up: false, err: `Core did not report ${plugin}` }
  if (!health.ok) return { ping: core.ping, up: false, err: `Core reports ${plugin}: ${health.code ?? 'unhealthy'}` }
  return { ping: core.ping, up: true, err: '' }
}
