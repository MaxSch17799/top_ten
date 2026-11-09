import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, parseJson, isUncertainFailure } from '../frontend/src/lib/http.js';

test('API failures preserve their status and distinguish uncertain outcomes from rejected moves', async () => {
  for (const [status, payload, uncertain] of [[400, { error: 'ILLEGAL_MOVE' }, false], [409, { error: 'STALE_REVISION' }, false], [503, { error: 'ROOM_COMMIT_UNCERTAIN', retryable: true }, true], [502, { error: 'GATEWAY' }, true]] as const) {
    await assert.rejects(parseJson(new Response(JSON.stringify(payload), { status })), error => {
      assert.ok(error instanceof ApiError); assert.equal(error.status, status); assert.equal(isUncertainFailure(error), uncertain); return true;
    });
  }
  assert.equal(isUncertainFailure(new TypeError('Network interrupted')), true);
  assert.equal(isUncertainFailure(new DOMException('Timed out', 'TimeoutError')), true);
  assert.deepEqual(await parseJson(new Response('{"success":true}')), { success: true });
});
