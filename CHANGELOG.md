# Changelog

All notable changes to this fork are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Merged upstream lyc8503/UptimeFlare up to `8035521`: the remote-checker Durable Object name includes its location hint (#223), footer spelling (#225).

### Added

- Weekly "Upstream PR" workflow: merges lyc8503/UptimeFlare `main` into an `upstream/<sha>` branch and opens a PR (or reports a conflict), instead of the upstream `sync.yaml` reset that would drop this fork's changes. The PR body lists each upstream commit, the diffstat, the files this fork also changed, and the full diff. It merges and deploys on its own when the merge is clean, upstream leaves this fork's setup files alone (`uptime.config.ts`, wrangler configs, `deploy.tf`, `deploy/`, `.github/`) and the worker tests, worker build and Pages build pass; otherwise the PR stays open with the reason.

## [0.3.0] - 2026-11-01

### Added

- `files-p2p` and `turingtest` monitors in the "Cloudflare Workers" group.

### Changed

- Messages, Notify, Email, Mailbox, Files and Pages moved to the "Cloudflare Workers" group and are probed on their public URL; mailbox tooltip now names its only inbound address, ai@lishuyu.app.

### Removed

- OSS row: oss is retired as a standalone service (it is now the files Worker's internal R2 byte store).

## [0.2.0] - 2026-11-01

### Changed

- Services cut over to Cloudflare Workers (`timeservice`, `commentservice`) are probed on their public URL in a new "Cloudflare Workers" group; core's report only sees the idle phm copy kept for rollback.

### Removed

- Logs and Secrets rows: logservice and secretsservice are retired (api repo docs/edge.md §2.1).

## [0.1.0] - 2026-09-26

### Added

- Core report monitoring: a `coreReport` monitor parses core's `GET https://api.lishuyu.app/health` (`{ ok, plugins: { <pluginId>: <phase> } }`; 200 or 503 both mean core is reachable), and `reportedBy: { monitor, plugin }` monitors derive their status from it without a request of their own. `active` and `probation` count as serving (`worker/src/controller.ts`, tests in `worker/test/`, `npm test` in `worker/`).
- Status page groups: "Platform (phm droplet)" and "Cloudflare Pages".

### Changed

- Only one monitor (`controller`) still goes through the enam RemoteChecker Durable Object; it is the only droplet row charting network latency. The 11 api.lishuyu.app path services are derived from its report by plugin id.
- Droplet hostnames with their own DNS / Cloudflare rules / Caddy site or listener (registry, auth, display, mail, location, pages.shuyuli.com) are probed directly from the cron colo, up/down only. Blog and resume (Cloudflare Pages) are unchanged.
- RemoteChecker exposes a single `check(monitor)` RPC method.

### Removed

- The Deployer row: the webhook deployer was retired with the fabric Host; core deploys through its control socket.
- Per-tick `cloudflare.com/cdn-cgi/trace` lookups in the cron and in every DO check (cron colo can't be pinned; DO checks are labelled by their location hint). Together with the DO consolidation this cuts subrequests per tick from 21 to 9, to bring the scheduled handler under the free-plan 10ms CPU limit (was 11–17ms).
