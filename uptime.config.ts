// UptimeFlare config for the Project Hail Mary platform (lishuyu.app).
// Served at status.lishuyu.app once the TRMNL device migrates off that host.

// Don't edit this line
import { MaintenanceConfig, PageConfig, WorkerConfig } from './types/config'
import type { Env } from './worker/src'

// --- Downtime email alerting (Resend, sent directly from the Worker) ---------
// Alerts go out via Resend's HTTP API straight from the Cloudflare Worker, on
// purpose: the worker runs on Cloudflare's edge, fully independent of the
// lishuyu.app droplet. Routing alerts through the platform's own
// messageservice/notificationservice (which live on that droplet, behind the
// very Cloudflare<->origin path being monitored) would let a droplet/network
// outage silence its own alarm — the exact failure this monitor exists to catch.
//
// RESEND_API_KEY is a Worker secret binding (deploy.tf var.resend_api_key,
// injected from the RESEND_API_KEY GitHub Actions secret at deploy time). It is
// never committed and never reaches the public status-page bundle.
//
// Batching + threading: onIncident/onStatusChange fire once per monitor, so
// emailing from them turned one platform-wide flap into a dozen emails (one
// per service). They now only buffer events; onCycleEnd sends AT MOST ONE
// summary email per cron tick. All mails of one incident form a single Gmail
// thread: the first DOWN summary is the root, every later mail (more downs,
// recoveries, all-clear) is a reply carrying In-Reply-To/References — the
// Resend-documented threading pattern — plus a `Re:`-prefixed subject (Gmail
// threads on References AND matching base subject). Thread state (root
// subject, our Message-IDs, which monitors were alerted) persists in the
// worker's D1 store under ALERT_THREAD_KEY and is cleared when the last
// alerted monitor recovers, so the next incident starts a fresh thread.
const ALERT_TO = 'lishuyustevenli@gmail.com'
const ALERT_FROM = 'lishuyu.app status <noreply@mail.lishuyu.app>'
// Only alert on outages sustained past this many seconds. The Cloudflare<->origin
// path flaps in short (~1 min) bursts; this debounces them so only real outages
// page. The cron runs every 60s, so the DOWN check uses a 60s-wide window.
const ALERT_GRACE_SEC = 120
const STATUS_PAGE = 'https://status.lishuyu.app/'
const ALERT_THREAD_KEY = 'alert_email_thread'
const ALERT_MSGID_DOMAIN = 'mail.lishuyu.app'

type AlertEnv = Pick<Env, 'RESEND_API_KEY' | 'UPTIMEFLARE_D1'>

// Per-tick buffers. Module-globals are safe here: they're only filled by the
// per-monitor callbacks of one scheduled() run and drained by onCycleEnd at
// the end of that same run.
let pendingDown: { id: string; name: string; target: string; reason: string; downSec: number }[] =
  []
let pendingUp: { id: string; name: string; downSec: number }[] = []

type AlertThread = {
  subject: string // root subject; replies send `Re: ${subject}`
  refs: string[] // Message-IDs of the thread so far, root first (References header)
  lastId: string // Message-ID of the most recent mail (In-Reply-To header)
  alerted: { id: string; name: string }[] // monitors a DOWN email actually named, still down
}

async function getAlertThread(env: AlertEnv): Promise<AlertThread | null> {
  const row = await env.UPTIMEFLARE_D1.prepare('SELECT value FROM uptimeflare WHERE key = ?')
    .bind(ALERT_THREAD_KEY)
    .first<{ value: string }>()
  return row?.value ? JSON.parse(row.value) : null
}

async function putAlertThread(env: AlertEnv, thread: AlertThread | null): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(
    'INSERT INTO uptimeflare (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;'
  )
    .bind(ALERT_THREAD_KEY, thread ? JSON.stringify(thread) : '')
    .run()
}

