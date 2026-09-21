import {
  accountAvailable,
  canOAuth,
  createDeviceSession,
  desktopVaultUnavailableReason,
  getAccount,
  vaultRequest,
  preferDesktopLoopback,
  pullDeviceCloud,
  pushCachedVault,
  signInWithOAuth,
  signInWithPassword,
  signOutAccount,
  syncCachedVault,
  syncDeviceCloud,
} from "./api.js";

const root = document.getElementById("root");
let session = null;
let screen = "vault";

function page(html) {
  const availability = desktopVaultUnavailableReason();
  root.innerHTML = html + (availability ? `<p class="hint">${escape(availability)}</p>` : "");
}

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab ?? {};
}

async function tabPage(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, {type: "polymux:vault-page-query"});
  } catch {
    return null;
  }
}

async function fillTab(tabId, fields) {
  if (!Number.isInteger(tabId)) return false;
  const result = await chrome.tabs.sendMessage(tabId, {type: "polymux:vault-fill", ...fields});
  return result?.ok === true;
}

async function deviceSession() {
  if (session) return session;
  const next = createDeviceSession();
  await next.hydrate();
  session = next;
  return session;
}

function accountStrip(status) {
  if (!status.available && !status.signedIn) return "";
  if (status.signedIn) {
    const email = status.profile?.email || status.profile?.name || "Signed in";
    return `
      <div class="account">
        <span class="email" title="${escape(email)}">${escape(email)}</span>
        <button type="button" class="quiet" id="sign-out">Sign out</button>
      </div>`;
  }
  return `
    <div class="account">
      <button type="button" class="quiet" id="show-sign-in">Sign in</button>
    </div>`;
}

function bindAccount(status) {
  document.getElementById("show-sign-in")?.addEventListener("click", () => {
    screen = "sign-in";
    void render();
  });
  document.getElementById("sign-out")?.addEventListener("click", async () => {
    await signOutAccount();
    screen = "vault";
    await render();
  });
  if (!status.signedIn) return;
}

async function accountStatus() {
  const account = await getAccount();
  return account?.status() ?? {signedIn: false, available: accountAvailable(), profile: null};
}

function unlockForm(title, hint, status) {
  page(`
    <h1>${escape(title)}</h1>
    <form id="unlock">
      <label>Master password <input id="password" type="password" autocomplete="current-password" /></label>
      <button type="submit">Unlock</button>
      <p id="error" class="error" hidden></p>
    </form>
    ${hint ? `<p class="hint">${escape(hint)}</p>` : ""}
    ${accountStrip(status)}
  `);
  bindAccount(status);
}

async function renderSignIn(status) {
  const oauth = canOAuth();
  page(`
    <div class="toolbar">
      <h1>Sign in</h1>
      <button type="button" class="quiet" id="back">Back</button>
    </div>
    ${oauth ? `
      <div class="providers">
        <button type="button" class="secondary" id="google">Google</button>
        <button type="button" class="secondary" id="apple">Apple</button>
      </div>
      <p class="divider">or</p>
    ` : ""}
    <form id="signin">
      <label>Email <input id="email" type="email" autocomplete="username" /></label>
      <label>Password <input id="password" type="password" autocomplete="current-password" /></label>
      <button type="submit">Sign in</button>
      <p id="error" class="error" hidden></p>
    </form>
    ${accountStrip({...status, signedIn: false, available: false})}
  `);
  document.getElementById("back")?.addEventListener("click", () => {
    screen = "vault";
    void render();
  });
  const error = document.getElementById("error");
  async function finish(result) {
    if (result.signedIn) {
      session = null;
      screen = "vault";
      await render();
      return;
    }
    error.hidden = false;
    error.textContent = result.error || "Could not sign in.";
  }
  document.getElementById("signin").addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const result = await signInWithPassword(
      document.getElementById("email").value.trim(),
      document.getElementById("password").value,
    );
    await finish(result);
  });
  document.getElementById("google")?.addEventListener("click", async () => {
    error.hidden = true;
    await finish(await signInWithOAuth("google"));
  });
  document.getElementById("apple")?.addEventListener("click", async () => {
    error.hidden = true;
    await finish(await signInWithOAuth("apple"));
  });
}

