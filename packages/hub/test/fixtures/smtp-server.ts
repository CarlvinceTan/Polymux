import net from "node:net";

/**
 * Just enough SMTP to accept a message.
 *
 * Sending was the one path with no test at all: a fake at the library's edge
 * would only prove nodemailer was called, and the things worth catching —
 * whether the envelope carries the blind recipients, whether the message body
 * still names them — are visible only in what the server is actually told.
 */
export interface FakeSmtpServer {
  port: number;
  /** Every command line the server was sent, in order. */
  commands: string[];
  /** The envelope recipients, from RCPT TO. */
  recipients: string[];
  /** The raw messages accepted, in order. */
  messages: string[];
  close: () => Promise<void>;
}

export async function startSmtpServer(
  options: {rejectAuth?: boolean} = {},
): Promise<FakeSmtpServer> {
  const commands: string[] = [];
  const recipients: string[] = [];
  const messages: string[] = [];

  const server = net.createServer((socket) => {
    let buffer = "";
    /** Set between DATA and the lone dot that ends it. */
    let body: string | null = null;
    const send = (line: string): void => void socket.write(`${line}\r\n`);
    send("220 fake ESMTP ready");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        if (body !== null) {
          // A lone dot ends the message; anything else is another line of it.
          if (line === ".") {
            messages.push(body);
            body = null;
            send("250 2.0.0 accepted");
          } else body += `${line}\r\n`;
          continue;
        }

        commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          // AUTH is advertised so the client offers a credential; without it
          // nodemailer sends the message unauthenticated and proves nothing.
          send("250-fake greets you");
          send("250-AUTH PLAIN LOGIN XOAUTH2");
          send("250 8BITMIME");
        } else if (verb === "AUTH") {
          send(options.rejectAuth ? "535 5.7.8 authentication failed" : "235 2.7.0 accepted");
        } else if (verb === "MAIL") {
          send("250 2.1.0 sender ok");
        } else if (verb === "RCPT") {
          const address = /<([^>]*)>/.exec(line)?.[1];
          if (address) recipients.push(address);
          send("250 2.1.5 recipient ok");
        } else if (verb === "DATA") {
          body = "";
          send("354 go ahead");
        } else if (verb === "QUIT") {
          send("221 2.0.0 bye");
          socket.end();
        } else send("250 2.0.0 ok");
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : 0,
    commands,
    recipients,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
