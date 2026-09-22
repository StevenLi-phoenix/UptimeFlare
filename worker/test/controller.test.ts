import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveReportedStatus, parseSelfReport } from '../src/controller.ts'

const up = (report: unknown) => ({ ping: 42, up: true, err: '', report: parseSelfReport(report) ?? undefined })

test('parseSelfReport keeps only well-formed per-service health', () => {
  assert.deepEqual(
    parseSelfReport({ ok: false, services: { kvservice: { ok: true }, oss: { ok: false, code: 'service_disabled' }, bad: { ok: 'yes' } } }),
    { kvservice: { ok: true }, oss: { ok: false, code: 'service_disabled' } }
  )
  assert.equal(parseSelfReport({ ok: true }), null)
  assert.equal(parseSelfReport('nope'), null)
  assert.equal(parseSelfReport(null), null)
})

test('healthy reported service is up and carries the controller network latency', () => {
  const controller = up({ ok: true, services: { kvservice: { ok: true } } })
  assert.deepEqual(deriveReportedStatus('kvservice', controller), { ping: 42, up: true, err: '' })
})

test('unhealthy reported service is down with the controller code', () => {
  const controller = up({ ok: false, services: { oss: { ok: false, code: 'service_disabled' } } })
  assert.deepEqual(deriveReportedStatus('oss', controller), { ping: 42, up: false, err: 'Controller reports oss: service_disabled' })
})

test('service missing from the report is down', () => {
  const controller = up({ ok: true, services: {} })
  assert.deepEqual(deriveReportedStatus('files', controller), { ping: 42, up: false, err: 'Controller did not report files' })
})

test('unreachable controller takes every reported service down with its error', () => {
  const controller = { ping: 10000, up: false, err: 'Timeout after 10000ms' }
  assert.deepEqual(deriveReportedStatus('kvservice', controller), { ping: 0, up: false, err: 'Controller unreachable: Timeout after 10000ms' })
  assert.deepEqual(deriveReportedStatus(undefined, controller), { ping: 0, up: false, err: 'Controller unreachable: Timeout after 10000ms' })
})

test('reachable controller without a report counts as down for named services', () => {
  const controller = { ping: 30, up: true, err: '' }
  assert.deepEqual(deriveReportedStatus('kvservice', controller), { ping: 30, up: false, err: 'Controller did not report kvservice' })
})

test('rows without a service name follow controller reachability only', () => {
  assert.deepEqual(deriveReportedStatus(undefined, up({ ok: false, services: {} })), { ping: 42, up: true, err: '' })
})
