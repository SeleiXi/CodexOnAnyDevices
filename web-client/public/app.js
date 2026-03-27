const state = {
  authenticated: false,
  passwordConfigured: true,
  session: null,
  ban: null,
  security: null,
  status: null,
  appError: "",
  autoConnectAttempted: false,
  currentView: "chat",
  sidebarOpen: false,
  lastCompactLayout: window.innerWidth <= 980,
  isConnecting: false,
  isDisconnecting: false,
  availableModels: [],
  selectedModelId: "",
  pinnedThreadIds: [],
  threads: [],
  searchQuery: "",
  activeThreadId: "",
  activeThread: null,
  messages: [],
  lastRenderedThreadId: "",
  forceScrollToBottom: false,
  statusPoller: null,
  threadPoller: null,
  messagePoller: null,
};

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  authStatus: document.querySelector("#auth-status"),
  authError: document.querySelector("#auth-error"),
  loginForm: document.querySelector("#login-form"),
  passwordInput: document.querySelector("#password-input"),
  loginButton: document.querySelector("#login-button"),
  appShell: document.querySelector("#app-shell"),
  navChatButton: document.querySelector("#nav-chat-button"),
  navConnectionButton: document.querySelector("#nav-connection-button"),
  chatPage: document.querySelector("#chat-page"),
  connectionPage: document.querySelector("#connection-page"),
  openSidebarButton: document.querySelector("#open-sidebar-button"),
  toggleSidebarButton: document.querySelector("#toggle-sidebar-button"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  openSettingsInline: document.querySelector("#open-settings-inline"),
  sidebarSettingsButton: null,
  connectionBackButton: document.querySelector("#connection-back-button"),
  sessionExpiryLabel: document.querySelector("#session-expiry-label"),
  pairedMacLabel: document.querySelector("#paired-mac-label"),
  pairedMacName: document.querySelector("#paired-mac-name"),
  threadSearchInput: document.querySelector("#thread-search-input"),
  threadList: document.querySelector("#thread-list"),
  newThreadButton: document.querySelector("#new-thread-button"),
  threadTitle: document.querySelector("#thread-title"),
  threadSubtitle: document.querySelector("#thread-subtitle"),
  connectionBadge: document.querySelector("#connection-badge"),
  statusBanner: document.querySelector("#status-banner"),
  statusBannerTitle: document.querySelector("#status-banner-title"),
  statusBannerCopy: document.querySelector("#status-banner-copy"),
  statusBannerAction: document.querySelector("#status-banner-action"),
  homeState: document.querySelector("#home-state"),
  homeStatusPill: document.querySelector("#home-status-pill"),
  homeStatusDot: document.querySelector("#home-status-dot"),
  homeStatusLabel: document.querySelector("#home-status-label"),
  trustedPairCard: document.querySelector("#trusted-pair-card"),
  trustedPairTitle: document.querySelector("#trusted-pair-title"),
  trustedPairName: document.querySelector("#trusted-pair-name"),
  trustedPairDetail: document.querySelector("#trusted-pair-detail"),
  homeSecurityLabel: document.querySelector("#home-security-label"),
  homeMessage: document.querySelector("#home-message"),
  homePrimaryButton: document.querySelector("#home-primary-button"),
  homeSecondaryButton: document.querySelector("#home-secondary-button"),
  messageList: document.querySelector("#message-list"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  modelButton: document.querySelector("#model-button"),
  modelMenu: document.querySelector("#model-menu"),
  modelSummary: document.querySelector("#model-summary"),
  accessModeButton: document.querySelector("#access-mode-button"),
  accessModeMenu: document.querySelector("#access-mode-menu"),
  accessModeSummary: document.querySelector("#access-mode-summary"),
  accessModeOptions: document.querySelectorAll("[data-access-mode]"),
  loadDefaultPairing: document.querySelector("#load-default-pairing"),
  connectButton: document.querySelector("#connect-button"),
  disconnectButton: document.querySelector("#disconnect-button"),
  pairingJson: document.querySelector("#pairing-json"),
  accessMode: document.querySelector("#access-mode"),
  projectPath: document.querySelector("#project-path"),
  connectionStatus: document.querySelector("#connection-status"),
  connectionDetail: document.querySelector("#connection-detail"),
  appError: document.querySelector("#app-error"),
  currentIpLabel: document.querySelector("#current-ip-label"),
  proxyModeLabel: document.querySelector("#proxy-mode-label"),
  allowlistEnabled: document.querySelector("#allowlist-enabled"),
  trustProxyHeaders: document.querySelector("#trust-proxy-headers"),
  allowedCidrs: document.querySelector("#allowed-cidrs"),
  trustedProxyCidrs: document.querySelector("#trusted-proxy-cidrs"),
  saveSecurityButton: document.querySelector("#save-security-button"),
  useCloudflareButton: document.querySelector("#use-cloudflare-button"),
  approvalPanel: document.querySelector("#approval-panel"),
  approvalText: document.querySelector("#approval-text"),
  approveButton: document.querySelector("#approve-button"),
  declineButton: document.querySelector("#decline-button"),
  logoutButton: document.querySelector("#logout-button"),
};

boot();

async function boot() {
  bindEvents();
  await refreshAuthSession();
}

function bindEvents() {
  ensureSidebarSettingsButton();
  elements.loginForm.addEventListener("submit", login);
  elements.logoutButton.addEventListener("click", logout);
  elements.navChatButton.addEventListener("click", () => setCurrentView("chat"));
  elements.navConnectionButton.addEventListener("click", () => setCurrentView("connection"));
  elements.openSidebarButton.addEventListener("click", toggleSidebar);
  elements.toggleSidebarButton.addEventListener("click", toggleSidebar);
  elements.sidebarScrim.addEventListener("click", closeSidebar);
  elements.openSettingsInline.addEventListener("click", () => setCurrentView("connection"));
  elements.sidebarSettingsButton?.addEventListener("click", () => setCurrentView("connection"));
  elements.connectionBackButton.addEventListener("click", () => setCurrentView("chat"));
  elements.threadSearchInput.addEventListener("input", () => {
    state.searchQuery = elements.threadSearchInput.value.trim().toLowerCase();
    renderThreads();
  });
  elements.newThreadButton.addEventListener("click", createThreadAndSelect);
  elements.homePrimaryButton.addEventListener("click", handleHomePrimaryAction);
  elements.homeSecondaryButton.addEventListener("click", handleHomeSecondaryAction);
  elements.statusBannerAction.addEventListener("click", handleBannerAction);
  elements.composerForm.addEventListener("submit", sendMessage);
  elements.modelButton.addEventListener("click", toggleModelMenu);
  elements.accessModeButton.addEventListener("click", toggleAccessModeMenu);
  elements.accessModeOptions.forEach((button) => {
    button.addEventListener("click", handleAccessModeOptionSelect);
  });
  elements.loadDefaultPairing.addEventListener("click", loadDefaultPairing);
  elements.connectButton.addEventListener("click", connectBridge);
  elements.disconnectButton.addEventListener("click", disconnectBridge);
  elements.accessMode.addEventListener("change", renderComposerMeta);
  elements.projectPath.addEventListener("input", renderComposerMeta);
  elements.saveSecurityButton.addEventListener("click", saveSecurityPolicy);
  elements.useCloudflareButton.addEventListener("click", applyCloudflareDefaults);
  elements.approveButton.addEventListener("click", () => respondToApproval("accept"));
  elements.declineButton.addEventListener("click", () => respondToApproval("decline"));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeComposerMenus();
    }
    if (event.key === "Escape" && state.sidebarOpen) {
      closeSidebar();
    }
  });
  document.addEventListener("click", handleGlobalClick);
  window.addEventListener("resize", () => {
    renderCurrentView();
    renderSidebarShell();
  });
}

