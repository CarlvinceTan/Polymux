#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isIP } from "node:net";

import { createMmtlsSession } from "./mmtls.mjs";
import { requestShortMmtls } from "./mmtls-short.mjs";
import {
  NATIVE_MANUAL_AUTH_CGI,
  NATIVE_MANUAL_AUTH_PATH,
  NATIVE_QR_CHECK_CGI,
  NATIVE_QR_CHECK_PATH,
  NATIVE_QR_PATH,
  buildNativeBusinessPacket,
  buildNativeQrCheckProtobuf,
  buildSecManualAuthProtobuf,
  hybridEncryptNativeRequest,
  parseNativeQrCheckResponse,
  parseNativeQrResponse,
  parseSecManualAuthResponse,
  prepareNativeQrRequest,
  unpackNativeBusinessResponse,
} from "./native-auth.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function calculateRqtxInAirgap(container, md5) {
  if (!/^polymux-rqtx-[a-z0-9-]+$/.test(container)) {
    throw new Error("The diagnostic container name is not permitted");
  }
  const network = execFileSync(
    "docker",
    ["inspect", "--format", "{{.HostConfig.NetworkMode}}", container],
    { encoding: "utf8" },
  ).trim();
  if (network !== "none") {
    throw new Error(
      "Refusing to use an RQTX diagnostic container with networking",
    );
  }
  const output = execFileSync(
    "docker",
    ["exec", "-w", "/work", container, "./rqtx_probe", md5],
    { encoding: "utf8" },
  ).trim();
  if (!/^\d+$/.test(output))
    throw new Error("RQTX oracle returned invalid output");
  const value = Number(output);
  if (!Number.isSafeInteger(value) || value > 0xffffffff) {
    throw new Error("RQTX oracle returned an out-of-range value");
  }
  return value;
}

function generateDeviceAttestation(container, deviceId, userNameLength) {
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-e",
      "LD_LIBRARY_PATH=/work:/work/lib",
      "-w",
      "/work",
      container,
      "./attestation-probe",
      deviceId.toString("hex"),
      String(userNameLength),
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const jsonStart = output.lastIndexOf('{"extSpamHex"');
  if (jsonStart === -1) {
    throw new Error("Device attestation helper returned invalid output");
  }
  const parsed = JSON.parse(output.slice(jsonStart));
  return {
    extSpam: Buffer.from(parsed.extSpamHex, "hex"),
    imei: parsed.imei,
    softType: parsed.softType,
    clientSeq: parsed.clientSeq,
    adSource: parsed.adSource,
  };
}

async function sendNativeRequest({
  container,
  session,
  shortHost,
  path,
  cgi,
  protobuf,
  trustedServerRedirect = false,
}) {
  const hybrid = hybridEncryptNativeRequest(protobuf);
  const md5 = createHash("md5").update(hybrid.encrypted).digest("hex");
  const rqtx = calculateRqtxInAirgap(container, md5);
  const packet = buildNativeBusinessPacket({
    encrypted: hybrid.encrypted,
    plaintextLength: protobuf.length,
    rqtx,
    cgi,
  });
  const response = await requestShortMmtls({
    session,
    host: shortHost,
    path,
    body: packet,
    trustedServerRedirect,
  });
  return unpackNativeBusinessResponse(response, hybrid.state);
}

function encodeTicket(ticket) {
  return {
    ticketType: ticket.ticketType,
    lifetime: ticket.lifetime,
    ageAdd: ticket.ageAdd.toString("base64"),
    reserved: ticket.reserved,
    nonce: ticket.nonce.toString("base64"),
    ticket: ticket.ticket.toString("base64"),
  };
}

export function normalizeWeChatRedirect(value) {
  let host = String(value ?? "")
    .replaceAll("\0", "")
    .trim();
  if (host.startsWith("http://") || host.startsWith("https://")) {
    host = new URL(host).hostname;
  }
  host = host.split("/")[0];
  if (host.startsWith("[") && host.includes("]")) {
    host = host.slice(1, host.indexOf("]"));
  } else {
    const port = host.match(/^(.*):(\d+)$/);
    if (port) host = port[1];
  }
  return host.replace(/\.$/, "");
}

