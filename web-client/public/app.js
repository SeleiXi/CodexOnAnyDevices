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
  selectedReasoningEffort: "",
  planModeArmed: false,
  pinnedThreadIds: [],
  threads: [],
  isLoadingThreads: false,
  searchQuery: "",
  activeThreadId: "",
  activeThread: null,
  messages: [],
  lastRenderedThreadId: "",
  forceScrollToBottom: false,
  isProjectLauncherOpen: false,
  isLoadingProjectSuggestions: false,
  projectSuggestions: [],
  projectSuggestionRequestId: 0,
  statusPoller: null,
  threadPoller: null,
  messagePoller: null,
  serverRequestDrafts: {},
};

const DEFAULT_PAIRING_RETRY_DELAYS_MS = [800, 1600];

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
  sidebarTools: document.querySelector("#sidebar-tools"),
  threadSearchInput: document.querySelector("#thread-search-input"),
  threadList: document.querySelector("#thread-list"),
  newThreadButton: document.querySelector("#new-thread-button"),
  newProjectButton: document.querySelector("#new-project-button"),
  projectLauncher: document.querySelector("#project-launcher"),
  projectLauncherForm: document.querySelector("#project-launcher"),
  projectLauncherInput: document.querySelector("#project-launcher-input"),
  projectSuggestionList: document.querySelector("#project-suggestion-list"),
  projectLauncherCancel: document.querySelector("#project-launcher-cancel"),
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
  reasoningButton: document.querySelector("#reasoning-button"),
  reasoningMenu: document.querySelector("#reasoning-menu"),
  reasoningSummary: document.querySelector("#reasoning-summary"),
  planButton: document.querySelector("#plan-button"),
  planSummary: document.querySelector("#plan-summary"),
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
  approvalSummary: document.querySelector("#approval-summary"),
  approvalDetails: document.querySelector("#approval-details"),
  approvalControls: document.querySelector("#approval-controls"),
  approvalActions: document.querySelector("#approval-actions"),
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
  elements.newThreadButton?.addEventListener("click", () => {
    void createThreadAndSelect();
  });
  elements.newProjectButton?.addEventListener("click", openProjectLauncher);
  elements.projectLauncherForm?.addEventListener("submit", createProjectThreadFromLauncher);
  elements.projectLauncherInput?.addEventListener("input", () => {
    setProjectPath(elements.projectLauncherInput.value);
    void refreshProjectSuggestions(elements.projectLauncherInput.value);
  });
  elements.projectLauncherCancel?.addEventListener("click", closeProjectLauncher);
  elements.homePrimaryButton.addEventListener("click", handleHomePrimaryAction);
  elements.homeSecondaryButton.addEventListener("click", handleHomeSecondaryAction);
  elements.statusBannerAction.addEventListener("click", handleBannerAction);
  elements.composerForm.addEventListener("submit", sendMessage);
  elements.modelButton.addEventListener("click", toggleModelMenu);
  elements.reasoningButton.addEventListener("click", toggleReasoningMenu);
  elements.planButton.addEventListener("click", togglePlanModeArmed);
  elements.accessModeButton.addEventListener("click", toggleAccessModeMenu);
  elements.accessModeOptions.forEach((button) => {
    button.addEventListener("click", handleAccessModeOptionSelect);
  });
  elements.loadDefaultPairing.addEventListener("click", loadDefaultPairing);
  elements.connectButton.addEventListener("click", handleConnectionConnectAction);
  elements.disconnectButton.addEventListener("click", disconnectBridge);
  elements.accessMode.addEventListener("change", renderComposerMeta);
  elements.projectPath.addEventListener("input", () => {
    setProjectPath(elements.projectPath.value);
    void refreshProjectSuggestions(elements.projectPath.value);
  });
  elements.saveSecurityButton.addEventListener("click", saveSecurityPolicy);
  elements.useCloudflareButton.addEventListener("click", applyCloudflareDefaults);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeComposerMenus();
    }
    if (event.key === "Escape" && state.sidebarOpen) {
      closeSidebar();
      return;
    }
    if (event.key === "Escape" && state.isProjectLauncherOpen) {
      closeProjectLauncher();
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
  const pairingPayload = await loadDefaultPairing({ retryOnFailure: true });
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
  state.selectedReasoningEffort = "";
  state.planModeArmed = false;
  state.pinnedThreadIds = [];
  state.threads = [];
  state.activeThreadId = "";
  state.activeThread = null;
  state.messages = [];
  state.lastRenderedThreadId = "";
  state.forceScrollToBottom = false;
  state.isProjectLauncherOpen = false;
  state.isLoadingProjectSuggestions = false;
  state.projectSuggestions = [];
  state.serverRequestDrafts = {};
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
  state.isProjectLauncherOpen = false;
  renderSidebarShell();
  renderProjectLauncher();
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
  if (elements.sidebarSettingsButton || !elements.sidebarTools) {
    return;
  }

  const button = document.createElement("button");
  button.id = "sidebar-settings-button";
  button.type = "button";
  button.className = "toolbar-button mobile-only sidebar-menu-button";
  button.textContent = "Settings";
  elements.sidebarTools.appendChild(button);
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
    pruneServerRequestDrafts();
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
    state.selectedReasoningEffort = response.preferences?.selectedReasoningEffort || "";
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
  const retryDelays = options.retryOnFailure ? DEFAULT_PAIRING_RETRY_DELAYS_MS : [];
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const query = options.forceRefresh ? "?refresh=1" : "";
      const response = await api(`/api/pairing/default${query}`);
      elements.pairingJson.value = JSON.stringify(response.pairingPayload, null, 2);
      renderHomeState();
      return response.pairingPayload || null;
    } catch (error) {
      if (attempt >= retryDelays.length) {
        showAppError(error.message);
        return null;
      }
      await delay(retryDelays[attempt]);
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
    state.isLoadingThreads = false;
    renderThreads();
    renderMessages();
    return;
  }

  state.isLoadingThreads = true;
  renderThreads();
  try {
    const response = await api("/api/threads");
    state.threads = mergePendingActiveThread(response.threads || []);
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
  } finally {
    state.isLoadingThreads = false;
    renderThreads();
  }
}