async function refreshAuthSession() {
  try {
    const response = await fetchJson("/api/auth/session");
    state.authenticated = response.authenticated;
    state.passwordConfigured = response.hasPasswordConfigured;
    state.session = response.session;
    state.ban = response.ban;
    state.security = response.security || null;
  } catch (error) {
    showAuthError(error.message);
  }

  renderAuthShell();
  if (state.authenticated) {
    await enterAuthenticatedMode();
  } else {
    leaveAuthenticatedMode();
  }
}

async function enterAuthenticatedMode() {
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  clearAppError();
  state.autoConnectAttempted = false;
  state.sidebarOpen = !isCompactLayout();
  state.currentView = "chat";
  renderSessionExpiry();
  renderComposerMeta();
  renderCurrentView();
  renderSidebarShell();
  await refreshStatus();
  await refreshSecurity();
  await refreshRuntimeConfig();
  const pairingPayload = await loadDefaultPairing();
  if (!state.status?.isConnected) {
    const autoConnected = await maybeAutoConnect(pairingPayload);
    state.currentView = autoConnected ? "chat" : "connection";
    renderCurrentView();
  }
  if (state.status?.isConnected) {
    await refreshRuntimeConfig();
    await refreshThreads();
  } else {
    renderThreads();
    renderMessages();
  }
  ensurePollers();
}

function leaveAuthenticatedMode(message = "") {
  stopPollers();
  state.authenticated = false;
  state.status = null;
  state.security = null;
  state.appError = "";
  state.autoConnectAttempted = false;
  state.availableModels = [];
  state.selectedModelId = "";
  state.pinnedThreadIds = [];
  state.threads = [];
  state.activeThreadId = "";
  state.activeThread = null;
  state.messages = [];
  state.lastRenderedThreadId = "";
  state.forceScrollToBottom = false;
  state.currentView = "chat";
  state.sidebarOpen = false;
  document.body.classList.remove("sidebar-open");
  elements.appShell.hidden = true;
  elements.authScreen.hidden = false;
  renderAuthShell(message);
  renderCurrentView();
  renderThreads();
  renderMessages();
}

async function login(event) {
  event.preventDefault();
  const password = elements.passwordInput.value;
  if (!password) {
    showAuthError("Password is required.");
    return;
  }

  clearAuthError();
  elements.loginButton.disabled = true;
  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: { password },
      allowUnauthenticated: true,
    });
    state.authenticated = true;
    state.session = {
      expiresAt: response.expiresAt,
    };
    state.ban = null;
    elements.passwordInput.value = "";
    await enterAuthenticatedMode();
  } catch (error) {
    if (error.ban) {
      state.ban = error.ban;
    }
    showAuthError(error.message);
    renderAuthShell();
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: {},
    });
  } catch {
    // best effort
  }
  state.session = null;
  state.ban = null;
  leaveAuthenticatedMode("Session closed.");
}

function renderAuthShell(message = "") {
  const sessionMessage = state.passwordConfigured
    ? "Enter the admin password to access Remodex Web."
    : "Admin password is not configured on the server.";
  elements.authStatus.textContent = message || describeBan(state.ban) || sessionMessage;
  renderSessionExpiry();
}

function showAuthError(message) {
  elements.authError.hidden = false;
  elements.authError.textContent = message;
}

function clearAuthError() {
  elements.authError.hidden = true;
  elements.authError.textContent = "";
}

function renderSessionExpiry() {
  if (!state.session?.expiresAt) {
    elements.sessionExpiryLabel.textContent = "Not signed in";
    return;
  }
  elements.sessionExpiryLabel.textContent = formatTimestamp(state.session.expiresAt);
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  renderSidebarShell();
}