// --- HTML rendering (same zinc design language as the platform's emailservice
// templates; duplicated here on purpose — this worker is deliberately
// independent of the droplet, see the header comment). Email-client-safe:
// single table, inline styles, no images/SVG. The plain-text body stays as
// the multipart/alternative fallback.
const MAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function alertRow(dotColor: string, main: string, detail: string): string {
  return (
    `<div style="padding:8px 0;border-bottom:1px solid #f4f4f5;">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${dotColor};margin-right:10px;"></span>` +
    `<span style="font:600 14px/1.5 ${MAIL_FONT};color:#18181b;">${escHtml(main)}</span>` +
    `<div style="font:400 12px/1.6 ${MAIL_FONT};color:#71717a;margin:2px 0 0 18px;">${escHtml(detail)}</div>` +
    `</div>`
  )
}

function alertHtml(opts: {
  title: string
  downs: typeof pendingDown
  recovered: { name: string; downSec: number }[]
  stillDown: string[]
}): string {
  const mins = (sec: number) => Math.max(1, Math.round(sec / 60))
  let sections = ''
  if (opts.downs.length > 0) {
    sections += `<div style="font:600 12px/1 ${MAIL_FONT};color:#dc2626;letter-spacing:.06em;margin:16px 0 4px;">DOWN (${opts.downs.length})</div>`
    for (const d of opts.downs)
      sections += alertRow(
        '#dc2626',
        `${d.name} — down ~${mins(d.downSec)} min`,
        `${d.target} · ${d.reason || 'unspecified'}`
      )
  }
  if (opts.recovered.length > 0) {
    sections += `<div style="font:600 12px/1 ${MAIL_FONT};color:#16a34a;letter-spacing:.06em;margin:16px 0 4px;">RECOVERED (${opts.recovered.length})</div>`
    for (const u of opts.recovered)
      sections += alertRow('#16a34a', u.name, `back up after ~${mins(u.downSec)} min`)
  }
  const tail =
    opts.stillDown.length === 0
      ? `<div style="font:400 14px/1.6 ${MAIL_FONT};color:#16a34a;margin:16px 0 0;">All clear — every alerted service is back up.</div>`
      : `<div style="font:400 13px/1.6 ${MAIL_FONT};color:#71717a;margin:16px 0 0;">Still down: ${escHtml(opts.stillDown.join(', '))}</div>`
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;text-align:left;">
  <tr><td style="padding:18px 28px;border-bottom:1px solid #f4f4f5;">
    <span style="font:600 14px ${MAIL_FONT};color:#18181b;letter-spacing:.02em;">lishuyu.app</span>
    <span style="float:right;font:400 12px/17px ${MAIL_FONT};color:#a1a1aa;">status monitor</span>
  </td></tr>
  <tr><td style="padding:20px 28px 28px;">
    <div style="font:600 16px/1.4 ${MAIL_FONT};color:#18181b;">${escHtml(opts.title)}</div>
    ${sections}
    ${tail}
  </td></tr>
  <tr><td style="padding:14px 28px;border-top:1px solid #f4f4f5;font:400 12px/1.6 ${MAIL_FONT};color:#a1a1aa;">
    Sent by the edge status monitor · <a href="${STATUS_PAGE}" style="color:#2563eb;text-decoration:none;">status.lishuyu.app</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// Sends one alert email; returns the sent mail's Message-ID for threading, or
// null if the send failed. Resend's docs don't say whether a custom Message-ID
// header is passed through or rewritten, so after sending we read back the
// message_id Resend actually assigned (GET /emails/{id}) and prefer that;
// fall back to the custom Message-ID we set.
async function sendAlertEmail(
  env: AlertEnv,
  subject: string,
  text: string,
  html: string,
  headers: Record<string, string>
): Promise<string | null> {
  if (!env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured; skipping alert email')
    return null
  }
  const auth = {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    'content-type': 'application/json',
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ from: ALERT_FROM, to: ALERT_TO, subject, text, html, headers }),
    })
    if (!resp.ok) {
      console.log(`Resend alert failed: ${resp.status} ${await resp.text()}`)
      return null
    }
    console.log(`Resend alert sent: ${subject}`)
    const { id } = (await resp.json()) as { id: string }
    try {
      const detail = await fetch(`https://api.resend.com/emails/${id}`, { headers: auth })
      if (detail.ok) {
        const body = (await detail.json()) as { message_id?: string }
        if (body.message_id) return body.message_id
      }
    } catch (e) {
      console.log('Resend message_id readback failed (using our own): ' + e)
    }
    return headers['Message-ID'] ?? null
  } catch (e) {
    console.log('Resend alert error: ' + e)
    return null
  }
}

