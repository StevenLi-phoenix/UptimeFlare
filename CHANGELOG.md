# Changelog

All notable changes to this fork are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-09-26

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
