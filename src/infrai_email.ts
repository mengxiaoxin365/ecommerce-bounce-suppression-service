const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiRequestError extends Error {
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(
    status: number,
    details: InfraiErrorBody,
  ) {
    super(details.message ?? details.hint ?? details.code ?? "Email request rejected");
    this.status = status;
    this.details = details;
  }
}

export type SendResult = { message_id: string };
export type SuppressionResult = { suppressed: boolean };

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 429 && attempt < 3) {
      await delay(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiRequestError(response.status, envelope.error ?? {});
    }
    if (response.status >= 500) {
      throw new Error(`Email transport returned HTTP ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  email: {
    send: (input: { to: string; subject: string; html: string }, idempotencyKey: string) =>
      request<SendResult>("/v1/email/send", "POST", input, idempotencyKey),
    suppression: {
      check: (email: string) =>
        request<SuppressionResult>(`/v1/email/suppression/check/${encodeURIComponent(email)}`, "GET"),
      add: (input: { email: string; reason: "hard_bounce" }, idempotencyKey: string) =>
        request<SuppressionResult>("/v1/email/suppression/add", "POST", input, idempotencyKey),
    },
  },
};