// The once-per-tick flush behind callbacks.onCycleEnd.
async function flushAlerts(env: AlertEnv, timeNow: number): Promise<void> {
  const downs = pendingDown
  const ups = pendingUp
  pendingDown = []
  pendingUp = []
  if (downs.length === 0 && ups.length === 0) return

  const thread = await getAlertThread(env)
  const alerted = new Map((thread?.alerted ?? []).map((m) => [m.id, m.name]))

  // Only report recoveries a DOWN email actually named — sub-grace blips stay
  // silent. Without thread state (e.g. first deploy of this scheme) fall back
  // to the old downtime-length test.
  const recovered = ups.filter((u) =>
    thread ? alerted.has(u.id) : u.downSec >= ALERT_GRACE_SEC
  )
  if (downs.length === 0 && recovered.length === 0) return

  const stillAlerted = new Map(alerted)
  for (const d of downs) stillAlerted.set(d.id, d.name)
  for (const u of recovered) stillAlerted.delete(u.id)

  const mins = (sec: number) => Math.max(1, Math.round(sec / 60))
  const lines: string[] = []
  if (downs.length > 0) {
    lines.push(`DOWN (${downs.length}):`)
    for (const d of downs)
      lines.push(`- ${d.name} (${d.target}) — down ~${mins(d.downSec)} min. Issue: ${d.reason || 'unspecified'}`)
    lines.push('')
  }
  if (recovered.length > 0) {
    lines.push(`RECOVERED (${recovered.length}):`)
    for (const u of recovered) lines.push(`- ${u.name} — back up after ~${mins(u.downSec)} min`)
    lines.push('')
  }
  if (stillAlerted.size === 0) {
    lines.push('All clear — every alerted service is back up.')
  } else {
    lines.push(`Still down: ${Array.from(stillAlerted.values()).join(', ')}`)
  }
  lines.push('')
  lines.push(`Status page: ${STATUS_PAGE}`)

  const msgId = `<phm-status-${timeNow}-${Math.random().toString(36).slice(2, 10)}@${ALERT_MSGID_DOMAIN}>`
  const headers: Record<string, string> = { 'Message-ID': msgId }
  let subject: string
  if (thread) {
    subject = `Re: ${thread.subject}`
    headers['In-Reply-To'] = thread.lastId
    headers['References'] = thread.refs.join(' ')
  } else if (downs.length === 1) {
    subject = `🔴 lishuyu.app: ${downs[0].name} is DOWN`
  } else if (downs.length > 1) {
    subject = `🔴 lishuyu.app: ${downs.length} services DOWN`
  } else {
    // recoveries only, with no stored thread to reply to
    subject = `✅ lishuyu.app: ${
      recovered.length === 1 ? `${recovered[0].name} recovered` : `${recovered.length} services recovered`
    }`
  }

  const html = alertHtml({
    // strip the reply prefix for the card title — the threading lives in the
    // subject/headers, the card should just state the incident
    title: thread ? thread.subject.replace(/^🔴 |^✅ /, '') : subject.replace(/^🔴 |^✅ /, ''),
    downs,
    recovered,
    stillDown: Array.from(stillAlerted.values()),
  })
  const sentId = (await sendAlertEmail(env, subject, lines.join('\n'), html, headers)) ?? msgId

  // Update thread state even if the send failed — the alerted set must track
  // which monitors are known-down or later recoveries would be misfiltered.
  if (stillAlerted.size === 0) {
    await putAlertThread(env, null)
  } else {
    const allRefs = [...(thread?.refs ?? []), sentId]
    await putAlertThread(env, {
      subject: thread?.subject ?? subject,
      // References must keep the thread root; cap the middle so the header
      // can't grow unbounded during a long flapping incident.
      refs: allRefs.length > 9 ? [allRefs[0], ...allRefs.slice(-8)] : allRefs,
      lastId: sentId,
      alerted: Array.from(stillAlerted, ([id, name]) => ({ id, name })),
    })
  }
}

