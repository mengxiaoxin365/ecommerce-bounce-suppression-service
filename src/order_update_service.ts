import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { infrai, InfraiRequestError } from "./infrai_email.js";
import { notifyCustomer, orderStages, recordHardBounce, type EmailGateway } from "./order_notifications.js";

const noticeSchema = z.object({
  orderId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  stage: z.enum(orderStages),
  totalCents: z.number().int().nonnegative(),
  trackingCode: z.string().min(1).optional(),
  updateText: z.string().min(1).optional(),
}).strict();

const bounceSchema = z.object({
  eventId: z.string().min(1),
  type: z.literal("hard_bounce"),
  email: z.string().email(),
}).strict();

const gateway: EmailGateway = {
  async isSuppressed(email) {
    return (await infrai.email.suppression.check(email)).suppressed;
  },
  send(input, key) {
    return infrai.email.send(input, key);
  },
  async suppressHardBounce(email, key) {
    await infrai.email.suppression.add({ email, reason: "hard_bounce" }, key);
  },
};

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/orders/notify") {
      const notice = noticeSchema.parse(await readJson(request));
      json(response, 200, await notifyCustomer(notice, gateway));
      return;
    }
    if (request.method === "POST" && request.url === "/delivery-events") {
      const event = bounceSchema.parse(await readJson(request));
      json(response, 200, await recordHardBounce(event, gateway));
      return;
    }
    json(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "invalid_request", issues: error.issues });
      return;
    }
    if (error instanceof InfraiRequestError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: "email_request_rejected", details: error.details });
      return;
    }
    json(response, 500, { error: "internal_error" });
  }
});

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Order notification service listening on http://localhost:${port}`));
}