async function createThreadAndSelect(options = {}) {
  if (!isBridgeConnected()) {
    showAppError("Connect the bridge before creating a thread.");
    setCurrentView("connection");
    return;
  }

  const preferredProjectPath = resolvePreferredProjectPath(options.preferredProjectPath);
  try {
    const response = await api("/api/threads", {
      method: "POST",
      body: {
        cwd: preferredProjectPath,
        accessMode: elements.accessMode.value,
        model: selectedModelRequestValue(),
      },
    });
    state.activeThreadId = response.thread.id;
    state.activeThread = response.thread;
    state.messages = [];
    state.threads = mergePendingActiveThread(state.threads);
    if (preferredProjectPath) {
      elements.projectPath.value = preferredProjectPath;
    }
    renderMessages();
    renderThreads();
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
    clearAppError();
    renderMessages();
    renderThreads();
  } catch (error) {
    showAppError(error.message);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.composerInput.value;
  if (!text.trim()) {
    return;
  }
  if (!isBridgeConnected()) {
    showAppError("Connect the bridge before sending messages.");
    setCurrentView("connection");
    return;
  }

  clearAppError();
  elements.composerInput.disabled = true;
  const shouldUsePlanMode = state.planModeArmed;
  try {
    if (!state.activeThreadId) {
      await createThreadAndSelect();
    }
    if (!state.activeThreadId) {
      return;
    }

    const collaborationMode = shouldUsePlanMode ? buildPlanCollaborationModePayload() : undefined;

    await api(`/api/threads/${encodeURIComponent(state.activeThreadId)}/turns`, {
      method: "POST",
      body: {
        text,
        cwd: elements.projectPath.value,
        accessMode: elements.accessMode.value,
        model: selectedModelRequestValue(),
        effort: selectedReasoningEffortRequestValue(),
        collaborationMode,
      },
    });
    elements.composerInput.value = "";
    if (shouldUsePlanMode) {
      state.planModeArmed = false;
    }
    state.forceScrollToBottom = true;
    renderComposerMeta();
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
  return respondToServerRequest({ decision });
}

async function respondToServerRequest(payload) {
  const requestId = activePendingServerRequest()?.id || "";
  try {
    await api("/api/server-requests/current/respond", {
      method: "POST",
      body: payload,
    });
    if (requestId) {
      delete state.serverRequestDrafts[requestId];
    }
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
  renderProjectLauncher();
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
      : "Connect with automatic local pairing. Manual JSON is only needed for custom hosts.";

  elements.pairedMacLabel.textContent = isConnected ? "Connected to Computer" : state.status?.macDeviceId ? "Saved Mac" : "No Pairing";
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
    empty.className = `thread-empty ${state.isLoadingThreads ? "is-loading" : ""}`;
    empty.textContent = threadEmptyMessage();
    elements.threadList.appendChild(empty);
    return;
  }

  for (const group of groupThreads(filteredThreads)) {
    const section = document.createElement("section");
    section.className = "thread-group";

    const heading = document.createElement("header");
    heading.className = "thread-group-heading";
    const headingLabel = document.createElement("div");
    headingLabel.className = "thread-group-heading-label";
    headingLabel.innerHTML = `
      <span>${escapeHTML(group.label)}</span>
      <span>${group.threads.length}</span>
    `;
    heading.appendChild(headingLabel);

    if (group.projectPath) {
      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.className = "thread-group-action";
      createButton.textContent = "New";
      createButton.addEventListener("click", async () => {
        await createThreadAndSelect({
          preferredProjectPath: group.projectPath,
        });
      });
      heading.appendChild(createButton);
    }

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
      pinButton.innerHTML = "&#128204;";
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

function threadEmptyMessage() {
  if (!isBridgeConnected()) {
    return "Connect the bridge to load chats.";
  }
  if (state.isLoadingThreads) {
    return "Loading conversations...";
  }
  return state.searchQuery ? "No matching conversations." : "No conversations yet.";
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
    article.className = `message-card role-${message.role} kind-${message.kind || "chat"}`;
    renderMessageCard(article, message);
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
    elements.trustedPairTitle.textContent = isConnected ? "Connected to Computer" : "Saved Mac";
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
  elements.homeSecondaryButton.textContent = "Connection Settings";
}

function renderBanner() {
  const pendingRequest = activePendingServerRequest();
  if (pendingRequest) {
    elements.statusBanner.hidden = false;
    if (pendingRequest.kind === "userInputPrompt") {
      elements.statusBannerTitle.textContent = "Bridge needs more input";
      elements.statusBannerCopy.textContent = describeServerRequestSummary(pendingRequest);
      elements.statusBannerAction.textContent = "Chat";
      return;
    }
    elements.statusBannerTitle.textContent = "Bridge is waiting for approval";
    elements.statusBannerCopy.textContent = describeServerRequestSummary(pendingRequest);
    elements.statusBannerAction.textContent = "Review";
    return;
  }

  const lastModelReroute = state.status?.lastModelReroute || null;
  if (lastModelReroute?.reason || lastModelReroute?.toModel || lastModelReroute?.fromModel) {
    elements.statusBanner.hidden = false;
    elements.statusBannerTitle.textContent = "Model was rerouted";
    elements.statusBannerCopy.textContent = describeModelReroute(lastModelReroute);
    elements.statusBannerAction.textContent = "Chat";
    return;
  }

  const lastPlanModeDowngrade = state.status?.lastPlanModeDowngrade || null;
  if (lastPlanModeDowngrade?.reason) {
    elements.statusBanner.hidden = false;
    elements.statusBannerTitle.textContent = "Plan mode was downgraded";
    elements.statusBannerCopy.textContent = lastPlanModeDowngrade.reason;
    elements.statusBannerAction.textContent = "Chat";
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
  const request = activeApprovalRequest();
  if (!request) {
    elements.approvalPanel.hidden = true;
    elements.approvalSummary.textContent = "";
    elements.approvalDetails.innerHTML = "";
    elements.approvalControls.innerHTML = "";
    elements.approvalControls.hidden = true;
    elements.approvalActions.innerHTML = "";
    return;
  }

  elements.approvalPanel.hidden = false;
  elements.approvalSummary.textContent = describeServerRequestSummary(request);

  elements.approvalDetails.innerHTML = "";
  appendDetailRow(elements.approvalDetails, "Type", approvalTypeLabel(request));
  appendDetailRow(elements.approvalDetails, "Reason", request.reason);
  appendDetailRow(elements.approvalDetails, "Command", request.command);
  appendDetailRow(elements.approvalDetails, "Working directory", request.cwd);
  appendDetailRow(elements.approvalDetails, "Grant root", request.grantRoot);
  appendObjectDetail(elements.approvalDetails, "Permissions", request.permissions);

  elements.approvalControls.innerHTML = "";
  elements.approvalControls.hidden = true;
  if (request.kind === "permissionsApproval") {
    const draft = getServerRequestDraft(request.id);
    const scopeLabel = document.createElement("label");
    scopeLabel.className = "approval-control";
    scopeLabel.innerHTML = `
      <span>Grant scope</span>
      <select>
        <option value="turn">This turn</option>
        <option value="session">This session</option>
      </select>
    `;
    const select = scopeLabel.querySelector("select");
    select.value = draft.scope === "session" ? "session" : "turn";
    select.addEventListener("change", (event) => {
      getServerRequestDraft(request.id).scope = event.currentTarget.value === "session" ? "session" : "turn";
    });
    elements.approvalControls.hidden = false;
    elements.approvalControls.appendChild(scopeLabel);
  }

  elements.approvalActions.innerHTML = "";
  for (const action of approvalActionsForRequest(request)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.emphasis === "primary" ? "primary-button" : "ghost-button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      const draft = getServerRequestDraft(request.id);
      await respondToServerRequest({
        decision: action.decision,
        scope: draft.scope || "turn",
      });
    });
    elements.approvalActions.appendChild(button);
  }
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

  const selectedReasoningLabel = activeReasoningDisplayTitle();
  elements.reasoningSummary.textContent = selectedReasoningLabel;
  elements.reasoningButton.setAttribute("aria-label", `Thinking level: ${selectedReasoningLabel}`);
  elements.reasoningButton.disabled = supportedReasoningOptions().length === 0;
  renderReasoningMenu();

  const canPlan = Boolean(resolvePlanModeModelIdentifier());
  elements.planButton.disabled = !canPlan;
  elements.planButton.classList.toggle("selected", state.planModeArmed);
  elements.planButton.setAttribute("aria-pressed", state.planModeArmed ? "true" : "false");
  elements.planButton.setAttribute(
    "aria-label",
    state.planModeArmed ? "Plan mode armed for the next turn" : "Plan mode is off"
  );
  elements.planSummary.textContent = state.planModeArmed ? "Plan Next" : "Plan";
}

function setProjectPath(value) {
  const nextValue = String(value || "");
  if (elements.projectPath.value !== nextValue) {
    elements.projectPath.value = nextValue;
  }
  if (elements.projectLauncherInput?.value !== nextValue) {
    elements.projectLauncherInput.value = nextValue;
  }
  renderComposerMeta();
}

function openProjectLauncher() {
  if (!isBridgeConnected()) {
    showAppError("Connect the bridge before creating a project chat.");
    setCurrentView("connection");
    return;
  }

  if (isCompactLayout()) {
    state.sidebarOpen = true;
    renderSidebarShell();
  }
  state.isProjectLauncherOpen = true;
  setProjectPath(resolvePreferredProjectPath(elements.projectPath.value));
  renderProjectLauncher();
  void refreshProjectSuggestions(elements.projectPath.value);
  window.setTimeout(() => elements.projectLauncherInput?.focus(), 0);
}

function closeProjectLauncher() {
  state.isProjectLauncherOpen = false;
  renderProjectLauncher();
}

async function createProjectThreadFromLauncher(event) {
  event.preventDefault();
  const preferredProjectPath = elements.projectLauncherInput.value.trim();
  if (!preferredProjectPath) {
    showAppError("Choose a project directory first.");
    elements.projectLauncherInput.focus();
    return;
  }

  clearAppError();
  await createThreadAndSelect({ preferredProjectPath });
  if (state.activeThreadId) {
    closeProjectLauncher();
    closeSidebar();
  }
}

async function refreshProjectSuggestions(rawQuery = "") {
  const requestId = state.projectSuggestionRequestId + 1;
  state.projectSuggestionRequestId = requestId;
  state.isLoadingProjectSuggestions = true;
  renderProjectLauncher();

  try {
    const response = await api(`/api/project-suggestions?q=${encodeURIComponent(rawQuery || "")}`);
    if (requestId !== state.projectSuggestionRequestId) {
      return;
    }
    state.projectSuggestions = normalizeProjectSuggestions(response.suggestions || []);
  } catch {
    if (requestId !== state.projectSuggestionRequestId) {
      return;
    }
    state.projectSuggestions = normalizeProjectSuggestions([]);
  } finally {
    if (requestId === state.projectSuggestionRequestId) {
      state.isLoadingProjectSuggestions = false;
      renderProjectLauncher();
    }
  }
}

function normalizeProjectSuggestions(filesystemSuggestions) {
  const normalized = [];
  const seen = new Set();

  for (const suggestion of filesystemSuggestions) {
    const suggestionPath = String(suggestion?.path || "").trim();
    if (!suggestionPath || seen.has(suggestionPath)) {
      continue;
    }

    seen.add(suggestionPath);
    normalized.push({
      kind: suggestion.kind || "directory",
      label: suggestion.label || baseName(suggestionPath),
      detail: suggestion.detail || suggestionPath,
      path: suggestionPath,
    });

    if (normalized.length >= 12) {
      break;
    }
  }

  return normalized;
}

function renderProjectLauncher() {
  if (!elements.projectLauncher) {
    return;
  }

  elements.projectLauncher.hidden = !state.isProjectLauncherOpen;
  if (!state.isProjectLauncherOpen) {
    return;
  }

  elements.projectSuggestionList.innerHTML = "";

  if (state.isLoadingProjectSuggestions) {
    elements.projectSuggestionList.innerHTML = "<p class=\"project-suggestion-empty\">Loading server directories...</p>";
    return;
  }

  if (state.projectSuggestions.length === 0) {
    const query = elements.projectLauncherInput.value.trim();
    elements.projectSuggestionList.innerHTML = `<p class="project-suggestion-empty">${
      query
        ? "No matching directories on this server yet."
        : "Type a path like ~/coding/app to browse server directories."
    }</p>`;
    return;
  }

  for (const suggestion of state.projectSuggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-suggestion-button";
    button.innerHTML = `
      <span class="project-suggestion-top">
        <strong>${escapeHTML(suggestion.label || baseName(suggestion.path))}</strong>
        <span class="project-suggestion-kind">${escapeHTML(suggestion.kind || "directory")}</span>
      </span>
      <span class="project-suggestion-detail">${escapeHTML(suggestion.detail || suggestion.path)}</span>
    `;
    button.addEventListener("click", () => {
      clearAppError();
      setProjectPath(suggestion.path);
      void refreshProjectSuggestions(suggestion.path);
    });
    elements.projectSuggestionList.appendChild(button);
  }
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

  const selectedModelId = String(state.selectedModelId || "").trim();
  const customValue = selectedModelId && !selectedModelOption() ? selectedModelId : "";
  const customForm = document.createElement("form");
  customForm.className = "model-custom-form";
  customForm.innerHTML = `
    <label class="model-custom-label">
      <span>Custom model id</span>
      <input class="model-custom-input" type="text" value="${escapeAttribute(customValue)}" placeholder="model id" autocomplete="off" />
    </label>
    <button class="ghost-button compact" type="submit">Use</button>
  `;
  customForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = customForm.querySelector(".model-custom-input");
    const modelId = String(input?.value || "").trim();
    if (!modelId) {
      showAppError("Enter a model id first.");
      return;
    }
    await setSelectedModel(modelId);
    setModelMenuOpen(false);
  });
  elements.modelMenu.appendChild(customForm);
}

function renderReasoningMenu() {
  elements.reasoningMenu.innerHTML = "";
  const options = supportedReasoningOptions();

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "access-mode-option";
    empty.textContent = "No thinking levels";
    elements.reasoningMenu.appendChild(empty);
    return;
  }

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `access-mode-option ${isSelectedReasoningEffort(option.reasoningEffort) ? "selected" : ""}`;
    button.innerHTML = `
      <strong>${escapeHTML(reasoningDisplayTitle(option.reasoningEffort))}</strong>
      <span>${escapeHTML(option.description || "Thinking level for this model.")}</span>
    `;
    button.addEventListener("click", async () => {
      await setSelectedReasoningEffort(option.reasoningEffort);
      setReasoningMenuOpen(false);
    });
    elements.reasoningMenu.appendChild(button);
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
    setReasoningMenuOpen(false);
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
    setReasoningMenuOpen(false);
  }
  elements.modelMenu.hidden = !open;
  elements.modelButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function isReasoningMenuOpen() {
  return Boolean(elements.reasoningMenu && !elements.reasoningMenu.hidden);
}

