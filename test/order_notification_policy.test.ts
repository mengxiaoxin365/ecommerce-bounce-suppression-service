import assert from "node:assert/strict";
import test from "node:test";
import { notifyCustomer, recordHardBounce, type EmailGateway } from "../src/order_notifications.js";

test("a hard bounce suppresses the next order update", async () => {
  const suppressed = new Set<string>();
  let sends = 0;
  const gateway: EmailGateway = {
    async isSuppressed(email) {
      return suppressed.has(email);
    },
    async send() {
      sends += 1;
      return { message_id: `message-${sends}` };
    },
    async suppressHardBounce(email) {
      suppressed.add(email);
    },
  };

  const base = {
    orderId: "PRINT-42",
    customerEmail: "creator@example.com",
    customerName: "Ada",
    totalCents: 3200,
  };

  const receipt = await notifyCustomer({ ...base, stage: "receipt" }, gateway);
  await recordHardBounce({ eventId: "event-9", email: base.customerEmail }, gateway);
  const update = await notifyCustomer({ ...base, stage: "customer_update", updateText: "Packed" }, gateway);

  assert.deepEqual(receipt, { status: "sent", orderId: "PRINT-42", stage: "receipt", messageId: "message-1" });
  assert.deepEqual(update, { status: "suppressed", orderId: "PRINT-42", stage: "customer_update" });
  assert.equal(sends, 1);
});
