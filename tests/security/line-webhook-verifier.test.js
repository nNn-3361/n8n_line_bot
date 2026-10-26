'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INTERNAL_AUTH_HEADER,
  VERIFIER_VERSION,
  createEventTaskId,
  createLineSignature,
  createVerifierServer,
} = require('../../src/verifier/line-webhook-verifier');
const { createTaskId } = require('../../src/validation/task-id');

const CHANNEL_SECRET = 'local-test-channel-secret-32chars';
const OWNER_USER_ID = `U${'a'.repeat(32)}`;
const INTERNAL_AUTH_TOKEN = 'local-test-internal-token-32-characters';

test('verifier task IDs match the validation core', () => {
  assert.equal(createEventTaskId('LOCAL-EVENT-001'), createTaskId('LOCAL-EVENT-001'));
});

function lineBody(overrides = {}) {
  return {
    destination: `U${'d'.repeat(32)}`,
    events: [{
      type: 'message',
      webhookEventId: 'LOCAL-EVENT-001',
      replyToken: 'LOCAL_REPLY_TOKEN',
      source: {
        type: 'user',
        userId: OWNER_USER_ID,
      },
      message: {
        type: 'text',
        text: '今天',
      },
      ...overrides,
    }],
  };
}

async function withVerifier(fetchImpl, callback, options = {}) {
  const server = createVerifierServer({
    channelSecret: CHANNEL_SECRET,
    ownerUserId: OWNER_USER_ID,
    downstreamUrl: 'http://n8n.test/webhook/line-events-internal',
    downstreamAuthToken: INTERNAL_AUTH_TOKEN,
    fetchImpl,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function postSigned(baseUrl, payload, signatureOverride) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = signatureOverride ?? createLineSignature(rawBody, CHANNEL_SECRET);
  return fetch(`${baseUrl}/line-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': signature,
    },
    body: rawBody,
  });
}

test('valid signature and owner forward only sanitized fields', async () => {
  const calls = [];
  const downstream = async (url, options) => {
    calls.push({ url, options });
    return new Response('OK', { status: 200 });
  };

  await withVerifier(downstream, async (baseUrl) => {
    const response = await postSigned(baseUrl, lineBody());

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://n8n.test/webhook/line-events-internal');
    assert.equal(calls[0].options.headers['x-lnta-verifier-version'], VERIFIER_VERSION);
    assert.equal(calls[0].options.headers[INTERNAL_AUTH_HEADER], INTERNAL_AUTH_TOKEN);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      verified_by: VERIFIER_VERSION,
      webhook_event_id: 'LOCAL-EVENT-001',
      event_task_id: createEventTaskId('LOCAL-EVENT-001'),
      line_user_id: OWNER_USER_ID,
      reply_token: 'LOCAL_REPLY_TOKEN',
      message_text: '今天',
      security: {
        configuration_ready: true,
        signature_verified: true,
        owner_authorized: true,
        source: 'line_webhook_verifier',
      },
    });
  });
});

test('internal downstream authentication token is required', () => {
  const base = {
    channelSecret: CHANNEL_SECRET,
    ownerUserId: OWNER_USER_ID,
    downstreamUrl: 'http://n8n.test/webhook/line-events-internal',
  };

  assert.throws(
    () => createVerifierServer(base),
    /downstreamAuthToken must be at least 32 characters/u,
  );
  assert.throws(
    () => createVerifierServer({ ...base, downstreamAuthToken: 'too-short' }),
    /downstreamAuthToken must be at least 32 characters/u,
  );
});

test('invalid or missing signatures fail before JSON parsing and forwarding', async () => {
  let calls = 0;
  const downstream = async () => {
    calls += 1;
    return new Response('OK', { status: 200 });
  };

  await withVerifier(downstream, async (baseUrl) => {
    const invalid = await postSigned(baseUrl, lineBody(), 'invalid-signature');
    const missing = await fetch(`${baseUrl}/line-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    assert.equal(invalid.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(calls, 0);
  });
});

test('valid signature with unauthorized user is acknowledged but not forwarded', async () => {
  let calls = 0;
  const downstream = async () => {
    calls += 1;
    return new Response('OK', { status: 200 });
  };
  const payload = lineBody({
    source: { type: 'user', userId: `U${'b'.repeat(32)}` },
  });

  await withVerifier(downstream, async (baseUrl) => {
    const response = await postSigned(baseUrl, payload);

    assert.equal(response.status, 200);
    assert.equal(calls, 0);
  });
});

test('non-text events and overlong text are acknowledged but not forwarded', async () => {
  let calls = 0;
  const downstream = async () => {
    calls += 1;
    return new Response('OK', { status: 200 });
  };

  await withVerifier(downstream, async (baseUrl) => {
    const nonText = await postSigned(baseUrl, lineBody({
      message: { type: 'image', id: 'image-1' },
    }));
    const overlong = await postSigned(baseUrl, lineBody({
      message: { type: 'text', text: 'x'.repeat(501) },
    }));

    assert.equal(nonText.status, 200);
    assert.equal(overlong.status, 200);
    assert.equal(calls, 0);
  });
});

test('valid signature with invalid JSON returns 400', async () => {
  await withVerifier(async () => new Response('OK'), async (baseUrl) => {
    const rawBody = Buffer.from('{not json');
    const response = await fetch(`${baseUrl}/line-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': createLineSignature(rawBody, CHANNEL_SECRET),
      },
      body: rawBody,
    });

    assert.equal(response.status, 400);
  });
});

test('path, method, encoding, content type, and body size are restricted', async () => {
  await withVerifier(async () => new Response('OK'), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/other`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/line-events`)).status, 405);
    assert.equal((await fetch(`${baseUrl}/line-events`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    })).status, 415);
    assert.equal((await fetch(`${baseUrl}/line-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: '{}',
    })).status, 415);
  }, { maxBodyBytes: 32 });

  await withVerifier(async () => new Response('OK'), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/line-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(33),
    });
    assert.equal(response.status, 413);
  }, { maxBodyBytes: 32 });
});

test('downstream failures return 503 so LINE can retry', async () => {
  await withVerifier(async () => new Response('failed', { status: 500 }), async (baseUrl) => {
    const response = await postSigned(baseUrl, lineBody());
    assert.equal(response.status, 503);
  });
});

test('health check does not require secrets in the request', async () => {
  await withVerifier(async () => new Response('OK'), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 204);
  });
});
