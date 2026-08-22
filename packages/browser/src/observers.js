// Passive per-page observation: buffered console output, uncaught exceptions,
// network requests, and pending JavaScript dialogs.
//
// These are the capabilities that only exist once the debugger is attached,
// and they are all buffers rather than commands: the agent asks for what has
// accumulated since the session opened, so a page error that happened three
// actions ago is still there to explain the failure in front of it.

const MAX_CONSOLE = 500;
const MAX_REQUESTS = 300;
const MAX_BODY_CHARS = 4_000;

export class PageObservers {
  #transport;
  #disposers = [];
  console = [];
  errors = [];
  requests = [];
  /** The dialog currently blocking the page, if any. */
  dialog = null;

  /** @param {{enableDomain(domain: string): Promise<void>, onEvent(method: string, listener: (params: any) => void): () => void, send(method: string, params?: object): Promise<any>}} transport */
  constructor(transport) {
    this.#transport = transport;
  }

  async start() {
    const { enableDomain, onEvent } = this.#transport;
    for (const domain of ["Runtime", "Log", "Page", "Network", "DOM"])
      await enableDomain(domain);

    this.#disposers.push(
      onEvent("Runtime.consoleAPICalled", (params) => {
        this.#pushConsole({
          level: params.type ?? "log",
          text: (params.args ?? []).map(describeRemoteObject).join(" "),
          timestamp: params.timestamp,
        });
      }),
      onEvent("Log.entryAdded", (params) => {
        const entry = params.entry ?? {};
        this.#pushConsole({
          level: entry.level ?? "log",
          text: entry.text ?? "",
          url: entry.url,
          line: entry.lineNumber,
          timestamp: entry.timestamp,
        });
      }),
      onEvent("Runtime.exceptionThrown", (params) => {
        const details = params.exceptionDetails ?? {};
        const text =
          details.exception?.description ?? details.text ?? "Uncaught exception";
        this.errors.push({
          text,
          url: details.url,
          line: details.lineNumber,
          timestamp: params.timestamp,
        });
        if (this.errors.length > MAX_CONSOLE) this.errors.shift();
      }),
      onEvent("Network.requestWillBeSent", (params) => {
        const request = {
          id: params.requestId,
          url: params.request?.url ?? "",
          method: params.request?.method ?? "GET",
          type: params.type ?? "Other",
          status: null,
          mimeType: null,
        };
        const previous = this.requests.findIndex((item) => item.id === params.requestId);
        if (previous >= 0) this.requests[previous] = request;
        else {
          this.requests.push(request);
          if (this.requests.length > MAX_REQUESTS) this.requests.shift();
        }
      }),
      onEvent("Network.responseReceived", (params) => {
        const request = this.requests.find((item) => item.id === params.requestId);
        if (!request) return;
        request.status = params.response?.status ?? null;
        request.mimeType = params.response?.mimeType ?? null;
        request.type = params.type ?? request.type;
      }),
      onEvent("Network.loadingFailed", (params) => {
        const request = this.requests.find((item) => item.id === params.requestId);
        if (request) request.error = params.errorText ?? "failed";
      }),
      // Page dialogs block the renderer until handled. With the Page domain
      // enabled Chrome suppresses the native dialog, so if nothing answers it
      // the tab is wedged — which is why the pending dialog is surfaced in
      // every command error rather than only on request.
      onEvent("Page.javascriptDialogOpening", (params) => {
        this.dialog = {
          type: params.type ?? "alert",
          message: params.message ?? "",
          defaultPrompt: params.defaultPrompt,
        };
      }),
      onEvent("Page.javascriptDialogClosed", () => {
        this.dialog = null;
      }),
    );
  }

  stop() {
    for (const dispose of this.#disposers) dispose();
    this.#disposers = [];
  }

  #pushConsole(entry) {
    this.console.push(entry);
    if (this.console.length > MAX_CONSOLE) this.console.shift();
  }

  clearConsole() {
    this.console = [];
    this.errors = [];
  }

  clearRequests() {
    this.requests = [];
  }

  /** Full request/response detail, including the body when it is text. */
  async requestDetail(requestId) {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request) return null;
    let body = null;
    try {
      const response = await this.#transport.send("Network.getResponseBody", {
        requestId,
      });
      body = response.base64Encoded
        ? "[binary body omitted]"
        : String(response.body ?? "").slice(0, MAX_BODY_CHARS);
    } catch (error) {
      // Bodies are evicted quickly and are unavailable for some request types;
      // that is expected, not an error worth failing the command over.
      body = `[body unavailable: ${error instanceof Error ? error.message : String(error)}]`;
    }
    return { ...request, body };
  }
}

function describeRemoteObject(argument) {
  if (argument === null || argument === undefined) return "";
  if ("value" in argument) return formatValue(argument.value);
  if (argument.description) return argument.description;
  if (argument.preview?.properties)
    return `{${argument.preview.properties
      .map((property) => `${property.name}: ${property.value}`)
      .join(", ")}}`;
  return argument.type ?? "";
}

function formatValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