async function render() {
  const status = await accountStatus();
  if (screen === "sign-in") {
    await renderSignIn(status);
    return;
  }
  const tab = await activeTab();
  const url = tab.url || "";
  try {
    await preferDesktopLoopback(
      async () => {
        const vault = await vaultRequest("/v1/vault/status");
        try {
          await pushCachedVault();
        } catch {
          // Desktop still answers fill even if the cached copy cannot upload.
        }
        await syncCachedVault();
        if (!vault.exists) {
          page(`<h1>Vault</h1><p class="status">Create a vault in Polymux first.</p>${accountStrip(status)}`);
          bindAccount(status);
          return "desktop";
        }
        if (!vault.unlocked) {
          unlockForm("Vault", "", status);
          bindUnlock(async (password) => {
            await vaultRequest("/v1/vault/unlock", {method: "POST", body: {password}});
            await syncCachedVault();
          });
          return "desktop";
        }
        await renderMatches(url, tab, status, {
          async matches(pageUrl) {
            return (await vaultRequest("/v1/vault/matches", {query: {url: pageUrl}})).items ?? [];
          },
          async fill(id) {
            return vaultRequest("/v1/vault/fill", {method: "POST", body: {id}});
          },
          async save(body) {
            await vaultRequest("/v1/vault/save", {method: "POST", body});
            await syncCachedVault();
          },
          async lock() {
            await vaultRequest("/v1/vault/lock", {method: "POST", body: {}});
          },
        });
        return "desktop";
      },
      async () => {
        await renderDevice(url, tab, status);
        return "device";
      },
    );
  } catch (cause) {
    page(`<h1>Vault</h1><p class="status">${escape(cause instanceof Error ? cause.message : String(cause))}</p>${accountStrip(status)}`);
    bindAccount(status);
  }
}

async function renderDevice(url, tab, status) {
  const cached = await deviceSession();
  if (status.signedIn && cached.status().sync.storage !== "local") {
    try {
      await pullDeviceCloud(cached);
    } catch (cause) {
      if (!cached.status().exists) {
        page(`
          <h1>Vault</h1>
          <p class="status">${escape(cause instanceof Error ? cause.message : String(cause))}</p>
          ${accountStrip(status)}
        `);
        bindAccount(status);
        return;
      }
    }
  }
  if (!cached.status().exists) {
    page(`
      <h1>Vault</h1>
      <p class="status">${status.signedIn ? "This account has no vault in the cloud." : desktopVaultUnavailableReason() ? "Sign in to use the account vault." : "Connect the Polymux browser host, or sign in to use the account vault."}</p>
      ${accountStrip(status)}
    `);
    bindAccount(status);
    return;
  }
  if (!cached.status().unlocked) {
    unlockForm("Vault", status.signedIn ? "" : "Unlocking the copy saved on this browser.", status);
    bindUnlock((password) => cached.unlock(password).then(async () => {
    await chrome.runtime.sendMessage({type: "polymux:vault-device-unlock", password});
  }));
    return;
  }
  await renderMatches(url, tab, status, {
    async matches(pageUrl) {
      return cached.matchesForUrl(pageUrl);
    },
    async fill(id) {
      return cached.fillFields(id);
    },
    async save(body) {
      await cached.save(body);
      await syncDeviceCloud(cached);
    },
    async lock() {
      cached.lock();
    },
  });
}

function bindUnlock(unlock) {
  const form = document.getElementById("unlock");
  const error = document.getElementById("error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      await unlock(document.getElementById("password").value);
      await render();
    } catch (cause) {
      error.hidden = false;
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  });
}

async function renderMatches(url, tab, status, api) {
  const matches = url.startsWith("http") ? await api.matches(url) : [];
  const pending = await chrome.runtime.sendMessage({type: "polymux:vault-pending"});
  const rows = matches
    .map(
      (item) => `
        <button type="button" class="row" data-id="${escape(item.id)}" data-totp="${item.hasTotp ? "1" : ""}">
          <strong>${escape(item.title || item.url)}</strong>
          <span>${escape(item.username)}</span>
        </button>`,
    )
    .join("");

  page(`
    <div class="toolbar">
      <h1>Vault</h1>
      <button type="button" class="quiet" id="lock">Lock</button>
    </div>
    ${rows || `<p class="status">Nothing saved for this site.</p>`}
    <div class="actions">
      ${pending?.username || pending?.password ? `<button type="button" id="save">Save</button>` : ""}
    </div>
    <p id="error" class="error" hidden></p>
    ${accountStrip(status)}
  `);
  bindAccount(status);

  document.getElementById("lock")?.addEventListener("click", async () => {
    await api.lock();
    await render();
  });
  document.getElementById("save")?.addEventListener("click", async () => {
    const pageInfo = pending || (await tabPage(tab.id));
    if (!pageInfo) return;
    await api.save({
      title: pageInfo.title || pageInfo.origin || url,
      username: pageInfo.username || "",
      password: pageInfo.password || "",
      url: pageInfo.origin || url,
    });
    await chrome.runtime.sendMessage({type: "polymux:vault-clear-pending"});
    await render();
  });
  for (const button of root.querySelectorAll("[data-id]")) {
    button.addEventListener("click", async () => {
      const error = document.getElementById("error");
      try {
        const fields = await api.fill(button.dataset.id);
        await fillTab(tab.id, fields);
        window.close();
      } catch (cause) {
        if (error) {
          error.hidden = false;
          error.textContent = cause instanceof Error ? cause.message : String(cause);
        }
      }
    });
  }
}

void render();
