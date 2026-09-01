const LOGIN_ORIGIN = "https://login.weixin.qq.com";
const WEB_APP_ID = "wx782c26e4c19acffb";
const REDIRECT_URI = "https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage";
const JPEG_SIGNATURE = Buffer.from("ffd8ff", "hex");

export function parseQrLoginChallenge(body) {
  const match = body.match(
    /^window\.QRLogin\.code\s*=\s*(\d+)\s*;\s*window\.QRLogin\.uuid\s*=\s*"([A-Za-z0-9_+=-]+)"\s*;?\s*$/,
  );
  if (!match)
    throw new Error("WeChat returned an unknown QR challenge response");
  const code = Number(match[1]);
  if (code !== 200)
    throw new Error(`WeChat rejected the QR challenge (${code})`);
  return match[2];
}

export function parseQrLoginStatus(body) {
  const codeMatch = body.match(/window\.code\s*=\s*(\d+)\s*;/);
  if (!codeMatch) throw new Error("WeChat returned an unknown login status");

  const code = Number(codeMatch[1]);
  const states = new Map([
    [200, "approved"],
    [201, "scanned"],
    [400, "expired"],
    [408, "waiting"],
  ]);
  const state = states.get(code) ?? "rejected";
  const redirectMatch = body.match(/window\.redirect_uri\s*=\s*"([^"]+)"\s*;/);

  if (code === 200 && !redirectMatch) {
    throw new Error("Approved login response did not contain a redirect URI");
  }

  return {
    code,
    state,
    redirectUri: redirectMatch?.[1],
  };
}

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

export async function createWebQrChallenge({
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const challengeUrl = new URL("/jslogin", LOGIN_ORIGIN);
  challengeUrl.searchParams.set("appid", WEB_APP_ID);
  challengeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  challengeUrl.searchParams.set("fun", "new");
  challengeUrl.searchParams.set("lang", "en_US");
  challengeUrl.searchParams.set("_", String(Date.now()));

  const challengeResponse = await fetchImpl(challengeUrl, {
    redirect: "error",
    signal: timeoutSignal(timeoutMs),
  });
  if (!challengeResponse.ok) {
    throw new Error(
      `WeChat QR challenge returned HTTP ${challengeResponse.status}`,
    );
  }
  const uuid = parseQrLoginChallenge(await challengeResponse.text());

  // The service expects its URL-safe base64 padding literally in the path.
  // Percent-encoding the trailing '=' characters returns an empty 200 body.
  const imageUrl = new URL(`/qrcode/${uuid}`, LOGIN_ORIGIN);
  const imageResponse = await fetchImpl(imageUrl, {
    redirect: "error",
    signal: timeoutSignal(timeoutMs),
  });
  if (!imageResponse.ok) {
    throw new Error(`WeChat QR image returned HTTP ${imageResponse.status}`);
  }
  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (
    image.length < JPEG_SIGNATURE.length ||
    !image.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    throw new Error("WeChat QR endpoint did not return a JPEG image");
  }

  return { uuid, image };
}

export async function requestWebQrChallenge(options = {}) {
  const { image } = await createWebQrChallenge(options);
  return {
    endpoint: LOGIN_ORIGIN,
    challengeIssued: true,
    qrImageValidated: true,
    qrImageBytes: image.length,
    accountAuthenticationAttempted: false,
    accountEligibilityVerified: false,
  };
}

export async function pollWebQrLogin({
  uuid,
  tip = 1,
  fetchImpl = fetch,
  timeoutMs = 35_000,
} = {}) {
  if (!/^[A-Za-z0-9_+=-]+$/.test(uuid ?? "")) {
    throw new Error("Invalid WeChat QR challenge UUID");
  }

  const pollUrl = new URL("/cgi-bin/mmwebwx-bin/login", LOGIN_ORIGIN);
  pollUrl.searchParams.set("loginicon", "true");
  pollUrl.searchParams.set("uuid", uuid);
  pollUrl.searchParams.set("tip", String(tip));
  pollUrl.searchParams.set("r", String(~Date.now()));
  pollUrl.searchParams.set("_", String(Date.now()));

  const response = await fetchImpl(pollUrl, {
    redirect: "error",
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`WeChat login poll returned HTTP ${response.status}`);
  }
  return parseQrLoginStatus(await response.text());
}
