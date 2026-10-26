'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');

const VERIFIER_VERSION = 'line-webhook-verifier-v1';
const INTERNAL_AUTH_HEADER = 'x-lnta-internal-token';
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TEXT_LIMIT = 500;

function createLineSignature(rawBody, channelSecret) {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

function createEventTaskId(webhookEventId) {
  return `T${createHash('sha256').update(webhookEventId, 'utf8').digest('hex').slice(0, 12).toUpperCase()}`;
}

function hasValidLineSignature(rawBody, suppliedSignature, channelSecret) {
  if (typeof suppliedSignature !== 'string' || suppliedSignature === '') {
    return false;
  }

  const expected = Buffer.from(createLineSignature(rawBody, channelSecret), 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function readRawBody(request, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  return tooLarge ? null : Buffer.concat(chunks);
}

function sanitizeAuthorizedEvents(payload, ownerUserId, textLimit) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    return null;
  }

  const authorized = [];
  for (const event of payload.events) {
    if (event?.type !== 'message'
      || event.message?.type !== 'text'
      || event.source?.type !== 'user'
      || event.source.userId !== ownerUserId) {
      continue;
    }

    const messageText = typeof event.message.text === 'string'
      ? event.message.text.trim()
      : '';
    if (!messageText
      || messageText.length > textLimit
      || typeof event.webhookEventId !== 'string'
      || event.webhookEventId === ''
      || typeof event.replyToken !== 'string'
      || event.replyToken === '') {
      continue;
    }

    authorized.push({
      verified_by: VERIFIER_VERSION,
      webhook_event_id: event.webhookEventId,
      event_task_id: createEventTaskId(event.webhookEventId),
      line_user_id: event.source.userId,
      reply_token: event.replyToken,
      message_text: messageText,
      security: {
        configuration_ready: true,
        signature_verified: true,
        owner_authorized: true,
        source: 'line_webhook_verifier',
      },
    });
  }

  return authorized;
}

function send(response, statusCode, body = '') {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

function createVerifierServer(options) {
  const {
    channelSecret,
    ownerUserId,
    downstreamUrl,
    downstreamAuthToken,
    fetchImpl = fetch,
    logger = console,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    textLimit = DEFAULT_TEXT_LIMIT,
    downstreamTimeoutMs = 5_000,
  } = options;

  if (typeof channelSecret !== 'string' || channelSecret.length < 16) {
    throw new TypeError('channelSecret must be at least 16 characters');
  }
  if (!/^U[0-9a-f]{32}$/iu.test(ownerUserId)) {
    throw new TypeError('ownerUserId must be a LINE user ID');
  }
  if (typeof downstreamUrl !== 'string' || downstreamUrl === '') {
    throw new TypeError('downstreamUrl is required');
  }
  if (typeof downstreamAuthToken !== 'string' || downstreamAuthToken.length < 32) {
    throw new TypeError('downstreamAuthToken must be at least 32 characters');
  }

  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        response.writeHead(204, { 'cache-control': 'no-store' });
        response.end();
        return;
      }

      if (request.url !== '/line-events') {
        send(response, 404, 'Not Found');
        return;
      }
      if (request.method !== 'POST') {
        send(response, 405, 'Method Not Allowed');
        return;
      }
      if (request.headers['content-encoding']) {
        send(response, 415, 'Unsupported Media Type');
        return;
      }
      if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        send(response, 415, 'Unsupported Media Type');
        return;
      }

      const rawBody = await readRawBody(request, maxBodyBytes);
      if (!rawBody) {
        send(response, 413, 'Payload Too Large');
        return;
      }

      const signature = request.headers['x-line-signature'];
      if (!hasValidLineSignature(rawBody, signature, channelSecret)) {
        send(response, 401, 'Unauthorized');
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        send(response, 400, 'Bad Request');
        return;
      }

      const authorizedEvents = sanitizeAuthorizedEvents(payload, ownerUserId, textLimit);
      if (!authorizedEvents) {
        send(response, 400, 'Bad Request');
        return;
      }

      for (const event of authorizedEvents) {
        const downstreamResponse = await fetchImpl(downstreamUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lnta-verifier-version': VERIFIER_VERSION,
            [INTERNAL_AUTH_HEADER]: downstreamAuthToken,
          },
          body: JSON.stringify(event),
          redirect: 'error',
          signal: AbortSignal.timeout(downstreamTimeoutMs),
        });

        if (!downstreamResponse.ok) {
          throw new Error(`downstream returned ${downstreamResponse.status}`);
        }
      }

      send(response, 200, 'OK');
    } catch (error) {
      logger.error('Webhook verification or forwarding failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
      if (!response.headersSent) {
        send(response, 503, 'Service Unavailable');
      } else {
        response.end();
      }
    }
  });
}

function readSecret(path) {
  const value = readFileSync(path, 'utf8').trim();
  if (!value) {
    throw new Error(`Secret file is empty: ${path}`);
  }
  return value;
}

function startFromEnvironment() {
  const channelSecret = readSecret(
    process.env.LINE_CHANNEL_SECRET_FILE ?? '/run/secrets/line_channel_secret',
  );
  const ownerUserId = readSecret(
    process.env.LINE_OWNER_USER_ID_FILE ?? '/run/secrets/line_owner_user_id',
  );
  const downstreamUrl = process.env.LINE_DOWNSTREAM_URL
    ?? 'http://n8n:5678/webhook/line-events-internal';
  const downstreamAuthToken = readSecret(
    process.env.N8N_INTERNAL_WEBHOOK_TOKEN_FILE ?? '/run/secrets/n8n_internal_webhook_token',
  );
  const port = Number(process.env.PORT ?? 3000);

  const server = createVerifierServer({
    channelSecret,
    ownerUserId,
    downstreamUrl,
    downstreamAuthToken,
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`LINE webhook verifier listening on port ${port}`);
  });
}

if (require.main === module) {
  startFromEnvironment();
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  INTERNAL_AUTH_HEADER,
  VERIFIER_VERSION,
  createEventTaskId,
  createLineSignature,
  createVerifierServer,
  hasValidLineSignature,
  sanitizeAuthorizedEvents,
};