function closeSidebar() {
  if (!isCompactLayout()) {
    return;
  }
  state.sidebarOpen = false;
  renderSidebarShell();
}

function setCurrentView(view) {
  state.currentView = view === "connection" ? "connection" : "chat";
  closeComposerMenus();
  renderCurrentView();
  if (state.currentView !== "chat") {
    closeSidebar();
    return;
  }
  renderSidebarShell();
}

function renderCurrentView() {
  const onChat = state.currentView === "chat";
  elements.chatPage.hidden = !onChat;
  elements.connectionPage.hidden = onChat;
  elements.appShell.dataset.view = state.currentView;
  elements.navChatButton.classList.toggle("active", onChat);
  elements.navConnectionButton.classList.toggle("active", !onChat);
  elements.openSettingsInline.textContent = isCompactLayout() ? "Settings" : "Connection";
}

function ensureSidebarSettingsButton() {
  if (elements.sidebarSettingsButton || !elements.newThreadButton?.parentElement) {
    return;
  }

  const button = document.createElement("button");
  button.id = "sidebar-settings-button";
  button.type = "button";
  button.className = "toolbar-button mobile-only sidebar-menu-button";
  button.textContent = "Settings";
  elements.newThreadButton.insertAdjacentElement("afterend", button);
  elements.sidebarSettingsButton = button;
}

function renderSidebarShell() {
  const compact = isCompactLayout();
  const sidebarCanOpen = compact && state.currentView === "chat";
  if (compact !== state.lastCompactLayout) {
    state.lastCompactLayout = compact;
    if (compact) {
      state.sidebarOpen = false;
    }
  }
  if (!compact) {
    state.sidebarOpen = true;
  } else if (!sidebarCanOpen) {
    state.sidebarOpen = false;
  }
  elements.appShell.classList.toggle("compact-layout", compact);
  elements.appShell.classList.toggle("sidebar-open", sidebarCanOpen && state.sidebarOpen);
  document.body.classList.toggle("sidebar-open", sidebarCanOpen && state.sidebarOpen);
  elements.sidebarScrim.hidden = !(sidebarCanOpen && state.sidebarOpen);
  elements.openSidebarButton.hidden = !sidebarCanOpen;
  elements.openSettingsInline.hidden = compact;
  if (elements.sidebarSettingsButton) {
    elements.sidebarSettingsButton.hidden = !compact;
  }
  elements.toggleSidebarButton.setAttribute("aria-label", state.sidebarOpen ? "Close chat list" : "Open chat list");
}

async function refreshStatus() {
  if (!state.authenticated) {
    return;
  }

  try {
    const response = await api("/api/status");
    state.status = response.status;
    if (response.session) {
      state.session = response.session;
    }
    if (response.security) {
      state.security = response.security;
      if (!securityEditorIsActive()) {
        renderSecurityState();
      }
    }
    renderChrome();
  } catch (error) {
    showAppError(error.message);
  }
}

async function refreshSecurity() {
  if (!state.authenticated) {
    return;
  }
  try {
    const response = await api("/api/security");
    state.security = response.security;
    renderSecurityState();
    renderHomeState();
  } catch (error) {
    showAppError(error.message);
  }
}

async function refreshRuntimeConfig() {
  if (!state.authenticated) {
    return;
  }

  try {
    const response = await api("/api/runtime-config");
    state.availableModels = response.models || [];
    state.selectedModelId = response.preferences?.selectedModelId || "";
    renderComposerMeta();
  } catch (error) {
    showAppError(error.message);
  }

  try {
    const response = await api("/api/pinned-threads");
    state.pinnedThreadIds = response.threadIds || [];
  } catch (error) {
    showAppError(error.message);
  }

  renderThreads();
}

async function loadDefaultPairing(options = {}) {
  if (!state.authenticated) {
    return null;
  }
  try {
    const query = options.forceRefresh ? "?refresh=1" : "";
    const response = await api(`/api/pairing/default${query}`);
    elements.pairingJson.value = JSON.stringify(response.pairingPayload, null, 2);
    renderHomeState();
    return response.pairingPayload || null;
  } catch (error) {
    showAppError(error.message);
    return null;
  }
}

async function connectBridge(options = {}) {
  clearAppError();
  let pairingPayload = options.pairingPayload || null;
  try {
    if (!pairingPayload) {
      pairingPayload = readPairingFromEditor();
    }
  } catch {
    showAppError("Pairing JSON is invalid.");
    setCurrentView("connection");
    return;
  }

  if (!pairingPayload) {
    showAppError("Load or paste a pairing payload first.");
    setCurrentView("connection");
    return;
  }

  const pairingProblem = pairingUsabilityProblem(pairingPayload);
  if (pairingProblem) {
    const refreshedPairing = await tryRefreshPairingForConnection(pairingProblem);
    if (!refreshedPairing) {
      showAppError(pairingProblem);
      setCurrentView("connection");
      return;
    }
    pairingPayload = refreshedPairing;
  }

  state.autoConnectAttempted = true;
  const connected = await connectBridgeWithPayload(pairingPayload);
  if (connected && !options.keepCurrentView) {
    setCurrentView("chat");
  }
}

async function connectBridgeWithPayload(pairingPayload) {
  state.isConnecting = true;
  renderChrome();
  elements.connectButton.disabled = true;
  try {
    await api("/api/connect", {
      method: "POST",
      body: pairingPayload,
    });
    clearAppError();
    await refreshStatus();
    await refreshRuntimeConfig();
    await refreshThreads();
    return true;
  } catch (error) {
    showAppError(error.message);
    return false;
  } finally {
    state.isConnecting = false;
    elements.connectButton.disabled = false;
    renderChrome();
  }
}

