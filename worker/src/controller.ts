// Controller self-report: the droplet's fabric Host serves every api.lishuyu.app
// service from one process, so one enam probe of GET /health/services replaces a
// probe per service. The Host reports health only; the latency shown for derived
// rows is the network latency of that single controller probe.

export type ServiceHealth = { ok: boolean; code?: string }
export type SelfReport = Record<string, ServiceHealth>
export type CheckStatus = { ping: number; up: boolean; err: string; report?: SelfReport }

export function parseSelfReport(body: unknown): SelfReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const services = (body as { services?: unknown }).services
  if (!services || typeof services !== 'object' || Array.isArray(services)) return null
  const report: SelfReport = {}
  for (const [name, value] of Object.entries(services as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || typeof (value as ServiceHealth).ok !== 'boolean') continue
    const { ok, code } = value as ServiceHealth
    report[name] = typeof code === 'string' ? { ok, code } : { ok }
  }
  return report
}

// `service` undefined = a row that only tracks controller reachability (e.g. a
// compatibility route with no backing service).
export function deriveReportedStatus(
  service: string | undefined,
  controller: CheckStatus
): { ping: number; up: boolean; err: string } {
  if (!controller.up) return { ping: 0, up: false, err: `Controller unreachable: ${controller.err}` }
  if (service === undefined) return { ping: controller.ping, up: true, err: '' }
  const health = controller.report?.[service]
  if (!health) return { ping: controller.ping, up: false, err: `Controller did not report ${service}` }
  if (!health.ok) return { ping: controller.ping, up: false, err: `Controller reports ${service}: ${health.code ?? 'unhealthy'}` }
  return { ping: controller.ping, up: true, err: '' }
}
