import { createServer } from 'node:http';
import { normalizeAny } from './normalize.js';
import { verifyIntuitSignature } from './verify-signature.js';

/**
 * Minimal webhook receiver demonstrating the migration-safe pattern:
 * accept BOTH payload formats, validate the signature over the raw bytes,
 * and treat "unknown format" as an alarm — not as an empty delivery.
 *
 * Run:   npm run receiver
 * Then:  POST fixture payloads at it (see failures/01-cloudevents-migration/README.md)
 *
 * The three counters printed on every request are the whole observability
 * story in miniature: if `unknown` ever moves, or `eventsProcessed` flatlines
 * while your business is active, you are dropping changes.
 */

const PORT = Number(process.env.PORT ?? 3000);
const VERIFIER_TOKEN = process.env.WEBHOOK_VERIFIER_TOKEN ?? '';

const counters = {
  deliveries: 0,
  eventsProcessed: 0,
  unknownFormat: 0,
  badSignature: 0,
};

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, counters }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    counters.deliveries += 1;

    if (VERIFIER_TOKEN) {
      const signature = req.headers['intuit-signature'];
      const ok = verifyIntuitSignature(rawBody, typeof signature === 'string' ? signature : undefined, VERIFIER_TOKEN);
      if (!ok) {
        counters.badSignature += 1;
        console.warn(`[reject] bad or missing intuit-signature (${counters.badSignature} total)`);
        // Respond 200 anyway? No — a bad signature is not our payload to ack.
        res.writeHead(401).end();
        return;
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      body = undefined;
    }

    const { format, events } = normalizeAny(body);

    if (format === 'unknown') {
      // The single most important line in this file. A parser that silently
      // returns [] here is how integrations lose weeks of changes.
      counters.unknownFormat += 1;
      console.error(`[ALARM] unrecognized webhook payload format (${counters.unknownFormat} total) — investigate before acking more`);
    } else {
      counters.eventsProcessed += events.length;
      for (const event of events) {
        console.log(
          `[${format}] realm=${event.realmId} ${event.entity}#${event.entityId} ${event.operation} at ${event.occurredAt}`,
        );
      }
    }

    console.log(`counters: ${JSON.stringify(counters)}`);
    // Ack fast; do real work (the follow-up entity read) off the request path.
    res.writeHead(200).end();
  });
});

server.listen(PORT, () => {
  console.log(`webhook receiver listening on http://localhost:${PORT}/webhooks`);
  console.log(VERIFIER_TOKEN ? 'signature validation: ON' : 'signature validation: OFF (set WEBHOOK_VERIFIER_TOKEN to enable)');
});