async function disconnectBridge() {
  state.isDisconnecting = true;
  renderChrome();
  try {
    await api("/api/disconnect", {
      method: "POST",
      body: {},
    });
    state.activeThreadId = "";
    state.activeThread = null;
    state.messages = [];
    renderMessages();
    await refreshStatus();
  } catch (error) {
    showAppError(error.message);
  } finally {
    state.isDisconnecting = false;
    renderChrome();
  }
}

async function refreshThreads() {
  if (!state.authenticated || !isBridgeConnected()) {
    renderThreads();
    renderMessages();
    return;
  }

  try {
    const response = await api("/api/threads");
    state.threads = response.threads || [];
    const prioritizedThreads = prioritizeThreads(state.threads);
    if (!state.activeThreadId && prioritizedThreads.length > 0) {
      state.activeThreadId = prioritizedThreads[0].id;
    } else if (state.activeThreadId && !state.threads.some((thread) => thread.id === state.activeThreadId)) {
      state.activeThreadId = prioritizedThreads[0]?.id || "";
    }
    renderThreads();
    if (state.activeThreadId) {
      await refreshActiveThread();
    } else {
      state.activeThread = null;
      state.messages = [];
      renderMessages();
    }
  } catch (error) {
    showAppError(error.message);
  }
}

async function createThreadAndSelect() {
  if (!isBridgeConnected()) {
    showAppError("Connect the bridge before creating a thread.");
    setCurrentView("connection");
    return;
  }
  try {
    const response = await api("/api/threads", {
      method: "POST",
      body: {
        cwd: elements.projectPath.value,
        accessMode: elements.accessMode.value,
        model: selectedModelRequestValue(),
      },
    });
    state.activeThreadId = response.thread.id;
    await refreshThreads();
  } catch (error) {
    showAppError(error.message);
  }
}

