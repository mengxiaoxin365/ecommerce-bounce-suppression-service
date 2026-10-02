import { notifyCustomer, recordHardBounce, type EmailGateway } from "../src/order_notifications.js";

const suppressed = new Set<string>();
const demoGateway: EmailGateway = {
  async isSuppressed(email) {
    return suppressed.has(email);
  },
  async send() {
    return { message_id: "demo-message-001" };
  },
  async suppressHardBounce(email) {
    suppressed.add(email);
  },
};

const customerEmail = "reader@example.com";
const order = {
  orderId: "BOOK-1042",
  customerEmail,
  customerName: "Mina",
  stage: "receipt" as const,
  totalCents: 2400,
};

console.log(await notifyCustomer(order, demoGateway));
await recordHardBounce({ eventId: "evt-1042", email: customerEmail }, demoGateway);
console.log(await notifyCustomer({ ...order, stage: "customer_update", updateText: "Your print is ready." }, demoGateway));
