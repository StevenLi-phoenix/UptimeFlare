import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveReportedStatus, parseCoreReport } from '../src/controller.ts'

const up = (report: unknown) => ({ ping: 42, up: true, err: '', report: parseCoreReport(report) ?? undefined })

test('parseCoreReport maps plugin phases to health: active and probation serve', () => {
  assert.deepEqual(
    parseCoreReport({ ok: false, plugins: { kvservice: 'active', resume: 'probation', oss: 'failed', files: 'disabled', bad: 3 } }),
    { kvservice: { ok: true }, resume: { ok: true }, oss: { ok: false, code: 'failed' }, files: { ok: false, code: 'disabled' } }
  )
  assert.equal(parseCoreReport({ ok: true }), null)
  assert.equal(parseCoreReport({ plugins: ['kvservice'] }), null)
  assert.equal(parseCoreReport('nope'), null)
  assert.equal(parseCoreReport(null), null)
})

test('serving plugin is up and carries the core probe latency', () => {
  const core = up({ ok: true, plugins: { kvservice: 'active' } })
  assert.deepEqual(deriveReportedStatus('kvservice', core), { ping: 42, up: true, err: '' })
})

test('plugin that is not serving is down with its phase', () => {
  const core = up({ ok: false, plugins: { oss: 'failed' } })
  assert.deepEqual(deriveReportedStatus('oss', core), { ping: 42, up: false, err: 'Core reports oss: failed' })
})

test('plugin missing from the report is down', () => {
  const core = up({ ok: true, plugins: {} })
  assert.deepEqual(deriveReportedStatus('files', core), { ping: 42, up: false, err: 'Core did not report files' })
})

test('unreachable core takes every reported plugin down with its error', () => {
  const core = { ping: 10000, up: false, err: 'Timeout after 10000ms' }
  assert.deepEqual(deriveReportedStatus('kvservice', core), { ping: 0, up: false, err: 'Core unreachable: Timeout after 10000ms' })
  assert.deepEqual(deriveReportedStatus(undefined, core), { ping: 0, up: false, err: 'Core unreachable: Timeout after 10000ms' })
})

test('reachable core without a report counts as down for named plugins', () => {
  const core = { ping: 30, up: true, err: '' }
  assert.deepEqual(deriveReportedStatus('kvservice', core), { ping: 30, up: false, err: 'Core did not report kvservice' })
})

test('rows without a plugin follow core reachability only', () => {
  assert.deepEqual(deriveReportedStatus(undefined, up({ ok: false, plugins: {} })), { ping: 42, up: true, err: '' })
})
