// UptimeFlare config for the Project Hail Mary platform (lishuyu.app).
// Served at status.lishuyu.app once the TRMNL device migrates off that host.

// Don't edit this line
import { MaintenanceConfig, PageConfig, WorkerConfig } from './types/config'

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
}

const maintenances: MaintenanceConfig[] = []

// Don't edit this line
export { pageConfig, workerConfig, maintenances }