function isPermittedWeChatRedirect(host) {
  return (
    isIP(host) !== 0 ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.weixin\.qq\.com$/i.test(host)
  );
}

if (!process.argv.includes("--live")) {
  console.error(
    "Refusing to contact WeChat without --live. This diagnostic requests an anonymous native QR but never polls or authenticates it.",
  );
  process.exitCode = 2;
} else {
  const container = argumentValue("--rqtx-airgap");
  if (!container) {
    console.error(
      "A network-disabled --rqtx-airgap container is required until the current integrity transform has a clean-room implementation.",
    );
    process.exitCode = 2;
  } else {
    try {
      let shortHost = argumentValue("--short-host");
      let { session } = await createMmtlsSession();
      const prepared = prepareNativeQrRequest();
      const rqtx = calculateRqtxInAirgap(container, prepared.rqtxInputMd5);
      const packet = buildNativeBusinessPacket({
        encrypted: prepared.encrypted,
        plaintextLength: prepared.protobuf.length,
        rqtx,
      });
      const response = await requestShortMmtls({
        session,
        host: shortHost,
        path: NATIVE_QR_PATH,
        body: packet,
      });
      const unpacked = unpackNativeBusinessResponse(
        response,
        prepared.hybridState,
      );
      const qr = parseNativeQrResponse(unpacked.protobuf);
      let outputDirectory;
      let qrImagePath;
      if (qr.ret === 0 && qr.qrImage?.length > 0 && qr.uuid) {
        outputDirectory = await mkdtemp(
          join(tmpdir(), "polymux-wechat-native-qr-"),
        );
        await chmod(outputDirectory, 0o700);
        qrImagePath = join(outputDirectory, "wechat-native-login.jpg");
        await writeFile(qrImagePath, qr.qrImage, { mode: 0o600 });
      }
      console.log(
        JSON.stringify(
          {
            nativeQrChallenge: qrImagePath ? "verified" : "rejected",
            serverRet: qr.ret,
            serverMessage: qr.errorMessage || undefined,
            qrImagePath,
            expiresInSeconds: qr.expiresInSeconds,
            authenticationAttempted: false,
            integrityBoundary:
              "RQTX calculated from an MD5 digest only inside a network-disabled diagnostic container; no account data or session key entered it.",
          },
          null,
          2,
        ),
      );
      if (!qrImagePath) {
        process.exitCode = 1;
      } else if (process.argv.includes("--poll")) {
        const deadline = Date.now() + (qr.expiresInSeconds ?? 240) * 1000;
        let lastState;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          const checkRequest = buildNativeQrCheckProtobuf({
            deviceId: prepared.deviceId,
            randomKey: prepared.randomKey,
            uuid: qr.uuid,
          });
          const checkResponse = await sendNativeRequest({
            container,
            session,
            shortHost,
            path: NATIVE_QR_CHECK_PATH,
            cgi: NATIVE_QR_CHECK_CGI,
            protobuf: checkRequest,
          });
          const check = parseNativeQrCheckResponse(
            checkResponse.protobuf,
            qr.notifyKey,
          );
          if (check.ret !== 0) {
            throw new Error(
              `Native QR polling failed with ${check.ret}${check.errorMessage ? `: ${check.errorMessage}` : ""}`,
            );
          }
          if (check.state !== lastState) {
            console.log(
              JSON.stringify({
                nativeQrState: check.state,
                serverRet: check.ret,
              }),
            );
            lastState = check.state;
          }
          if (check.state === "approved") {
            let attestation = generateDeviceAttestation(
              container,
              prepared.deviceId,
              check.account.userName.length,
            );
            let manualRequest = buildSecManualAuthProtobuf({
              deviceId: prepared.deviceId,
              userName: check.account.userName,
              password: check.account.password,
              attestation,
            });
            let manualResponse = await sendNativeRequest({
              container,
              session,
              shortHost,
              path: NATIVE_MANUAL_AUTH_PATH,
              cgi: NATIVE_MANUAL_AUTH_CGI,
              protobuf: manualRequest.protobuf,
            });
            let established = parseSecManualAuthResponse(
              manualResponse.protobuf,
              manualRequest.p224Ecdh,
            );
            if (established.ret === -301) {
              const redirectHost = established.shortLinkRedirects
                .map(normalizeWeChatRedirect)
                .find(isPermittedWeChatRedirect);
              if (!redirectHost) {
                throw new Error(
                  "WeChat requested a regional retry without returning a short-link host",
                );
              }
              shortHost = redirectHost;
              console.log(
                JSON.stringify({
                  nativeAuthRedirect: "server_assigned",
                  shortHost,
                }),
              );
              attestation = generateDeviceAttestation(
                container,
                prepared.deviceId,
                check.account.userName.length,
              );
              manualRequest = buildSecManualAuthProtobuf({
                deviceId: prepared.deviceId,
                userName: check.account.userName,
                password: check.account.password,
                attestation,
              });
              try {
                manualResponse = await sendNativeRequest({
                  container,
                  session,
                  shortHost,
                  path: NATIVE_MANUAL_AUTH_PATH,
                  cgi: NATIVE_MANUAL_AUTH_CGI,
                  protobuf: manualRequest.protobuf,
                  trustedServerRedirect: true,
                });
              } catch (error) {
                if (!error.message.includes("MMTLS response")) throw error;
                console.log(
                  JSON.stringify({
                    nativeAuthTransport: "refreshing_after_redirect",
                  }),
                );
                ({ session } = await createMmtlsSession({
                  host: shortHost,
                  transport: "http",
                  trustedServerRedirect: true,
                }));
                manualResponse = await sendNativeRequest({
                  container,
                  session,
                  shortHost,
                  path: NATIVE_MANUAL_AUTH_PATH,
                  cgi: NATIVE_MANUAL_AUTH_CGI,
                  protobuf: manualRequest.protobuf,
                  trustedServerRedirect: true,
                });
              }
              established = parseSecManualAuthResponse(
                manualResponse.protobuf,
                manualRequest.p224Ecdh,
              );
            }
            if (!established.established) {
              throw new Error(
                `Native session establishment failed with ${established.ret}${established.errorMessage ? `: ${established.errorMessage}` : ""}`,
              );
            }
            const sessionStatePath = join(
              outputDirectory,
              "native-session.json",
            );
            await writeFile(
              sessionStatePath,
              JSON.stringify(
                {
                  version: 1,
                  createdAt: new Date().toISOString(),
                  shortHost,
                  deviceId: prepared.deviceId.toString("base64"),
                  transport: {
                    pskAccess: session.pskAccess.toString("base64"),
                    tickets: session.tickets.map(encodeTicket),
                  },
                  account: {
                    uin: established.uin,
                    userName: established.account.userName,
                    nickName: established.account.nickName,
                    alias: established.account.alias,
                  },
                  authentication: {
                    cookies: manualResponse.cookies.toString("base64"),
                    sessionKey: established.sessionKey.toString("base64"),
                    encryptedSessionKey:
                      established.encryptedSessionKey.toString("base64"),
                    autoAuthKey:
                      established.autoAuthKey?.toString("base64") ?? "",
                    clientSessionKey:
                      established.clientSessionKey?.toString("base64") ?? "",
                    serverSessionKey:
                      established.serverSessionKey?.toString("base64") ?? "",
                    loginEcdhKey: established.loginEcdhKey.toString("base64"),
                  },
                },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            console.log(
              JSON.stringify({
                nativeQrApproval: "verified",
                sessionEstablished: true,
                sessionStatePath,
                accountIdentifiersPrinted: false,
                nextBoundary: "initial_sync",
              }),
            );
            break;
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("Native QR expired before phone approval");
        }
      }
    } catch (error) {
      console.error(`Standalone native QR probe failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