async function refreshActiveThread() {
  if (!state.authenticated || !state.activeThreadId || !isBridgeConnected()) {
    renderMessages();
    return;
  }

  try {
    const response = await api(`/api/threads/${encodeURIComponent(state.activeThreadId)}`);
    state.activeThread = response.thread;
    state.messages = response.messages || [];
    renderMessages();
    renderThreads();
  } catch (error) {
    showAppError(error.message);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.composerInput.value.trim();
  if (!text) {
    return;
  }
  if (!isBridgeConnected()) {
    showAppError("Connect the bridge before sending messages.");
    setCurrentView("connection");
    return;
  }

  clearAppError();
  elements.composerInput.disabled = true;
  try {
    if (!state.activeThreadId) {
      await createThreadAndSelect();
    }
    if (!state.activeThreadId) {
      return;
    }

    await api(`/api/threads/${encodeURIComponent(state.activeThreadId)}/turns`, {
      method: "POST",
      body: {
        text,
        cwd: elements.projectPath.value,
        accessMode: elements.accessMode.value,
        model: selectedModelRequestValue(),
      },
    });
    elements.composerInput.value = "";
    state.forceScrollToBottom = true;
    await refreshActiveThread();
    await refreshThreads();
  } catch (error) {
    showAppError(error.message);
  } finally {
    elements.composerInput.disabled = false;
    elements.composerInput.focus();
  }
}

async function respondToApproval(decision) {
  try {
    await api("/api/approvals/current", {
      method: "POST",
      body: { decision },
    });
    await refreshStatus();
    await refreshActiveThread();
  } catch (error) {
    showAppError(error.message);
  }
}

async function saveSecurityPolicy() {
  elements.saveSecurityButton.disabled = true;
  clearAppError();
  try {
    const response = await api("/api/security", {
      method: "PUT",
      body: {
        allowlistEnabled: elements.allowlistEnabled.checked,
        trustProxyHeaders: elements.trustProxyHeaders.checked,
        allowedCidrs: splitTextareaLines(elements.allowedCidrs.value),
        trustedProxyCidrs: splitTextareaLines(elements.trustedProxyCidrs.value),
      },
    });
    state.security = response.security;
    renderSecurityState();
    renderHomeState();
  } catch (error) {
    showAppError(error.message);
  } finally {
    elements.saveSecurityButton.disabled = false;
  }
}

function applyCloudflareDefaults() {
  elements.trustProxyHeaders.checked = true;
  if (!elements.trustedProxyCidrs.value.trim() && state.security?.trustedProxyCidrs?.length) {
    elements.trustedProxyCidrs.value = state.security.trustedProxyCidrs.join("\n");
  }
}

function renderChrome() {
  renderConnectionState();
  renderBanner();
  renderApproval();
  renderComposerMeta();
  renderSecurityState();
  renderHomeState();
  renderMessages();
}

function renderConnectionState() {
  const isConnected = isBridgeConnected();
  const phase = connectionPhase();
  elements.connectionBadge.textContent = connectionBadgeLabel(phase);
  elements.connectionBadge.className = `status-capsule ${badgeClassForPhase(phase)}`;

  elements.connectionStatus.textContent = isConnected
    ? `Linked to ${shortDeviceId(state.status?.macDeviceId)}`
    : state.isConnecting
      ? "Connecting"
      : "Disconnected";
  elements.connectionDetail.textContent = isConnected
    ? `Secure session ${state.status?.secureSessionId || "unknown"}`
    : state.status?.lastDisconnect?.reason
      ? `Last disconnect: ${state.status.lastDisconnect.reason}`
      : "Load a pairing payload to connect.";

  elements.pairedMacLabel.textContent = isConnected ? "Connected to Mac" : state.status?.macDeviceId ? "Saved Mac" : "No Pairing";
  elements.pairedMacName.textContent = state.status?.macDeviceId
    ? shortDeviceId(state.status.macDeviceId)
    : "No pairing yet";
}

function renderSecurityState() {
  const security = state.security;
  if (!security) {
    elements.currentIpLabel.textContent = "Unknown";
    elements.proxyModeLabel.textContent = "Security policy unavailable.";
    elements.allowlistEnabled.checked = false;
    elements.trustProxyHeaders.checked = false;
    elements.allowedCidrs.value = "";
    elements.trustedProxyCidrs.value = "";
    return;
  }

  if (!securityEditorIsActive()) {
    elements.allowlistEnabled.checked = Boolean(security.allowlistEnabled);
    elements.trustProxyHeaders.checked = Boolean(security.trustProxyHeaders);
    elements.allowedCidrs.value = (security.allowedCidrs || []).join("\n");
    elements.trustedProxyCidrs.value = (security.trustedProxyCidrs || []).join("\n");
  }

  elements.currentIpLabel.textContent = security.currentRequestIp || "Unknown";
  elements.proxyModeLabel.textContent = security.proxyHeaderTrusted
    ? `Cloudflare header trusted. Origin sees ${security.remoteAddress || "unknown"}.`
    : security.allowlistEnabled
      ? "Direct origin access with allowlist enforcement."
      : "Direct origin access.";
}

function renderThreads() {
  elements.threadList.innerHTML = "";
  const filteredThreads = state.threads.filter((thread) => {
    if (!state.searchQuery) {
      return true;
    }
    return [thread.title, thread.preview, thread.cwd, thread.model]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(state.searchQuery));
  });

  if (filteredThreads.length === 0) {
    const empty = document.createElement("div");
    empty.className = "thread-empty";
    empty.textContent = isBridgeConnected()
      ? "No matching conversations."
      : "Connect the bridge to load chats.";
    elements.threadList.appendChild(empty);
    return;
  }

  for (const group of groupThreads(filteredThreads)) {
    const section = document.createElement("section");
    section.className = "thread-group";

    const heading = document.createElement("header");
    heading.className = "thread-group-heading";
    heading.innerHTML = `
      <span>${escapeHTML(group.label)}</span>
      <span>${group.threads.length}</span>
    `;
    section.appendChild(heading);

    for (const thread of group.threads) {
      const row = document.createElement("div");
      row.className = `thread-row-shell ${thread.id === state.activeThreadId ? "selected" : ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = `thread-row ${thread.id === state.activeThreadId ? "selected" : ""}`;
      button.innerHTML = `
        <div class="thread-row-main">
          <span class="thread-title-text">${escapeHTML(thread.title || "New Chat")}</span>
          <span class="thread-time">${escapeHTML(compactRelativeTime(thread.updatedAt || thread.createdAt))}</span>
        </div>
        <div class="thread-row-footer">
          <span class="thread-subcopy">${escapeHTML(describeThreadRow(thread))}</span>
        </div>
      `;
      button.addEventListener("click", async () => {
        state.activeThreadId = thread.id;
        closeSidebar();
        await refreshActiveThread();
      });

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = `thread-pin-indicator ${thread.pinned ? "is-pinned" : ""}`;
      pinButton.setAttribute("aria-label", thread.pinned ? "Unpin thread" : "Pin thread");
      pinButton.setAttribute("title", thread.pinned ? "Unpin thread" : "Pin thread");
      pinButton.textContent = "📌";
      pinButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await toggleThreadPin(thread.id);
      });

      row.appendChild(button);
      row.appendChild(pinButton);
      section.appendChild(row);
    }

    elements.threadList.appendChild(section);
  }
}

function renderMessages() {
  const previousDistanceFromBottom = distanceFromBottom(elements.messageList);
  const shouldStickToBottom = state.forceScrollToBottom
    || state.activeThreadId !== state.lastRenderedThreadId
    || isNearBottom(elements.messageList);
  const activeThread = state.activeThread;
  elements.threadTitle.textContent = activeThread?.title || "Remodex";
  elements.threadSubtitle.textContent = activeThread
    ? describeActiveThreadSubtitle(activeThread)
    : "Choose a conversation or start a new chat.";

  elements.homeState.hidden = Boolean(state.activeThreadId);
  elements.messageList.hidden = !state.activeThreadId;

  if (!state.activeThreadId) {
    renderHomeState();
    elements.messageList.innerHTML = "";
    state.lastRenderedThreadId = "";
    state.forceScrollToBottom = false;
    return;
  }

  elements.messageList.innerHTML = "";
  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.innerHTML = `
      <p class="micro-label muted">New Chat</p>
      <h3>Start the conversation</h3>
      <p class="support-copy">Your composer stays anchored at the bottom, like the native client.</p>
    `;
    elements.messageList.appendChild(empty);
    state.lastRenderedThreadId = state.activeThreadId;
    state.forceScrollToBottom = false;
    return;
  }

  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = `message-card role-${message.role}`;
    article.innerHTML = `
      <header class="message-head">
        <span>${escapeHTML(message.role)}</span>
        <time>${escapeHTML(formatTimestamp(message.createdAt))}</time>
      </header>
      <pre>${escapeHTML(message.text)}</pre>
    `;
    elements.messageList.appendChild(article);
  }

  window.requestAnimationFrame(() => {
    if (shouldStickToBottom) {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    } else {
      elements.messageList.scrollTop = Math.max(
        0,
        elements.messageList.scrollHeight - elements.messageList.clientHeight - previousDistanceFromBottom,
      );
    }
    state.lastRenderedThreadId = state.activeThreadId;
    state.forceScrollToBottom = false;
  });
}

function renderHomeState() {
  const phase = connectionPhase();
  const isConnected = isBridgeConnected();
  const savedMac = state.status?.macDeviceId || "";
  const homeMessage = state.appError
    || state.status?.lastDisconnect?.reason
    || (isConnected ? "Pick a conversation from the sidebar or start a new one." : "Connect to your local bridge to resume chats.");

  elements.homeStatusLabel.textContent = homeStatusLabel(phase);
  elements.homeStatusPill.className = `status-capsule ${badgeClassForPhase(phase)}`;
  elements.homeStatusDot.className = `status-dot ${dotClassForPhase(phase)}`;
  elements.homeSecurityLabel.textContent = describeSecuritySummary();
  elements.homeMessage.textContent = homeMessage;

  if (savedMac) {
    elements.trustedPairCard.hidden = false;
    elements.trustedPairTitle.textContent = isConnected ? "Connected to Mac" : "Saved Mac";
    elements.trustedPairName.textContent = shortDeviceId(savedMac);
    elements.trustedPairDetail.textContent = isConnected
      ? "Secure session is active and ready for chat sync."
      : "Pairing is saved, but the bridge is currently offline.";
  } else {
    elements.trustedPairCard.hidden = true;
    elements.trustedPairDetail.textContent = "";
  }

  elements.homePrimaryButton.disabled = state.isConnecting || state.isDisconnecting;
  elements.homePrimaryButton.textContent = homePrimaryLabel(phase);
  elements.homeSecondaryButton.textContent = isConnected ? "Open Connection Settings" : "Load Local JSON";
}

function renderBanner() {
  const approval = state.status?.pendingApproval || null;
  if (approval) {
    elements.statusBanner.hidden = false;
    elements.statusBannerTitle.textContent = "Bridge is waiting for approval";
    elements.statusBannerCopy.textContent = approval.method || "Review the request before the task continues.";
    elements.statusBannerAction.textContent = "Review";
    return;
  }

  if (state.appError) {
    elements.statusBanner.hidden = false;
    elements.statusBannerTitle.textContent = "Action failed";
    elements.statusBannerCopy.textContent = state.appError;
    elements.statusBannerAction.textContent = "Connection";
    return;
  }

  elements.statusBanner.hidden = true;
  elements.statusBannerTitle.textContent = "";
  elements.statusBannerCopy.textContent = "";
}

function renderApproval() {
  const approval = state.status?.pendingApproval || null;
  if (!approval) {
    elements.approvalPanel.hidden = true;
    elements.approvalText.textContent = "";
    return;
  }
  elements.approvalPanel.hidden = false;
  elements.approvalText.textContent = JSON.stringify(approval, null, 2);
}

function renderComposerMeta() {
  const summary = elements.accessMode.value === "on-request"
    ? "On-Request"
    : "Full Access";
  elements.accessModeSummary.textContent = summary;
  elements.accessModeButton.setAttribute("aria-label", `Access mode: ${summary}`);
  elements.accessModeOptions.forEach((button) => {
    const selected = button.dataset.accessMode === elements.accessMode.value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  const selectedModelLabel = activeModelDisplayName();
  elements.modelSummary.textContent = selectedModelLabel;
  elements.modelButton.setAttribute("aria-label", `Model: ${selectedModelLabel}`);
  elements.modelButton.disabled = !state.availableModels.length && !state.selectedModelId;
  renderModelMenu();
}

function renderModelMenu() {
  elements.modelMenu.innerHTML = "";

  const options = [
    {
      id: "",
      displayName: defaultModelDisplayName(),
      description: "Use the bridge default for new chats and turns.",
      isDefault: true,
    },
    ...state.availableModels,
  ];

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `access-mode-option ${isSelectedModelOption(option.id) ? "selected" : ""}`;
    button.innerHTML = `
      <strong>${escapeHTML(option.displayName || option.model || option.id || "Auto")}</strong>
      <span>${escapeHTML(describeModelOption(option))}</span>
    `;
    button.addEventListener("click", async () => {
      await setSelectedModel(option.id);
      setModelMenuOpen(false);
    });
    elements.modelMenu.appendChild(button);
  }
}

function isAccessModeMenuOpen() {
  return Boolean(elements.accessModeMenu && !elements.accessModeMenu.hidden);
}

function setAccessModeMenuOpen(open) {
  if (!elements.accessModeMenu || !elements.accessModeButton) {
    return;
  }
  if (open) {
    setModelMenuOpen(false);
  }
  elements.accessModeMenu.hidden = !open;
  elements.accessModeButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function isModelMenuOpen() {
  return Boolean(elements.modelMenu && !elements.modelMenu.hidden);
}

function setModelMenuOpen(open) {
  if (!elements.modelMenu || !elements.modelButton) {
    return;
  }
  if (open) {
    setAccessModeMenuOpen(false);
  }
  elements.modelMenu.hidden = !open;
  elements.modelButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleAccessModeMenu(event) {
  event.stopPropagation();
  setAccessModeMenuOpen(!isAccessModeMenuOpen());
}

function toggleModelMenu(event) {
  event.stopPropagation();
  setModelMenuOpen(!isModelMenuOpen());
}

function handleAccessModeOptionSelect(event) {
  const nextMode = event.currentTarget.dataset.accessMode;
  if (!nextMode) {
    return;
  }
  elements.accessMode.value = nextMode;
  renderComposerMeta();
  setAccessModeMenuOpen(false);
}

function closeComposerMenus() {
  setAccessModeMenuOpen(false);
  setModelMenuOpen(false);
}

function handleGlobalClick(event) {
  if (!isAccessModeMenuOpen() && !isModelMenuOpen()) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Node)) {
    closeComposerMenus();
    return;
  }
  if (elements.accessModeButton.contains(target)
    || elements.accessModeMenu.contains(target)
    || elements.modelButton.contains(target)
    || elements.modelMenu.contains(target)) {
    return;
  }
  closeComposerMenus();
}

async function setSelectedModel(modelId) {
  await savePreferences({
    selectedModelId: String(modelId || "").trim(),
  });
}

async function toggleThreadPin(threadId) {
  const nextPinnedThreadIDs = new Set(state.pinnedThreadIds);
  if (nextPinnedThreadIDs.has(threadId)) {
    nextPinnedThreadIDs.delete(threadId);
  } else {
    nextPinnedThreadIDs.add(threadId);
  }

  try {
    const response = await api("/api/pinned-threads", {
      method: "PUT",
      body: {
        threadIds: [...nextPinnedThreadIDs],
      },
    });
    state.pinnedThreadIds = response.threadIds || [];
    state.threads = state.threads.map((thread) => (
      thread.id === threadId
        ? { ...thread, pinned: state.pinnedThreadIds.includes(thread.id) }
        : { ...thread, pinned: state.pinnedThreadIds.includes(thread.id) }
    ));
    renderThreads();
  } catch (error) {
    showAppError(error.message);
  }
}

async function savePreferences(nextPreferences) {
  try {
    const response = await api("/api/preferences", {
      method: "PUT",
      body: nextPreferences,
    });
    state.selectedModelId = response.preferences?.selectedModelId || "";
    renderComposerMeta();
    renderThreads();
  } catch (error) {
    showAppError(error.message);
  }
}

function handleHomePrimaryAction() {
  const phase = connectionPhase();
  if (phase === "connected") {
    void disconnectBridge();
    return;
  }
  if (!elements.pairingJson.value.trim()) {
    setCurrentView("connection");
    return;
  }
  void connectBridge();
}

function handleHomeSecondaryAction() {
  if (isBridgeConnected()) {
    setCurrentView("connection");
    return;
  }
  void loadDefaultPairing();
}

function handleBannerAction() {
  setCurrentView("connection");
}

async function maybeAutoConnect(pairingPayload) {
  if (state.autoConnectAttempted || isBridgeConnected()) {
    return isBridgeConnected();
  }

  state.autoConnectAttempted = true;
  if (!pairingPayload) {
    showAppError("Load or generate a pairing JSON payload before connecting.");
    return false;
  }

  const pairingProblem = pairingUsabilityProblem(pairingPayload);
  if (pairingProblem) {
    const refreshedPairing = await tryRefreshPairingForConnection(pairingProblem);
    if (!refreshedPairing) {
      showAppError(pairingProblem);
      return false;
    }
    pairingPayload = refreshedPairing;
  }

  return connectBridgeWithPayload(pairingPayload);
}

function ensurePollers() {
  stopPollers();
  state.statusPoller = window.setInterval(refreshStatus, 5000);
  state.threadPoller = window.setInterval(refreshThreads, 9000);
  state.messagePoller = window.setInterval(refreshActiveThread, 2500);
}

function stopPollers() {
  window.clearInterval(state.statusPoller);
  window.clearInterval(state.threadPoller);
  window.clearInterval(state.messagePoller);
}

function showAppError(message) {
  state.appError = message;
  elements.appError.hidden = false;
  elements.appError.textContent = message;
  renderBanner();
  renderHomeState();
}

function distanceFromBottom(element) {
  if (!element) {
    return 0;
  }
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function isNearBottom(element, threshold = 96) {
  return distanceFromBottom(element) <= threshold;
}

function clearAppError() {
  state.appError = "";
  elements.appError.hidden = true;
  elements.appError.textContent = "";
  renderBanner();
  renderHomeState();
}

function readPairingFromEditor() {
  const raw = elements.pairingJson.value.trim();
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function pairingUsabilityProblem(pairingPayload) {
  const expiresAt = Number(pairingPayload?.expiresAt || 0);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
    return "This pairing QR has expired. Generate a new one from the bridge.";
  }
  return "";
}

async function tryRefreshPairingForConnection(problem) {
  if (!String(problem || "").toLowerCase().includes("expired")) {
    return null;
  }

  try {
    const refreshedPairing = await loadDefaultPairing({ forceRefresh: true });
    if (!refreshedPairing || pairingUsabilityProblem(refreshedPairing)) {
      return null;
    }
    return refreshedPairing;
  } catch {
    return null;
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
    },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.code = payload.code || "";
    error.status = response.status;
    error.ban = payload.ban || null;
    if (response.status === 401 && !options.allowUnauthenticated) {
      leaveAuthenticatedMode("Session expired. Sign in again.");
    }
    throw error;
  }
  return payload;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function describeBan(ban) {
  if (!ban) {
    return "";
  }
  return `${ban.message} Lift time: ${formatTimestamp(ban.banUntil)}.`;
}

function selectedModelRequestValue() {
  const selectedModelId = String(state.selectedModelId || "").trim();
  return selectedModelId || undefined;
}

function selectedModelOption() {
  const selectedModelId = String(state.selectedModelId || "").trim();
  if (!selectedModelId) {
    return null;
  }
  return state.availableModels.find((model) => model.id === selectedModelId || model.model === selectedModelId) || null;
}

function defaultModelOption() {
  return state.availableModels.find((model) => model.isDefault) || state.availableModels[0] || null;
}

function defaultModelDisplayName() {
  const defaultModel = defaultModelOption();
  if (!defaultModel) {
    return "Auto";
  }
  return `Auto (${defaultModel.displayName})`;
}

function activeModelDisplayName() {
  return selectedModelOption()?.displayName || state.selectedModelId || defaultModelDisplayName();
}

function describeModelOption(option) {
  const detail = String(option.description || "").trim();
  if (detail) {
    return detail;
  }
  if (option.model && option.model !== option.displayName) {
    return option.model;
  }
  return option.id ? `Identifier: ${option.id}` : "Use this model for new turns.";
}

function isSelectedModelOption(modelId) {
  const selectedModelId = String(state.selectedModelId || "").trim();
  return selectedModelId
    ? selectedModelId === String(modelId || "").trim()
    : !String(modelId || "").trim();
}

function prioritizeThreads(threads) {
  return [...threads].sort((left, right) => {
    const pinPriority = Number(isPinnedThread(right.id, right)) - Number(isPinnedThread(left.id, left));
    if (pinPriority !== 0) {
      return pinPriority;
    }
    return byRecentThread(left, right);
  });
}

function groupThreads(threads) {
  const pinnedThreads = prioritizeThreads(threads.filter((thread) => isPinnedThread(thread.id, thread)));
  const groups = new Map();
  for (const thread of threads) {
    if (isPinnedThread(thread.id, thread)) {
      continue;
    }
    const cwd = String(thread.cwd || "").trim();
    const key = cwd || "__ungrouped__";
    const label = cwd ? baseName(cwd) : "Unscoped";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        threads: [],
      });
    }
    groups.get(key).threads.push(thread);
  }

  const projectGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      threads: [...group.threads].sort(byRecentThread),
    }))
    .sort((left, right) => {
      const leftTime = decodeTime(left.threads[0]?.updatedAt || left.threads[0]?.createdAt);
      const rightTime = decodeTime(right.threads[0]?.updatedAt || right.threads[0]?.createdAt);
      return rightTime - leftTime;
    });

  if (!pinnedThreads.length) {
    return projectGroups;
  }

  return [
    {
      key: "__pinned__",
      label: "Pinned",
      threads: pinnedThreads,
    },
    ...projectGroups,
  ];
}

function byRecentThread(left, right) {
  return decodeTime(right.updatedAt || right.createdAt) - decodeTime(left.updatedAt || left.createdAt);
}

function describeThreadRow(thread) {
  const parts = [];
  if (thread.model) {
    parts.push(thread.model);
  }
  if (thread.preview) {
    parts.push(thread.preview);
  } else if (thread.cwd) {
    parts.push(thread.cwd);
  } else {
    parts.push(thread.id);
  }
  return parts.filter(Boolean).join(" · ");
}

function isPinnedThread(threadId, thread = null) {
  if (state.pinnedThreadIds.includes(threadId)) {
    return true;
  }
  return Boolean(thread?.pinned);
}

function describeActiveThreadSubtitle(thread) {
  const parts = [];
  if (thread.cwd) {
    parts.push(thread.cwd);
  }
  if (thread.model) {
    parts.push(thread.model);
  }
  if (!parts.length && thread.id) {
    parts.push(thread.id);
  }
  return parts.join(" · ");
}

function connectionPhase() {
  if (state.isConnecting) {
    return "connecting";
  }
  if (isBridgeConnected()) {
    return "connected";
  }
  return "offline";
}

function connectionBadgeLabel(phase) {
  switch (phase) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    default:
      return "Offline";
  }
}

function homeStatusLabel(phase) {
  switch (phase) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    default:
      return "Offline";
  }
}

function homePrimaryLabel(phase) {
  switch (phase) {
    case "connecting":
      return "Connecting...";
    case "connected":
      return "Disconnect";
    default:
      return elements.pairingJson.value.trim() ? "Connect to Bridge" : "Open Pairing";
  }
}

function badgeClassForPhase(phase) {
  switch (phase) {
    case "connecting":
      return "warm";
    case "connected":
      return "hot";
    default:
      return "cold";
  }
}

function dotClassForPhase(phase) {
  switch (phase) {
    case "connecting":
      return "warm";
    case "connected":
      return "hot";
    default:
      return "muted";
  }
}

function isBridgeConnected() {
  return Boolean(state.status?.isConnected && state.status?.isInitialized);
}

function isCompactLayout() {
  return window.innerWidth <= 980;
}

function describeSecuritySummary() {
  if (!state.security) {
    return "Security policy unavailable.";
  }

  const mode = state.security.allowlistEnabled
    ? "IP allowlist is enforced."
    : "IP allowlist is currently off.";
  const proxy = state.security.trustProxyHeaders
    ? "Cloudflare headers are trusted for known edge IPs."
    : "Requests are evaluated directly at the origin.";
  return `${mode} ${proxy}`;
}

function shortDeviceId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "Unknown";
  }
  if (text.length <= 12) {
    return text;
  }
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function baseName(value) {
  const normalized = String(value || "").replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || normalized || "Unscoped";
}

function splitTextareaLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function securityEditorIsActive() {
  const activeElement = document.activeElement;
  return activeElement === elements.allowedCidrs
    || activeElement === elements.trustedProxyCidrs
    || activeElement === elements.allowlistEnabled
    || activeElement === elements.trustProxyHeaders;
}

function compactRelativeTime(value) {
  const time = decodeTime(value);
  if (!time) {
    return "";
  }

  const seconds = Math.floor((Date.now() - time) / 1000);
  if (seconds < 60) {
    return "now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  if (seconds < 604800) {
    return `${Math.floor(seconds / 86400)}d`;
  }
  return formatDateOnly(time);
}

function decodeTime(value) {
  const parsed = new Date(value || 0);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTimestamp(value) {
  const parsed = new Date(Number.isFinite(value) ? Number(value) : value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString();
}

function formatDateOnly(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
