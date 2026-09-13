/** Submission crossed the native boundary, but no authoritative result arrived.
 * This must never be treated as a rejected draft that is safe to resend. */
export class WeChatDeliveryUnconfirmedError extends Error {
  readonly code = "wechat_delivery_unconfirmed";
  constructor(detail?: string) {
    super(detail || "WeChat delivery is unconfirmed. Check WeChat before sending again.");
    this.name = "WeChatDeliveryUnconfirmedError";
  }
}

export function isWeChatDeliveryUnconfirmed(error: unknown): boolean {
  return error instanceof WeChatDeliveryUnconfirmedError || Boolean(error &&
    typeof error === "object" && "code" in error && error.code === "wechat_delivery_unconfirmed") ||
    (error instanceof AggregateError && error.errors.some(isWeChatDeliveryUnconfirmed));
}