const pageConfig: PageConfig = {
  title: 'lishuyu.app status',
  links: [
    { link: 'https://github.com/StevenLi-phoenix', label: 'GitHub' },
    { link: 'https://shuyuli.com/', label: 'Resume', highlight: true },
  ],
}

// --- Check from near the origin (Durable Object in eastern North America) ----
// Cloudflare schedules cron workers on underutilized machines, which in practice
// lands them in Europe (status data showed "location":"FRA"). Every droplet
// service therefore read ~100-125ms — that's one transatlantic TLS setup + RTT
// to the NYC1 droplet, NOT service latency (measured on-box: /health is 2-5ms).
// UptimeFlare's `worker://` checkProxy runs the actual check inside a Durable
// Object pinned via locationHint; `enam` (eastern North America) puts the prober
// a few ms from the droplet, so the reported number is dominated by the service
// itself. Fallback re-runs the check from the cron colo if the DO path errors,
// trading an inflated reading for a false DOWN. Edge-hosted sites (blog, resume
// on Cloudflare Pages) stay on plain checks — they're already measured at the edge.
const NYC_ORIGIN_CHECK = { checkProxy: 'worker://enam', checkProxyFallback: true }

const workerConfig: WorkerConfig = {
  kvWriteCooldownMinutes: 3,
  // The origin is a single-vCPU droplet that serializes TLS handshakes, so
  // concurrent checks queue and inflate the reported latency. Measured on the
  // origin: 1-at-a-time ~0.19s, 2 ~0.40s, 5 (the old pLimit) ~0.79s. This is a
  // single-user platform with no competing traffic, so check strictly serially
  // (1) for the lowest, truest reading (~100ms). Trade-off: a timing-out monitor
  // serializes the cycle — bump to 2 if check cycles ever start lagging.
  checkConcurrency: 1,
  monitors: [
    {
      id: 'registry',
      ...NYC_ORIGIN_CHECK,
      name: 'Registry',
      method: 'GET',
      target: 'https://registry.lishuyu.app/health',
      tooltip: 'Service catalog + discovery (trust root)',
    },
    {
      id: 'auth',
      ...NYC_ORIGIN_CHECK,
      name: 'Auth',
      method: 'GET',
      target: 'https://auth.lishuyu.app/api/users/me',
      // No public /health route; an unauthenticated 401 proves liveness.
      expectedCodes: [401],
      tooltip: 'User JWT / PAT / OAuth (trust root)',
    },
    {
      id: 'deployer',
      ...NYC_ORIGIN_CHECK,
      name: 'Deployer',
      method: 'GET',
      // Deployer moved off deploy.lishuyu.app 2026-07-02 — subdomains are
      // reserved for services with a real frontend; API-only services live
      // behind the api.lishuyu.app path gateway.
      target: 'https://api.lishuyu.app/deploy/health',
      tooltip: 'Webhook deploy pipeline',
    },
    {
      id: 'displayservice',
      ...NYC_ORIGIN_CHECK,
      name: 'TRMNL Display',
      method: 'GET',
      target: 'https://display.lishuyu.app/health',
      statusPageLink: 'https://display.lishuyu.app/',
      tooltip: 'E-ink dashboard server',
    },
    {
      id: 'messageservice',
      ...NYC_ORIGIN_CHECK,
      name: 'Messages',
      method: 'GET',
      target: 'https://api.lishuyu.app/message/health',
      tooltip: 'Platform message bus',
    },
    {
      id: 'kvservice',
      ...NYC_ORIGIN_CHECK,
      name: 'KV',
      method: 'GET',
      target: 'https://api.lishuyu.app/kv/health',
    },
    {
      id: 'logservice',
      ...NYC_ORIGIN_CHECK,
      name: 'Logs',
      method: 'GET',
      target: 'https://api.lishuyu.app/logs/health',
    },
    {
      id: 'oss',
      ...NYC_ORIGIN_CHECK,
      name: 'OSS',
      method: 'GET',
      target: 'https://api.lishuyu.app/oss/health',
    },
    {
      id: 'secretsservice',
      ...NYC_ORIGIN_CHECK,
      name: 'Secrets',
      method: 'GET',
      target: 'https://api.lishuyu.app/secrets/health',
    },
    {
      id: 'files',
      ...NYC_ORIGIN_CHECK,
      name: 'Files',
      method: 'GET',
      target: 'https://api.lishuyu.app/files/health',
    },
    {
      id: 'timeservice',
      ...NYC_ORIGIN_CHECK,
      name: 'Time',
      method: 'GET',
      // Gateway path shortened from /timeservice to /time (2026-07-02, matches
      // registry endpoint + the short-segment convention of the other services).
      // The old /timeservice/health 404'd, showing the service as down.
      target: 'https://api.lishuyu.app/time/health',
    },
    {
      id: 'locationservice',
      ...NYC_ORIGIN_CHECK,
      name: 'Location',
      method: 'GET',
      // moved off the api gateway to its own subdomain (2026-06-11)
      target: 'https://location.lishuyu.app/health',
    },
    {
      id: 'blog',
      name: 'Blog',
      method: 'GET',
      target: 'https://blog.lishuyu.app/',
      statusPageLink: 'https://blog.lishuyu.app/',
    },
    {
      id: 'resume',
      name: 'Resume',
      method: 'GET',
      // the user-facing site (readme.lishuyu.app is an alias); the raw API
      // lives at api.lishuyu.app/resume/ behind it
      target: 'https://shuyuli.com/',
      statusPageLink: 'https://shuyuli.com/',
    },
  ],
  callbacks: {
    // DOWN: onIncident fires every cron tick while a monitor is down. Buffer
    // once, when the outage first crosses the grace window (cron interval 60s);
    // onCycleEnd emails the batch.
    onIncident: (env, monitor, timeIncidentStart, timeNow, reason) => {
      const downSec = timeNow - timeIncidentStart
      if (downSec >= ALERT_GRACE_SEC && downSec < ALERT_GRACE_SEC + 60) {
        pendingDown.push({
          id: monitor.id,
          name: monitor.name,
          target: String(monitor.target),
          reason,
          downSec,
        })
      }
    },
    // UP: onStatusChange fires on every transition. Buffer every recovery;
    // flushAlerts drops the ones no DOWN email ever named (sub-grace blips).
    onStatusChange: (env, monitor, isUp, timeIncidentStart, timeNow, _reason) => {
      if (!isUp) return
      pendingUp.push({ id: monitor.id, name: monitor.name, downSec: timeNow - timeIncidentStart })
    },
    // Once per cron tick, after all monitors: send at most one summary email,
    // threaded onto the open incident's root mail (see comment block up top).
    onCycleEnd: (env, timeNow) => flushAlerts(env as AlertEnv, timeNow),
  },
}

const maintenances: MaintenanceConfig[] = []

// Don't edit this line
export { pageConfig, workerConfig, maintenances }
