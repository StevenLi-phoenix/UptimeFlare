// UptimeFlare config for the Project Hail Mary platform (lishuyu.app).
// Served at status.lishuyu.app once the TRMNL device migrates off that host.

// Don't edit this line
import { MaintenanceConfig, PageConfig, WorkerConfig } from './types/config'

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
const ALERT_TO = 'lishuyustevenli@gmail.com'
const ALERT_FROM = 'lishuyu.app status <noreply@mail.lishuyu.app>'
// Only alert on outages sustained past this many seconds. The Cloudflare<->origin
// path flaps in short (~1 min) bursts; this debounces them so only real outages
// page. The cron runs every 60s, so the DOWN check uses a 60s-wide window.
const ALERT_GRACE_SEC = 120

async function sendAlertEmail(
  env: { RESEND_API_KEY?: string },
  subject: string,
  text: string
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured; skipping alert email')
    return
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: ALERT_FROM, to: ALERT_TO, subject, text }),
    })
    if (!resp.ok) {
      console.log(`Resend alert failed: ${resp.status} ${await resp.text()}`)
    } else {
      console.log(`Resend alert sent: ${subject}`)
    }
  } catch (e) {
    console.log('Resend alert error: ' + e)
  }
}

const pageConfig: PageConfig = {
  title: 'lishuyu.app status',
  links: [
    { link: 'https://github.com/StevenLi-phoenix', label: 'GitHub' },
    { link: 'https://shuyuli.com/', label: 'Resume', highlight: true },
  ],
}

const workerConfig: WorkerConfig = {
  kvWriteCooldownMinutes: 3,
  monitors: [
    {
      id: 'registry',
      name: 'Registry',
      method: 'GET',
      target: 'https://registry.lishuyu.app/health',
      tooltip: 'Service catalog + discovery (trust root)',
    },
    {
      id: 'auth',
      name: 'Auth',
      method: 'GET',
      target: 'https://auth.lishuyu.app/api/users/me',
      // No public /health route; an unauthenticated 401 proves liveness.
      expectedCodes: [401],
      tooltip: 'User JWT / PAT / OAuth (trust root)',
    },
    {
      id: 'deployer',
      name: 'Deployer',
      method: 'GET',
      target: 'https://deploy.lishuyu.app/health',
      tooltip: 'Webhook deploy pipeline',
    },
    {
      id: 'displayservice',
      name: 'TRMNL Display',
      method: 'GET',
      target: 'https://display.lishuyu.app/health',
      statusPageLink: 'https://display.lishuyu.app/',
      tooltip: 'E-ink dashboard server',
    },
    {
      id: 'messageservice',
      name: 'Messages',
      method: 'GET',
      target: 'https://api.lishuyu.app/message/health',
      tooltip: 'Platform message bus',
    },
    {
      id: 'kvservice',
      name: 'KV',
      method: 'GET',
      target: 'https://api.lishuyu.app/kv/health',
    },
    {
      id: 'logservice',
      name: 'Logs',
      method: 'GET',
      target: 'https://api.lishuyu.app/logs/health',
    },
    {
      id: 'oss',
      name: 'OSS',
      method: 'GET',
      target: 'https://api.lishuyu.app/oss/health',
    },
    {
      id: 'secretsservice',
      name: 'Secrets',
      method: 'GET',
      target: 'https://api.lishuyu.app/secrets/health',
    },
    {
      id: 'files',
      name: 'Files',
      method: 'GET',
      target: 'https://api.lishuyu.app/files/health',
    },
    {
      id: 'timeservice',
      name: 'Time',
      method: 'GET',
      target: 'https://api.lishuyu.app/timeservice/health',
    },
    {
      id: 'locationservice',
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
    // DOWN: onIncident fires every cron tick while a monitor is down. Email
    // once, when the outage first crosses the grace window (cron interval 60s).
    onIncident: async (env, monitor, timeIncidentStart, timeNow, reason) => {
      const downSec = timeNow - timeIncidentStart
      if (downSec >= ALERT_GRACE_SEC && downSec < ALERT_GRACE_SEC + 60) {
        const mins = Math.max(1, Math.round(downSec / 60))
        await sendAlertEmail(
          env,
          `🔴 ${monitor.name} is DOWN`,
          `${monitor.name} (${monitor.target}) has been unreachable for ~${mins} min.\n` +
            `Issue: ${reason || 'unspecified'}\n\n` +
            `Status page: https://status.lishuyu.app/`
        )
      }
    },
    // UP: onStatusChange fires on every transition. Only email recovery for an
    // outage long enough that a DOWN alert went out (so sub-grace blips stay silent).
    onStatusChange: async (env, monitor, isUp, timeIncidentStart, timeNow, _reason) => {
      if (!isUp) return
      const downSec = timeNow - timeIncidentStart
      if (downSec >= ALERT_GRACE_SEC) {
        const mins = Math.max(1, Math.round(downSec / 60))
        await sendAlertEmail(
          env,
          `✅ ${monitor.name} recovered`,
          `${monitor.name} is back up after ~${mins} min of downtime.\n\n` +
            `Status page: https://status.lishuyu.app/`
        )
      }
    },
  },
}

const maintenances: MaintenanceConfig[] = []

// Don't edit this line
export { pageConfig, workerConfig, maintenances }