function setReasoningMenuOpen(open) {
  if (!elements.reasoningMenu || !elements.reasoningButton) {
    return;
  }
  if (open) {
    setAccessModeMenuOpen(false);
    setModelMenuOpen(false);
  }
  elements.reasoningMenu.hidden = !open;
  elements.reasoningButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleAccessModeMenu(event) {
  event.stopPropagation();
  setAccessModeMenuOpen(!isAccessModeMenuOpen());
}

function toggleModelMenu(event) {
  event.stopPropagation();
  setModelMenuOpen(!isModelMenuOpen());
}

function toggleReasoningMenu(event) {
  event.stopPropagation();
  setReasoningMenuOpen(!isReasoningMenuOpen());
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
  setReasoningMenuOpen(false);
}

function handleGlobalClick(event) {
  if (!isAccessModeMenuOpen() && !isModelMenuOpen() && !isReasoningMenuOpen()) {
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
    || elements.modelMenu.contains(target)
    || elements.reasoningButton.contains(target)
    || elements.reasoningMenu.contains(target)) {
    return;
  }
  closeComposerMenus();
}

async function setSelectedModel(modelId) {
  await savePreferences({
    selectedModelId: String(modelId || "").trim(),
  });
}

async function setSelectedReasoningEffort(reasoningEffort) {
  await savePreferences({
    selectedReasoningEffort: String(reasoningEffort || "").trim(),
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
    state.selectedReasoningEffort = response.preferences?.selectedReasoningEffort || "";
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
  void connectDefaultPairing();
}

function handleHomeSecondaryAction() {
  setCurrentView("connection");
}

function handleConnectionConnectAction() {
  if (elements.pairingJson.value.trim()) {
    void connectBridge();
    return;
  }
  void connectDefaultPairing();
}

async function connectDefaultPairing() {
  clearAppError();
  const pairingPayload = await loadDefaultPairing({ retryOnFailure: true });
  if (!pairingPayload) {
    setCurrentView("connection");
    return;
  }
  await connectBridge({ pairingPayload });
}

async function handleBannerAction() {
  const pendingRequest = activePendingServerRequest();
  if (pendingRequest?.threadId) {
    state.activeThreadId = pendingRequest.threadId;
    await refreshActiveThread();
    renderThreads();
  }

  if (pendingRequest?.kind === "userInputPrompt") {
    setCurrentView("chat");
    return;
  }

  if (!pendingRequest && (state.status?.lastPlanModeDowngrade?.reason || state.status?.lastModelReroute?.reason)) {
    setCurrentView("chat");
    return;
  }

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
  return selectedModelId || defaultModelRequestValue() || undefined;
}

function selectedReasoningEffortRequestValue() {
  const effort = effectiveReasoningEffort();
  return effort || undefined;
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

function defaultModelRequestValue() {
  const defaultModel = defaultModelOption();
  return String(defaultModel?.model || defaultModel?.id || "").trim();
}

function activeModelDisplayName() {
  return selectedModelOption()?.displayName || state.selectedModelId || defaultModelDisplayName();
}

function mergePendingActiveThread(threads) {
  const nextThreads = Array.isArray(threads) ? [...threads] : [];
  if (!state.activeThreadId || !state.activeThread || state.activeThread.id !== state.activeThreadId) {
    return nextThreads;
  }
  if (nextThreads.some((thread) => thread.id === state.activeThreadId)) {
    return nextThreads;
  }
  return [state.activeThread, ...nextThreads];
}

function effectiveModelOption() {
  return selectedModelOption() || defaultModelOption();
}

function supportedReasoningOptions() {
  return effectiveModelOption()?.supportedReasoningEfforts || [];
}

function effectiveReasoningEffort() {
  const supportedOptions = supportedReasoningOptions();
  const supportedEfforts = new Set(supportedOptions.map((option) => option.reasoningEffort));
  if (!supportedEfforts.size) {
    return "";
  }

  const selectedReasoningEffort = String(state.selectedReasoningEffort || "").trim();
  if (selectedReasoningEffort && supportedEfforts.has(selectedReasoningEffort)) {
    return selectedReasoningEffort;
  }

  const defaultEffort = String(effectiveModelOption()?.defaultReasoningEffort || "").trim();
  if (defaultEffort && supportedEfforts.has(defaultEffort)) {
    return defaultEffort;
  }

  if (supportedEfforts.has("medium")) {
    return "medium";
  }

  return supportedOptions[0]?.reasoningEffort || "";
}

function reasoningDisplayTitle(effort) {
  const normalized = String(effort || "").trim().toLowerCase();
  switch (normalized) {
    case "minimal":
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
    case "extra_high":
    case "extra-high":
    case "very_high":
    case "very-high":
      return "Extra High";
    default:
      return normalized
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") || "Thinking";
  }
}

function activeReasoningDisplayTitle() {
  return reasoningDisplayTitle(effectiveReasoningEffort());
}

function resolvePlanModeModelIdentifier() {
  const explicitModel = selectedModelRequestValue();
  if (explicitModel) {
    return explicitModel;
  }

  const effectiveModel = effectiveModelOption();
  return String(effectiveModel?.model || effectiveModel?.id || "").trim() || "";
}

function buildPlanCollaborationModePayload() {
  const model = resolvePlanModeModelIdentifier();
  if (!model) {
    throw new Error("Plan mode requires an available model before sending.");
  }

  return {
    mode: "plan",
    settings: {
      model,
      reasoning_effort: selectedReasoningEffortRequestValue() || null,
      developer_instructions: null,
    },
  };
}

function togglePlanModeArmed() {
  if (!resolvePlanModeModelIdentifier()) {
    showAppError("Plan mode requires an available model before sending.");
    return;
  }

  clearAppError();
  state.planModeArmed = !state.planModeArmed;
  renderComposerMeta();
}

function isSelectedReasoningEffort(effort) {
  return effectiveReasoningEffort() === String(effort || "").trim();
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
        projectPath: cwd || "",
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
      projectPath: "",
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
  return parts.filter(Boolean).join(" ? ");
}

function isPinnedThread(threadId, thread = null) {
  if (state.pinnedThreadIds.includes(threadId)) {
    return true;
  }
  return Boolean(thread?.pinned);
}

function resolvePreferredProjectPath(preferredProjectPath) {
  const explicitProjectPath = String(preferredProjectPath || "").trim();
  if (explicitProjectPath) {
    return explicitProjectPath;
  }

  const composerProjectPath = String(elements.projectPath.value || "").trim();
  if (composerProjectPath) {
    return composerProjectPath;
  }

  const activeThreadProjectPath = String(state.activeThread?.cwd || "").trim();
  if (activeThreadProjectPath) {
    return activeThreadProjectPath;
  }

  const firstProjectThread = prioritizeThreads(state.threads).find((thread) => String(thread.cwd || "").trim());
  return String(firstProjectThread?.cwd || "").trim();
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
  return parts.join(" ? ");
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
      return "Connect Local Bridge";
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
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
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

function escapeAttribute(value) {
  return escapeHTML(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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

function activePendingServerRequest() {
  const request = state.status?.pendingServerRequest || state.status?.pendingApproval || null;
  return request && typeof request === "object" ? request : null;
}

function activeApprovalRequest() {
  const request = activePendingServerRequest();
  if (!request || request.kind === "userInputPrompt") {
    return null;
  }
  return request;
}

function pruneServerRequestDrafts() {
  const activeRequestId = activePendingServerRequest()?.id || "";
  if (!activeRequestId) {
    state.serverRequestDrafts = {};
    return;
  }

  const activeDraft = state.serverRequestDrafts[activeRequestId];
  state.serverRequestDrafts = activeDraft
    ? { [activeRequestId]: activeDraft }
    : {};
}

function getServerRequestDraft(requestId) {
  const normalizedId = String(requestId || "").trim();
  if (!normalizedId) {
    return {
      scope: "turn",
      answersByQuestionId: {},
    };
  }

  if (!state.serverRequestDrafts[normalizedId]) {
    state.serverRequestDrafts[normalizedId] = {
      scope: "turn",
      answersByQuestionId: {},
    };
  }
  return state.serverRequestDrafts[normalizedId];
}

function getQuestionDraft(requestId, questionId) {
  const draft = getServerRequestDraft(requestId);
  if (!draft.answersByQuestionId[questionId]) {
    draft.answersByQuestionId[questionId] = {
      selectedOption: "",
      customAnswer: "",
    };
  }
  return draft.answersByQuestionId[questionId];
}

function renderMessageCard(article, message) {
  const kindLabel = messageKindLabel(message);
  if (kindLabel) {
    const header = document.createElement("div");
    header.className = "message-card-header";
    header.innerHTML = `
      <span class="message-kind">${escapeHTML(kindLabel)}</span>
      <time class="message-time">${escapeHTML(compactRelativeTime(message.createdAt || ""))}</time>
    `;
    article.appendChild(header);
  }

  if (message.kind === "plan") {
    renderPlanMessageCard(article, message);
    return;
  }

  if (message.kind === "userInputPrompt") {
    renderUserInputPromptCard(article, message);
    return;
  }

  appendMessageText(article, message.text);
}

function renderPlanMessageCard(article, message) {
  const planState = message.planState || {};
  if (planState.explanation) {
    const explanation = document.createElement("p");
    explanation.className = "plan-explanation";
    explanation.textContent = planState.explanation;
    article.appendChild(explanation);
  }

  if (message.text && message.text !== planState.explanation) {
    appendMessageText(article, message.text);
  }

  const steps = Array.isArray(planState.steps) ? planState.steps : [];
  if (!steps.length) {
    return;
  }

  const list = document.createElement("div");
  list.className = "plan-step-list";
  for (const step of steps) {
    const row = document.createElement("div");
    row.className = `plan-step status-${normalizePlanStatus(step.status)}`;
    row.innerHTML = `
      <span class="plan-step-status">${escapeHTML(planStatusLabel(step.status))}</span>
      <span class="plan-step-text">${escapeHTML(step.step || "")}</span>
    `;
    list.appendChild(row);
  }
  article.appendChild(list);
}

function renderUserInputPromptCard(article, message) {
  const requestId = String(message.requestId || message.id || "").trim();
  const questions = message.structuredUserInputRequest?.questions || [];

  if (message.text) {
    const intro = document.createElement("p");
    intro.className = "support-copy muted";
    intro.textContent = message.text;
    article.appendChild(intro);
  }

  const form = document.createElement("form");
  form.className = "structured-request-form";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitStructuredUserInputRequest(requestId, questions);
  });

  for (const question of questions) {
    const card = document.createElement("section");
    card.className = "prompt-question-card";

    const label = document.createElement("div");
    label.className = "prompt-question-header";
    label.innerHTML = `
      <strong>${escapeHTML(question.header || "Question")}</strong>
      <p>${escapeHTML(question.question || "")}</p>
    `;
    card.appendChild(label);

    const questionDraft = getQuestionDraft(requestId, question.id);
    const selectedOption = questionDraft.customAnswer ? "" : String(questionDraft.selectedOption || "");

    if (Array.isArray(question.options) && question.options.length > 0) {
      const options = document.createElement("div");
      options.className = "prompt-option-list";
      question.options.forEach((option, index) => {
        const optionId = `${requestId}-${question.id}-${index}`;
        const optionLabel = document.createElement("label");
        optionLabel.className = "prompt-option";
        optionLabel.innerHTML = `
          <input type="radio" name="question-${escapeHTML(question.id)}" value="${escapeHTML(option.label || "")}">
          <span>
            <strong>${escapeHTML(option.label || "Option")}</strong>
            <small>${escapeHTML(option.description || "")}</small>
          </span>
        `;
        const input = optionLabel.querySelector("input");
        input.id = optionId;
        input.checked = selectedOption === String(option.label || "");
        input.addEventListener("change", () => {
          const draft = getQuestionDraft(requestId, question.id);
          draft.selectedOption = String(option.label || "");
          draft.customAnswer = "";
        });
        options.appendChild(optionLabel);
      });
      card.appendChild(options);
    }

    const freeInput = document.createElement(question.isSecret ? "input" : "textarea");
    freeInput.className = "prompt-free-input";
    if (question.isSecret) {
      freeInput.type = "password";
    } else {
      freeInput.rows = 2;
    }
    freeInput.placeholder = question.options?.length ? "Other answer" : "Your answer";
    freeInput.value = questionDraft.customAnswer || "";
    freeInput.addEventListener("input", (event) => {
      const draft = getQuestionDraft(requestId, question.id);
      draft.customAnswer = event.currentTarget.value;
      if (draft.customAnswer.trim()) {
        draft.selectedOption = "";
      }
    });
    card.appendChild(freeInput);

    form.appendChild(card);
  }

  const actions = document.createElement("div");
  actions.className = "prompt-actions";
  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "primary-button";
  submitButton.textContent = "Submit response";
  actions.appendChild(submitButton);
  form.appendChild(actions);

  article.appendChild(form);
}

async function submitStructuredUserInputRequest(requestId, questions) {
  const request = activePendingServerRequest();
  if (!request || request.kind !== "userInputPrompt" || request.id !== requestId) {
    showAppError("The input request is no longer active.");
    return;
  }

  const answersByQuestionId = {};
  for (const question of questions) {
    const draft = getQuestionDraft(requestId, question.id);
    const answer = String(draft.customAnswer || draft.selectedOption || "").trim();
    if (!answer) {
      showAppError(`${question.header || "Question"} requires an answer.`);
      return;
    }
    answersByQuestionId[question.id] = [answer];
  }

  clearAppError();
  await respondToServerRequest({
    answersByQuestionId,
  });
}

function appendMessageText(container, text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return;
  }
  const pre = document.createElement("pre");
  pre.textContent = normalizedText;
  container.appendChild(pre);
}

function appendDetailRow(container, label, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return;
  }

  const row = document.createElement("div");
  row.className = "approval-detail-row";
  row.innerHTML = `
    <span>${escapeHTML(label)}</span>
    <strong>${escapeHTML(normalizedValue)}</strong>
  `;
  container.appendChild(row);
}

function appendObjectDetail(container, label, value) {
  if (!value || typeof value !== "object" || Object.keys(value).length === 0) {
    return;
  }

  const section = document.createElement("div");
  section.className = "approval-detail-block";
  const title = document.createElement("span");
  title.className = "approval-detail-label";
  title.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(value, null, 2);
  section.appendChild(title);
  section.appendChild(pre);
  container.appendChild(section);
}

function messageKindLabel(message) {
  switch (message.kind) {
    case "thinking":
      return "Thinking";
    case "tool":
      return "Tool Call";
    case "command":
      return "Command";
    case "file":
      return "File Change";
    case "plan":
      return "Plan";
    case "userInputPrompt":
      return "Input Required";
    default:
      return message.role === "system" ? "System" : "";
  }
}

function normalizePlanStatus(status) {
  const normalized = String(status || "").trim();
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "inProgress" || normalized === "in_progress") {
    return "in-progress";
  }
  return "pending";
}

function planStatusLabel(status) {
  switch (normalizePlanStatus(status)) {
    case "completed":
      return "Done";
    case "in-progress":
      return "Active";
    default:
      return "Pending";
  }
}

function approvalTypeLabel(request) {
  switch (request.kind) {
    case "fileChangeApproval":
      return "File change";
    case "permissionsApproval":
      return "Permissions";
    case "applyPatchApproval":
      return "Apply patch";
    case "execCommandApproval":
      return "Command execution";
    default:
      return "Command";
  }
}

function describeServerRequestSummary(request) {
  if (!request) {
    return "";
  }

  if (request.kind === "userInputPrompt") {
    const count = Array.isArray(request.questions) ? request.questions.length : 0;
    return count
      ? `${count} question${count === 1 ? "" : "s"} require a response before the turn can continue.`
      : "The bridge needs more input before the turn can continue.";
  }

  if (request.reason) {
    return request.reason;
  }

  if (request.command) {
    return request.command;
  }

  switch (request.kind) {
    case "permissionsApproval":
      return "The bridge needs permission approval before continuing.";
    case "fileChangeApproval":
      return "The bridge wants to change files in the workspace.";
    case "applyPatchApproval":
      return "The bridge is waiting for patch approval.";
    case "execCommandApproval":
      return "The bridge is waiting for command approval.";
    default:
      return "Review the request before the task continues.";
  }
}

function describeModelReroute(reroute) {
  const fromModel = String(reroute?.fromModel || "").trim();
  const toModel = String(reroute?.toModel || "").trim();
  const reason = String(reroute?.reason || "").trim();
  const modelCopy = fromModel && toModel
    ? `Request rerouted from ${fromModel} to ${toModel}.`
    : toModel
      ? `Request rerouted to ${toModel}.`
      : "The runtime chose a different model for this turn.";
  return reason ? `${modelCopy} ${reason}` : modelCopy;
}

function approvalActionsForRequest(request) {
  if (request.kind === "permissionsApproval") {
    return [
      { decision: "accept", label: "Approve", emphasis: "primary" },
      { decision: "decline", label: "Decline", emphasis: "secondary" },
    ];
  }

  const defaults = request.kind === "applyPatchApproval" || request.kind === "execCommandApproval"
    ? ["approved", "approved_for_session", "denied", "abort"]
    : ["accept", "acceptForSession", "decline", "cancel"];
  const rawDecisions = Array.isArray(request.availableDecisions) && request.availableDecisions.length
    ? request.availableDecisions
    : defaults;

  return rawDecisions
    .map((decision) => approvalActionMeta(decision))
    .filter(Boolean);
}

function approvalActionMeta(decision) {
  const normalized = String(decision || "").trim();
  switch (normalized) {
    case "accept":
    case "approved":
      return { decision: normalized, label: "Approve", emphasis: "primary" };
    case "acceptForSession":
    case "approved_for_session":
      return { decision: normalized, label: "Approve for Session", emphasis: "secondary" };
    case "decline":
      return { decision: normalized, label: "Decline", emphasis: "secondary" };
    case "denied":
      return { decision: normalized, label: "Deny", emphasis: "secondary" };
    case "cancel":
      return { decision: normalized, label: "Cancel", emphasis: "secondary" };
    case "abort":
      return { decision: normalized, label: "Abort", emphasis: "secondary" };
    default:
      return null;
  }
}
