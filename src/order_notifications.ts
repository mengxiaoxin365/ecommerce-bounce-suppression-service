export const orderStages = ["checkout", "fulfillment", "receipt", "customer_update"] as const;
export type OrderStage = (typeof orderStages)[number];

export type OrderNotice = {
  orderId: string;
  customerEmail: string;
  customerName: string;
  stage: OrderStage;
  totalCents: number;
  trackingCode?: string;
  updateText?: string;
};

export type EmailGateway = {
  isSuppressed(email: string): Promise<boolean>;
  send(input: { to: string; subject: string; html: string }, key: string): Promise<{ message_id: string }>;
  suppressHardBounce(email: string, key: string): Promise<void>;
};

export type NotificationOutcome =
  | { status: "sent"; orderId: string; stage: OrderStage; messageId: string }
  | { status: "suppressed"; orderId: string; stage: OrderStage };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] as string);
}

export function renderOrderEmail(notice: OrderNotice): { subject: string; html: string } {
  const order = escapeHtml(notice.orderId);
  const name = escapeHtml(notice.customerName);
  const amount = (notice.totalCents / 100).toFixed(2);

  switch (notice.stage) {
    case "checkout":
      return { subject: `Order ${notice.orderId} received`, html: `<h1>Thanks, ${name}</h1><p>We received order ${order}.</p>` };
    case "fulfillment":
      return { subject: `Order ${notice.orderId} is on its way`, html: `<h1>Your order shipped</h1><p>Tracking: ${escapeHtml(notice.trackingCode ?? "pending")}</p>` };
    case "receipt":
      return { subject: `Receipt for order ${notice.orderId}`, html: `<h1>Receipt</h1><p>Order ${order}: $${amount}</p>` };
    case "customer_update":
      return { subject: `Update for order ${notice.orderId}`, html: `<h1>Order update</h1><p>${escapeHtml(notice.updateText ?? "Your order is moving forward.")}</p>` };
  }
}

export async function notifyCustomer(
  notice: OrderNotice,
  email: EmailGateway,
): Promise<NotificationOutcome> {
  if (await email.isSuppressed(notice.customerEmail)) {
    return { status: "suppressed", orderId: notice.orderId, stage: notice.stage };
  }

  const content = renderOrderEmail(notice);
  const result = await email.send(
    { to: notice.customerEmail, ...content },
    `order:${notice.orderId}:${notice.stage}`,
  );
  return { status: "sent", orderId: notice.orderId, stage: notice.stage, messageId: result.message_id };
}

export async function recordHardBounce(
  event: { eventId: string; email: string },
  email: EmailGateway,
): Promise<{ status: "suppressed"; email: string }> {
  await email.suppressHardBounce(event.email, `bounce:${event.eventId}`);
  return { status: "suppressed", email: event.email };
}
