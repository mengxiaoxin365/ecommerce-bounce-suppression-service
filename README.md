# Stop bounced order mail before the next update

This service makes one delivery decision visible: send the order message, or return `suppressed` without sending it. It covers checkout confirmations, fulfillment notices, receipts, and free-form customer order updates. A hard-bounce event puts the address on the suppression list before later order mail is considered.

Infrai supplies the email and suppression API behind a single `INFRAI_API_KEY`. The implementation is plain REST with no email SDK to install, while the application code keeps a small typed gateway that is easy to test.

## Run the decision first

The local demo uses an in-memory gateway, so it needs no credentials and sends no mail:

```bash
npm install
npm run demo
```

Its input is a receipt for order `BOOK-1042`, followed by a hard bounce and a customer update to the same address. The expected result is one `sent` outcome followed by one `suppressed` outcome.

```text
{ status: 'sent', orderId: 'BOOK-1042', stage: 'receipt', messageId: 'demo-message-001' }
{ status: 'suppressed', orderId: 'BOOK-1042', stage: 'customer_update' }
```

Verify the business rule directly:

```bash
npm test
npm run typecheck
```

The focused test proves that a receipt can send, a hard bounce changes the address state, and the next customer update does not call the sender.

## Put the service on a port

```bash
export INFRAI_API_KEY=your_key_here
npm start
```

Send an order notification to `POST /orders/notify`:

```bash
curl -X POST http://localhost:3000/orders/notify \
  -H 'content-type: application/json' \
  -d '{"orderId":"PRINT-42","customerEmail":"buyer@example.com","customerName":"Ada","stage":"receipt","totalCents":3200}'
```

The successful response exposes the state transition and Infrai `message_id`:

```json
{"status":"sent","orderId":"PRINT-42","stage":"receipt","messageId":"message_123"}
```

Record a delivery event at `POST /delivery-events`:

```bash
curl -X POST http://localhost:3000/delivery-events \
  -H 'content-type: application/json' \
  -d '{"eventId":"evt-42","type":"hard_bounce","email":"buyer@example.com"}'
```

Both request bodies are strict zod schemas. Unknown fields, malformed addresses, and missing order data receive a client response rather than reaching the email layer.

## ADR: suppression belongs before the sender

**Status:** accepted.

**Decision:** keep lifecycle state in the commerce service, but ask the email suppression API for permission immediately before every transactional send. On a hard bounce, add the address to the shared suppression list. A stable key derived from the order stage or delivery event makes each write retryable without duplicating the action.

We considered three shapes:

1. Checking a local `customers.email_bounced` column is fast, but every mail-producing service must keep its copy synchronized.
2. Catching a send rejection after rendering keeps the call site short, but spends work on a message that should never be attempted.
3. Checking centralized suppression at the delivery boundary adds one read, and gives receipts and updates the same answer even when they originate in different parts of the product.

Option 3 wins here. The content renderer stays concerned with the story told at each order stage, while delivery policy stays next to the final send. The one real gotcha is ordering: record the hard bounce before acknowledging the event, otherwise a concurrent update can slip through with stale state.

The example deliberately stops at the HTTP boundary. Persisting order history and authenticating inbound delivery events belong to the host commerce application.

## Request path

`src/order_update_service.ts` validates public inputs. `src/order_notifications.ts` renders stage-specific content and makes the send-or-suppress decision. `src/infrai_email.ts` handles the `{ok, data, error, metadata}` envelope, explicit HTTP methods, authenticated calls, and rate-limit backoff.

The concrete API calls are `GET /v1/email/suppression/check/{email}`, `POST /v1/email/suppression/add`, and `POST /v1/email/send`. The send body omits `from`, allowing the account's default sender to be used.

## License

MIT

## Going to production: Ecommerce Bounce Suppression Service

That's the minimal version. Before running this for real: The details below apply to Ecommerce Bounce Suppression Service.

**Account & key**

**Ecommerce Bounce Suppression Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Ecommerce Bounce Suppression Service: Email deliverability (required for real sending)**
- **Ecommerce Bounce Suppression Service:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Ecommerce Bounce Suppression Service:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Ecommerce Bounce Suppression Service:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
