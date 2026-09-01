export const AUTH_STAGES = Object.freeze([
  "transport",
  "qr_request",
  "qr_poll",
  "manual_auth",
  "initial_sync",
]);

export function buildAuthReadiness(transportResult, webQrResult) {
  const transportVerified =
    transportResult?.transportHandshake === true &&
    transportResult?.serverSignatureVerified === true &&
    transportResult?.encryptedHeartbeat === true;

  return {
    standaloneTransport: transportVerified ? "verified" : "unverified",
    personalAccountAuthentication: "not_attempted",
    completedStages: transportVerified ? ["transport"] : [],
    nextStage:
      webQrResult?.challengeIssued === true
        ? "disposable_test_account_scan"
        : "native_qr_request",
    candidatePaths: {
      nativeMmtls: {
        qrChallenge: "not_implemented",
        accountAcceptance: "not_attempted",
      },
      legacyWebWechat: {
        qrChallenge:
          webQrResult?.challengeIssued === true ? "verified" : "unverified",
        accountAcceptance: "not_attempted",
        caveat:
          "A live challenge does not prove that a particular account is eligible for Web WeChat.",
      },
    },
    blockers: [
      "Confirm the current get-login-QR protobuf and CGI framing.",
      "Supply a server-accepted device identity without impersonating the desktop app.",
      "Implement QR polling, manual authentication, session persistence, and initial sync.",
    ],
    safety: {
      accountDataUsed: false,
      wechatDesktopRequired: false,
      recommendedLiveAccount: "dedicated disposable test account only",
    },
  };
}
