const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} = require("crypto");
const { WebSocket } = require("ws");
const { createAuthManager } = require("./auth");
const { createBridgeRuntimeManager } = require("./bridge-runtime");
const { createSecurityManager } = require("./security");

const ROOT_DIR = __dirname;
const REPO_DIR = path.dirname(ROOT_DIR);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STATE_DIR = path.join(ROOT_DIR, "state");
const AUTH_STATE_FILE = path.join(STATE_DIR, "auth-state.json");
const SECURITY_STATE_FILE = path.join(STATE_DIR, "security-state.json");
const PHONE_IDENTITY_FILE = path.join(STATE_DIR, "phone-identity.json");
const UI_PREFERENCES_FILE = path.join(STATE_DIR, "ui-preferences.json");
const DEFAULT_PAIRING_FILE = path.join(REPO_DIR, "remodex-pairing.json");
const HTTP_PORT = Number.parseInt(process.env.PORT || "8787", 10);
const PREFER_LOCAL_RELAY = process.env.REMODEX_WEB_PREFER_LOCAL_RELAY !== "false";
const LOCAL_RELAY_HOST = process.env.REMODEX_WEB_LOCAL_RELAY_HOST || "127.0.0.1";
const SECURE_PROTOCOL_VERSION = 1;
const HANDSHAKE_TAG = "remodex-e2ee-v1";
const HANDSHAKE_LABEL = "client-auth";
const HANDSHAKE_MODE_QR_BOOTSTRAP = "qr_bootstrap";
const SECURE_SENDER_IPHONE = "iphone";
const SECURE_SENDER_MAC = "mac";
const THREAD_LIST_SOURCE_KINDS = ["cli", "vscode", "appServer", "exec", "unknown"];
const CONTROL_MESSAGE_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1024 * 1024;
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CODEX_GLOBAL_STATE_FILE = path.join(CODEX_HOME, ".codex-global-state.json");

class RemodexWebClient {
  constructor() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    this.phoneIdentity = loadOrCreatePhoneIdentity(PHONE_IDENTITY_FILE);
    this.socket = null;
    this.pairingPayload = null;
    this.secureSession = null;
    this.pendingControlWaiters = new Set();
    this.pendingRequests = new Map();
    this.pendingApproval = null;
    this.pendingServerRequest = null;
    this.lastAppliedBridgeOutboundSeq = 0;
    this.isConnected = false;
    this.isInitialized = false;
    this.lastDisconnect = null;
    this.cachedModels = [];
    this.supportsTurnCollaborationMode = true;
    this.lastPlanModeDowngrade = null;
    this.lastModelReroute = null;
    this.transientPlanStateByThread = new Map();
  }

  status() {
    return {
      isConnected: this.isConnected,
      isInitialized: this.isInitialized,
      secureSessionId: this.secureSession?.sessionId || "",
      relayUrl: this.pairingPayload?.relay || "",
      macDeviceId: this.pairingPayload?.macDeviceId || "",
      phoneDeviceId: this.phoneIdentity.phoneDeviceId,
      pendingApproval: this.pendingApproval,
      pendingServerRequest: this.pendingServerRequest,
      lastPlanModeDowngrade: this.lastPlanModeDowngrade,
      lastModelReroute: this.lastModelReroute,
      lastDisconnect: this.lastDisconnect,
    };
  }

  async connect(pairingPayload) {
    const payload = validatePairingPayload(pairingPayload);
    await this.disconnect();

    this.pairingPayload = payload;
    this.pendingApproval = null;
    this.pendingServerRequest = null;
    this.lastAppliedBridgeOutboundSeq = 0;
    this.lastDisconnect = null;
    this.lastPlanModeDowngrade = null;
    this.lastModelReroute = null;
    this.transientPlanStateByThread.clear();

    const relayURL = new URL(`${payload.relay.replace(/\/+$/, "")}/${payload.sessionId}`);
    const socket = await openWebSocket(relayURL.toString(), {
      headers: {
        "x-role": "iphone",
      },
    });

    this.socket = socket;
    this.attachSocketHandlers(socket);

    try {
      await this.performSecureHandshake(payload);
      await this.initializeSession();
      this.isConnected = true;
      return this.status();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.isConnected = false;
    this.isInitialized = false;
    this.pendingApproval = null;
    this.pendingServerRequest = null;
    this.clearPendingWithoutReject();
    this.secureSession = null;
    this.lastPlanModeDowngrade = null;
    this.lastModelReroute = null;
    this.transientPlanStateByThread.clear();

    if (!socket) {
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      socket.once("close", finish);
      socket.once("error", finish);

      try {
        socket.close(1000, "Client disconnect");
      } catch {
        finish();
      }

      setTimeout(finish, 1000).unref?.();
    });
  }

  attachSocketHandlers(socket) {
    socket.on("message", (chunk) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.handleWireMessage(text);
    });

    socket.on("close", (code, reason) => {
      this.lastDisconnect = {
        code,
        reason: reason ? reason.toString("utf8") : "",
      };
      this.isConnected = false;
      this.isInitialized = false;
      this.pendingApproval = null;
      this.pendingServerRequest = null;
      this.lastModelReroute = null;
      this.transientPlanStateByThread.clear();
      this.rejectAllPending(new Error(`Relay closed (${code}) ${this.lastDisconnect.reason}`.trim()));
      rejectControlWaiters(
        this.pendingControlWaiters,
        new Error(`Relay closed (${code}) ${this.lastDisconnect.reason}`.trim())
      );
      this.pendingControlWaiters.clear();
      this.socket = null;
      this.secureSession = null;
    });

    socket.on("error", (error) => {
      this.lastDisconnect = {
        code: 0,
        reason: error.message,
      };
    });
  }

  async performSecureHandshake(payload) {
    const phoneEphemeral = generateKeyPairSync("x25519");
    const phoneEphemeralJwk = phoneEphemeral.privateKey.export({ format: "jwk" });
    const clientNonce = randomBytes(32);
    const clientHello = {
      kind: "clientHello",
      protocolVersion: SECURE_PROTOCOL_VERSION,
      sessionId: payload.sessionId,
      handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
      phoneDeviceId: this.phoneIdentity.phoneDeviceId,
      phoneIdentityPublicKey: this.phoneIdentity.phoneIdentityPublicKey,
      phoneEphemeralPublicKey: base64UrlToBase64(phoneEphemeralJwk.x),
      clientNonce: clientNonce.toString("base64"),
    };

    this.sendWireControlMessage(clientHello);

    const serverHello = await this.waitForControl((message) => {
      if (message.kind === "secureError") {
        throw new Error(message.message || message.code || "Secure handshake failed");
      }
      return message.kind === "serverHello" && message.sessionId === payload.sessionId;
    });

    if (serverHello.protocolVersion !== SECURE_PROTOCOL_VERSION) {
      throw new Error("Secure protocol version mismatch");
    }
    if (serverHello.sessionId !== payload.sessionId) {
      throw new Error("Unexpected secure session id");
    }
    if (serverHello.macDeviceId !== payload.macDeviceId) {
      throw new Error("Mac device id mismatch");
    }
    if (serverHello.macIdentityPublicKey !== payload.macIdentityPublicKey) {
      throw new Error("Mac public key mismatch");
    }

    const transcriptBytes = buildTranscriptBytes({
      sessionId: payload.sessionId,
      protocolVersion: serverHello.protocolVersion,
      handshakeMode: serverHello.handshakeMode,
      keyEpoch: serverHello.keyEpoch,
      macDeviceId: serverHello.macDeviceId,
      phoneDeviceId: this.phoneIdentity.phoneDeviceId,
      macIdentityPublicKey: serverHello.macIdentityPublicKey,
      phoneIdentityPublicKey: this.phoneIdentity.phoneIdentityPublicKey,
      macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
      phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey,
      clientNonce,
      serverNonce: base64ToBuffer(serverHello.serverNonce),
      expiresAtForTranscript: serverHello.expiresAtForTranscript,
    });

    const serverSignatureValid = verifyTranscript(
      serverHello.macIdentityPublicKey,
      transcriptBytes,
      serverHello.macSignature
    );
    if (!serverSignatureValid) {
      throw new Error("Mac signature verification failed");
    }

    const clientAuthTranscript = Buffer.concat([
      transcriptBytes,
      encodeLengthPrefixedUTF8(HANDSHAKE_LABEL),
    ]);
    const phoneSignature = signTranscript(
      this.phoneIdentity.phoneIdentityPrivateKey,
      this.phoneIdentity.phoneIdentityPublicKey,
      clientAuthTranscript
    );

    this.sendWireControlMessage({
      kind: "clientAuth",
      sessionId: payload.sessionId,
      phoneDeviceId: this.phoneIdentity.phoneDeviceId,
      keyEpoch: serverHello.keyEpoch,
      phoneSignature,
    });

    const readyMessage = await this.waitForControl((message) => {
      if (message.kind === "secureError") {
        throw new Error(message.message || message.code || "Secure handshake failed");
      }
      return message.kind === "secureReady"
        && message.sessionId === payload.sessionId
        && Number(message.keyEpoch) === Number(serverHello.keyEpoch);
    });

    if (readyMessage.macDeviceId !== payload.macDeviceId) {
      throw new Error("Unexpected mac device id in secureReady");
    }

    const sharedSecret = diffieHellman({
      privateKey: createPrivateKey({
        key: {
          crv: "X25519",
          d: phoneEphemeralJwk.d,
          x: phoneEphemeralJwk.x,
          kty: "OKP",
        },
        format: "jwk",
      }),
      publicKey: createPublicKey({
        key: {
          crv: "X25519",
          x: base64ToBase64Url(serverHello.macEphemeralPublicKey),
          kty: "OKP",
        },
        format: "jwk",
      }),
    });

    const salt = createHash("sha256").update(transcriptBytes).digest();
    const infoPrefix = [
      HANDSHAKE_TAG,
      payload.sessionId,
      payload.macDeviceId,
      this.phoneIdentity.phoneDeviceId,
      String(serverHello.keyEpoch),
    ].join("|");

    this.secureSession = {
      sessionId: payload.sessionId,
      keyEpoch: serverHello.keyEpoch,
      phoneToMacKey: deriveAesKey(sharedSecret, salt, `${infoPrefix}|phoneToMac`),
      macToPhoneKey: deriveAesKey(sharedSecret, salt, `${infoPrefix}|macToPhone`),
      lastInboundCounter: -1,
      nextOutboundCounter: 0,
    };

    this.sendWireControlMessage({
      kind: "resumeState",
      sessionId: payload.sessionId,
      keyEpoch: serverHello.keyEpoch,
      lastAppliedBridgeOutboundSeq: this.lastAppliedBridgeOutboundSeq,
    });
  }

  async initializeSession() {
    const modernParams = {
      clientInfo: {
        name: "remodex_web",
        title: "Remodex Web",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    };

    try {
      await this.sendRequest("initialize", modernParams);
    } catch (error) {
      if (!shouldRetryInitializeWithoutCapabilities(error)) {
        throw error;
      }

      await this.sendRequest("initialize", {
        clientInfo: modernParams.clientInfo,
      });
    }

    await this.sendNotification("initialized", null);
    this.isInitialized = true;
  }

  async listThreads(limit = 40) {
    const response = await this.sendRequest("thread/list", {
      sourceKinds: THREAD_LIST_SOURCE_KINDS,
      cursor: null,
      limit,
    });
    const result = response.result || {};
    const items = result.data || result.items || result.threads || [];
    const pinnedThreadIDs = new Set(readPinnedThreadIds());
    return items
      .map((threadObject) => decodeThreadSummary(threadObject, pinnedThreadIDs))
      .filter(Boolean);
  }

  async listModels(limit = 50) {
    const response = await this.sendRequest("model/list", {
      cursor: null,
      limit,
      includeHidden: false,
    });
    const result = response.result || {};
    const items = result.data || result.items || result.models || [];
    const models = items.map(decodeModelOption).filter(Boolean);
    this.cachedModels = models;
    return models;
  }

  async createThread({ cwd = "", accessMode = "full-access", model = "" } = {}) {
    const params = {};
    if (cwd.trim()) {
      params.cwd = cwd.trim();
    }
    if (String(model || "").trim()) {
      params.model = String(model).trim();
    }
    const response = await this.sendRequestWithSandboxFallback("thread/start", params, accessMode);
    const thread = response.result?.thread;
    if (!thread) {
      throw new Error("thread/start response missing thread");
    }
    return decodeThreadSummary(thread);
  }

  async resumeThread(threadId, { cwd = "", accessMode = "full-access", model = "" } = {}) {
    const params = {
      threadId,
    };
    if (cwd.trim()) {
      params.cwd = cwd.trim();
    }
    if (String(model || "").trim()) {
      params.model = String(model).trim();
    }
    try {
      return await this.sendRequestWithSandboxFallback("thread/resume", params, accessMode);
    } catch (error) {
      if (shouldIgnoreThreadResumeFailure(error)) {
        return null;
      }
      throw error;
    }
  }

  async startTurn(
    threadId,
    text,
    {
      accessMode = "full-access",
      cwd = "",
      model = "",
      effort = "",
      collaborationMode = null,
    } = {}
  ) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      throw new Error("Message cannot be empty");
    }

    this.lastPlanModeDowngrade = null;
    await this.resumeThread(threadId, { cwd, accessMode, model });

    let includeCollaborationMode = Boolean(
      collaborationMode
      && this.supportsTurnCollaborationMode
      && typeof collaborationMode === "object"
    );

    while (true) {
      const params = buildTurnStartParams({
        threadId,
        text: trimmed,
        model,
        effort,
        collaborationMode: includeCollaborationMode ? collaborationMode : null,
      });

      try {
        const response = await this.sendRequestWithSandboxFallback("turn/start", params, accessMode);
        return response.result || {};
      } catch (error) {
        if (!includeCollaborationMode || !shouldRetryTurnStartWithoutCollaborationMode(error)) {
          throw error;
        }

        includeCollaborationMode = false;
        this.supportsTurnCollaborationMode = false;
        this.lastPlanModeDowngrade = {
          occurredAt: new Date().toISOString(),
          reason: "Plan mode is not supported by this runtime. The turn was sent as a normal message instead.",
        };
      }
    }
  }

  async readThread(threadId) {
    try {
      const response = await this.sendRequest("thread/read", {
        threadId,
        includeTurns: true,
      });
      const threadObject = response.result?.thread;
      if (!threadObject) {
        throw new Error("thread/read response missing thread");
      }

      return {
        thread: decodeThreadSummary(threadObject),
        messages: mergeTransientThreadMessages(
          threadId,
          decodeThreadMessages(threadId, threadObject),
          {
            pendingServerRequest: this.pendingServerRequest,
            transientPlanState: this.transientPlanStateByThread.get(threadId) || null,
          }
        ),
      };
    } catch (error) {
      if (!shouldTreatThreadAsEmpty(error)) {
        throw error;
      }

      const response = await this.sendRequest("thread/read", {
        threadId,
      });
      const threadObject = response.result?.thread;
      if (!threadObject) {
        throw error;
      }

      return {
        thread: decodeThreadSummary(threadObject),
        messages: mergeTransientThreadMessages(threadId, [], {
          pendingServerRequest: this.pendingServerRequest,
          transientPlanState: this.transientPlanStateByThread.get(threadId) || null,
        }),
      };
    }
  }

  async respondToApproval(decision) {
    return this.respondToPendingServerRequest({ decision });
  }

  async respondToPendingServerRequest(payload = {}) {
    const request = this.pendingServerRequest || this.pendingApproval;
    if (!request) {
      throw new Error("No pending server request");
    }

    const result = buildServerRequestResponsePayload(request, payload);
    await this.sendMessage({
      id: request.id,
      result,
    });

    this.pendingServerRequest = null;
    this.pendingApproval = null;
    return this.status();
  }

  async sendRequestWithSandboxFallback(method, baseParams, accessMode) {
    const firstAttempt = {
      ...baseParams,
      sandboxPolicy: runtimeSandboxPolicyObject(accessMode),
    };

    try {
      return await this.sendRequestWithApprovalPolicyFallback(method, firstAttempt, accessMode);
    } catch (error) {
      if (!shouldFallbackFromSandboxPolicy(error)) {
        throw error;
      }
    }

    const secondAttempt = {
      ...baseParams,
      sandbox: sandboxLegacyValue(accessMode),
    };

    try {
      return await this.sendRequestWithApprovalPolicyFallback(method, secondAttempt, accessMode);
    } catch (error) {
      if (!shouldFallbackFromSandboxPolicy(error)) {
        throw error;
      }
    }

    return this.sendRequestWithApprovalPolicyFallback(method, baseParams, accessMode);
  }

  async sendRequestWithApprovalPolicyFallback(method, baseParams, accessMode) {
    const candidates = approvalPolicyCandidates(accessMode);
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const params = {
        ...baseParams,
        approvalPolicy: candidates[index],
      };

      try {
        return await this.sendRequest(method, params);
      } catch (error) {
        lastError = error;
        const hasMore = index < candidates.length - 1;
        if (hasMore && shouldRetryWithApprovalPolicyFallback(error)) {
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`${method} failed`);
  }

  async sendRequest(method, params) {
    const requestId = randomUUID();
    let pendingRecord = null;
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`${method} timed out`));
      }, 30_000);
      timeout.unref?.();

      pendingRecord = {
        resolve,
        reject,
        timeout,
        method,
      };
      this.pendingRequests.set(requestId, pendingRecord);
    });

    try {
      await this.sendMessage({
        id: requestId,
        method,
        params,
      });
    } catch (error) {
      if (pendingRecord) {
        clearTimeout(pendingRecord.timeout);
      }
      this.pendingRequests.delete(requestId);
      throw error;
    }

    return responsePromise;
  }

  async sendNotification(method, params) {
    await this.sendMessage({
      method,
      params,
    });
  }

  async sendMessage(message) {
    if (!this.secureSession || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Remodex secure session is not connected");
    }

    const payloadText = JSON.stringify(message);
    const envelope = encryptEnvelopePayload(
      {
        bridgeOutboundSeq: null,
        payloadText,
      },
      this.secureSession.phoneToMacKey,
      SECURE_SENDER_IPHONE,
      this.secureSession.nextOutboundCounter,
      this.secureSession.sessionId,
      this.secureSession.keyEpoch
    );
    this.secureSession.nextOutboundCounter += 1;
    this.socket.send(JSON.stringify(envelope));
  }

  sendWireControlMessage(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  waitForControl(match) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControlWaiters.delete(waiter);
        reject(new Error("Secure control message timed out"));
      }, CONTROL_MESSAGE_TIMEOUT_MS);
      timeout.unref?.();

      const waiter = {
        match,
        resolve,
        reject,
        timeout,
      };
      this.pendingControlWaiters.add(waiter);
    });
  }

  handleWireMessage(text) {
    const message = safeParseJSON(text);
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.kind === "serverHello" || message.kind === "secureReady" || message.kind === "secureError") {
      for (const waiter of [...this.pendingControlWaiters]) {
        try {
          const isMatch = waiter.match(message);
          if (!isMatch) {
            continue;
          }
          clearTimeout(waiter.timeout);
          this.pendingControlWaiters.delete(waiter);
          waiter.resolve(message);
        } catch (error) {
          clearTimeout(waiter.timeout);
          this.pendingControlWaiters.delete(waiter);
          waiter.reject(error);
        }
      }
      return;
    }

    if (message.kind === "encryptedEnvelope") {
      this.handleEncryptedEnvelope(message);
    }
  }

  handleEncryptedEnvelope(envelope) {
    if (!this.secureSession) {
      return;
    }
    if (envelope.sessionId !== this.secureSession.sessionId) {
      return;
    }
    if (Number(envelope.keyEpoch) !== Number(this.secureSession.keyEpoch)) {
      return;
    }
    if (envelope.sender !== SECURE_SENDER_MAC) {
      return;
    }
    if (Number(envelope.counter) <= this.secureSession.lastInboundCounter) {
      return;
    }

    const decrypted = decryptEnvelopeBuffer(
      envelope,
      this.secureSession.macToPhoneKey,
      SECURE_SENDER_MAC,
      envelope.counter
    );
    if (!decrypted) {
      return;
    }

    this.secureSession.lastInboundCounter = Number(envelope.counter);

    const applicationPayload = safeParseJSON(decrypted.toString("utf8"));
    if (!applicationPayload || typeof applicationPayload !== "object") {
      return;
    }
    if (Number.isInteger(applicationPayload.bridgeOutboundSeq)) {
      this.lastAppliedBridgeOutboundSeq = Math.max(
        this.lastAppliedBridgeOutboundSeq,
        applicationPayload.bridgeOutboundSeq
      );
    }

    const rpcMessage = safeParseJSON(applicationPayload.payloadText);
    if (!rpcMessage || typeof rpcMessage !== "object") {
      return;
    }

    this.routeRpcMessage(rpcMessage);
  }

  routeRpcMessage(rpcMessage) {
    const requestId = rpcMessage.id != null ? String(rpcMessage.id) : "";
    if (requestId && (Object.hasOwn(rpcMessage, "result") || Object.hasOwn(rpcMessage, "error"))) {
      const pending = this.pendingRequests.get(requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      if (rpcMessage.error) {
        pending.reject(toRpcError(rpcMessage.error));
      } else {
        pending.resolve(rpcMessage);
      }
      return;
    }

    if (requestId && rpcMessage.method) {
      this.handleServerRequest(rpcMessage);
      return;
    }

    if (rpcMessage.method) {
      this.handleServerNotification(rpcMessage);
    }
  }

  handleServerRequest(rpcMessage) {
    const request = decodeServerRequest(rpcMessage);
    if (!request) {
      return;
    }

    this.pendingServerRequest = request;
    this.pendingApproval = request.isApprovalLike ? request : null;
  }

  handleServerNotification(rpcMessage) {
    const method = String(rpcMessage.method || "").trim();
    const params = rpcMessage.params && typeof rpcMessage.params === "object"
      ? rpcMessage.params
      : null;
    if (!method || !params) {
      return;
    }

    if (method === "serverRequest/resolved") {
      const resolvedId = params.requestId != null ? String(params.requestId) : "";
      if (resolvedId && this.pendingServerRequest?.id === resolvedId) {
        this.pendingServerRequest = null;
        this.pendingApproval = null;
      }
      return;
    }

    if (method === "turn/plan/updated") {
      const threadId = stringOrEmpty(params.threadId);
      if (!threadId) {
        return;
      }

      this.transientPlanStateByThread.set(threadId, {
        threadId,
        turnId: stringOrEmpty(params.turnId),
        explanation: stringOrEmpty(params.explanation),
        steps: decodePlanSteps(params.plan),
        text: this.transientPlanStateByThread.get(threadId)?.text || "",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (method === "item/plan/delta") {
      const threadId = stringOrEmpty(params.threadId);
      if (!threadId) {
        return;
      }

      const existing = this.transientPlanStateByThread.get(threadId) || {
        threadId,
        turnId: stringOrEmpty(params.turnId),
        explanation: "",
        steps: [],
        text: "",
        updatedAt: new Date().toISOString(),
      };

      existing.turnId = existing.turnId || stringOrEmpty(params.turnId);
      existing.itemId = stringOrEmpty(params.itemId) || existing.itemId || "";
      existing.text = `${existing.text || ""}${stringOrEmpty(params.delta)}`;
      existing.updatedAt = new Date().toISOString();
      this.transientPlanStateByThread.set(threadId, existing);
      return;
    }

    if (method === "model/rerouted") {
      this.lastModelReroute = {
        threadId: stringOrEmpty(params.threadId),
        turnId: stringOrEmpty(params.turnId),
        fromModel: stringOrEmpty(params.fromModel),
        toModel: stringOrEmpty(params.toModel),
        reason: stringOrEmpty(params.reason),
        occurredAt: new Date().toISOString(),
      };
    }
  }

  rejectAllPending(error) {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  clearPendingWithoutReject() {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();

    for (const waiter of this.pendingControlWaiters) {
      clearTimeout(waiter.timeout);
    }
    this.pendingControlWaiters.clear();
  }
}

const client = new RemodexWebClient();
const auth = createAuthManager({
  stateFile: AUTH_STATE_FILE,
  forceSecureCookies: process.env.REMODEX_WEB_COOKIE_SECURE === "true",
});
const security = createSecurityManager({
  stateFile: SECURITY_STATE_FILE,
  initialState: {
    allowlistEnabled: process.env.REMODEX_WEB_ALLOWLIST_ENABLED === "true",
    trustProxyHeaders: process.env.REMODEX_WEB_TRUST_PROXY_HEADERS === "true",
    allowedCidrs: parseEnvList(process.env.REMODEX_WEB_ALLOWLIST),
    trustedProxyCidrs: parseEnvList(process.env.REMODEX_WEB_TRUSTED_PROXY_CIDRS),
  },
});
const bridgeRuntime = createBridgeRuntimeManager({
  repoDir: REPO_DIR,
  pairingFile: DEFAULT_PAIRING_FILE,
  stateDir: STATE_DIR,
  defaultHostname: process.env.REMODEX_WEB_BRIDGE_HOSTNAME || "",
  defaultPort: Number.parseInt(process.env.REMODEX_WEB_BRIDGE_PORT || "9100", 10),
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const connection = security.assertRequestAllowed(req);

    res.setHeader("x-remodex-client-ip", connection.clientIp);
    res.setHeader("x-remodex-allowlist", security.getSummary(req).allowlistEnabled ? "enforced" : "disabled");

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, url);
      return;
    }

    serveStaticFile(res, url.pathname);
  } catch (error) {
    writeJson(res, error.status || 500, {
      ok: false,
      error: error.message || "Internal server error",
      code: error.code || "internal_error",
      ban: error.ban || null,
      remainingBeforeShortBan: error.remainingBeforeShortBan ?? null,
    });
  }
});

if (require.main === module) {
  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`[remodex-web] listening on http://0.0.0.0:${HTTP_PORT}`);
    if (!auth.hasPasswordConfigured()) {
      console.warn("[remodex-web] admin password is not configured; run `npm run set-password -- --generate`");
    }
    const securitySummary = security.getSummary({
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    });
    console.log(
      `[remodex-web] allowlist=${securitySummary.allowlistEnabled ? "on" : "off"} proxy_headers=${securitySummary.trustProxyHeaders ? "trusted" : "direct"}`
    );
  });
}

async function handleApiRequest(req, res, url) {
  const connection = security.assertRequestAllowed(req);

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    writeJson(res, 200, {
      ok: true,
      ...auth.getAuthSessionSummary(req),
      ban: auth.getCurrentBan(connection.clientIp),
      security: security.getSummary(req),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJsonBody(req);
    const result = auth.login({
      password: body.password || "",
      ip: connection.clientIp,
      userAgent: req.headers["user-agent"] || "",
    });
    res.setHeader(
      "set-cookie",
      auth.buildSessionCookie(result.token, {
        expiresAt: result.expiresAt,
        secure: requestIsSecure(req),
      })
    );
    writeJson(res, 200, {
      ok: true,
      authenticated: true,
      expiresAt: result.expiresAt,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    auth.logout(req);
    res.setHeader(
      "set-cookie",
      auth.buildClearSessionCookie({
        secure: requestIsSecure(req),
      })
    );
    writeJson(res, 200, {
      ok: true,
      authenticated: false,
    });
    return;
  }

  const authSession = auth.getAuthSession(req);
  if (!authSession) {
    writeJson(res, 401, {
      ok: false,
      code: "not_authenticated",
      error: "Authentication required",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    writeJson(res, 200, {
      ok: true,
      status: client.status(),
      security: security.getSummary(req),
      session: {
        createdAt: authSession.createdAt,
        expiresAt: authSession.expiresAt,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/security") {
    writeJson(res, 200, {
      ok: true,
      security: security.getSummary(req),
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/security") {
    const body = await readJsonBody(req);
    const nextState = security.update({
      allowlistEnabled: body.allowlistEnabled,
      trustProxyHeaders: body.trustProxyHeaders,
      allowedCidrs: body.allowedCidrs,
      trustedProxyCidrs: body.trustedProxyCidrs,
    });
    writeJson(res, 200, {
      ok: true,
      security: {
        ...nextState,
        currentRequestIp: connection.clientIp,
        remoteAddress: connection.remoteAddress,
        proxyHeaderTrusted: connection.proxyHeaderTrusted,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runtime-config") {
    let models = client.cachedModels;
    if (client.status().isConnected) {
      try {
        models = await client.listModels();
      } catch (error) {
        if (!models.length) {
          throw error;
        }
      }
    }

    writeJson(res, 200, {
      ok: true,
      models,
      preferences: readUiPreferences(),
      isConnected: client.status().isConnected,
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/preferences") {
    const body = await readJsonBody(req);
    const currentPreferences = readUiPreferences();
    const nextPreferences = {
      ...currentPreferences,
      ...(Object.prototype.hasOwnProperty.call(body, "selectedModelId")
        ? { selectedModelId: body.selectedModelId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "selectedReasoningEffort")
        ? { selectedReasoningEffort: body.selectedReasoningEffort }
        : {}),
    };

    writeJson(res, 200, {
      ok: true,
      preferences: writeUiPreferences(nextPreferences),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pinned-threads") {
    writeJson(res, 200, {
      ok: true,
      threadIds: readPinnedThreadIds(),
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/pinned-threads") {
    const body = await readJsonBody(req);
    writeJson(res, 200, {
      ok: true,
      threadIds: writePinnedThreadIds(body.threadIds),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pairing/default") {
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const existingPairing = readJsonFileSafe(DEFAULT_PAIRING_FILE);
    const allowStale = Boolean(client.status().isConnected && existingPairing);
    const pairingPayload = await bridgeRuntime.ensureFreshPairing({
      forceRefresh,
      allowStale,
    });

    writeJson(res, 200, {
      ok: true,
      pairingPayload: pairPayloadForWeb(pairingPayload),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/connect") {
    const body = await readJsonBody(req);
    const status = await client.connect(body.pairingPayload || body);
    writeJson(res, 200, {
      ok: true,
      status,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/disconnect") {
    await client.disconnect();
    writeJson(res, 200, {
      ok: true,
      status: client.status(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/threads") {
    const threads = await client.listThreads();
    writeJson(res, 200, {
      ok: true,
      threads,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/threads") {
    const body = await readJsonBody(req);
    const thread = await client.createThread(body || {});
    writeJson(res, 200, {
      ok: true,
      thread,
    });
    return;
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (req.method === "GET" && threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const data = await client.readThread(threadId);
    writeJson(res, 200, {
      ok: true,
      ...data,
    });
    return;
  }

  const turnMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/turns$/);
  if (req.method === "POST" && turnMatch) {
    const threadId = decodeURIComponent(turnMatch[1]);
    const body = await readJsonBody(req);
    const result = await client.startTurn(threadId, body.text || "", body || {});
    writeJson(res, 200, {
      ok: true,
      result,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/server-requests/current/respond") {
    const body = await readJsonBody(req);
    const status = await client.respondToPendingServerRequest(body || {});
    writeJson(res, 200, {
      ok: true,
      status,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals/current") {
    const body = await readJsonBody(req);
    const status = await client.respondToPendingServerRequest({
      ...body,
      decision: body.decision || "accept",
    });
    writeJson(res, 200, {
      ok: true,
      status,
    });
    return;
  }

  writeJson(res, 404, {
    ok: false,
    error: "Not found",
  });
}

function serveStaticFile(res, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.join(PUBLIC_DIR, path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, ""));
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    writeText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    writeText(res, 404, "Not found");
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ttf": "font/ttf",
  }[extension] || "application/octet-stream";

  res.statusCode = 200;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store, max-age=0");
  fs.createReadStream(resolvedPath).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function writeJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function writeText(res, status, text) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readUiPreferences() {
  return normalizeUiPreferences(readJsonFileSafe(UI_PREFERENCES_FILE));
}

function writeUiPreferences(nextPreferences) {
  const normalized = normalizeUiPreferences(nextPreferences);
  fs.writeFileSync(UI_PREFERENCES_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function readPinnedThreadIds() {
  const payload = readJsonFileSafe(CODEX_GLOBAL_STATE_FILE);
  const state = payload && typeof payload === "object" ? payload : {};
  return normalizeStringArray(state["pinned-thread-ids"]);
}

function writePinnedThreadIds(threadIds) {
  const normalizedThreadIDs = normalizeStringArray(threadIds);
  const payload = readJsonFileSafe(CODEX_GLOBAL_STATE_FILE);
  const nextState = payload && typeof payload === "object" ? payload : {};
  nextState["pinned-thread-ids"] = normalizedThreadIDs;
  fs.mkdirSync(path.dirname(CODEX_GLOBAL_STATE_FILE), { recursive: true });
  fs.writeFileSync(CODEX_GLOBAL_STATE_FILE, `${JSON.stringify(nextState)}\n`, "utf8");
  return normalizedThreadIDs;
}

function normalizeUiPreferences(value) {
  const objectValue = value && typeof value === "object" ? value : {};
  const selectedModelId = String(objectValue.selectedModelId || "").trim();
  const selectedReasoningEffort = String(objectValue.selectedReasoningEffort || "").trim();

  return {
    selectedModelId,
    selectedReasoningEffort,
  };
}

function normalizeStringArray(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
}

function requestIsSecure(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return Boolean(req.socket?.encrypted) || forwardedProto === "https";
}

function parseEnvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pairPayloadForWeb(pairingPayload) {
  if (!PREFER_LOCAL_RELAY || !pairingPayload || typeof pairingPayload !== "object") {
    return pairingPayload;
  }

  const relay = rewriteRelayToLocal(pairingPayload.relay);
  return {
    ...pairingPayload,
    relay,
  };
}

function rewriteRelayToLocal(relay) {
  try {
    const parsed = new URL(String(relay || ""));
    parsed.hostname = LOCAL_RELAY_HOST;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return relay;
  }
}

function loadOrCreatePhoneIdentity(stateFile) {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  }

  const keyPair = generateKeyPairSync("ed25519");
  const privateJwk = keyPair.privateKey.export({ format: "jwk" });
  const nextIdentity = {
    phoneDeviceId: randomUUID(),
    phoneIdentityPrivateKey: base64UrlToBase64(privateJwk.d),
    phoneIdentityPublicKey: base64UrlToBase64(privateJwk.x),
  };
  fs.writeFileSync(stateFile, JSON.stringify(nextIdentity, null, 2), { mode: 0o600 });
  return nextIdentity;
}

function validatePairingPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing pairing payload");
  }

  const normalized = {
    v: Number(payload.v),
    relay: String(payload.relay || "").trim(),
    sessionId: String(payload.sessionId || "").trim(),
    macDeviceId: String(payload.macDeviceId || "").trim(),
    macIdentityPublicKey: String(payload.macIdentityPublicKey || "").trim(),
    expiresAt: Number(payload.expiresAt),
  };

  if (!normalized.relay || !normalized.sessionId || !normalized.macDeviceId || !normalized.macIdentityPublicKey) {
    throw new Error("Pairing payload is incomplete");
  }
  if (!Number.isFinite(normalized.expiresAt)) {
    throw new Error("Pairing payload expiresAt is invalid");
  }
  if (Date.now() > normalized.expiresAt) {
    throw new Error("This pairing QR has expired. Generate a new one from the bridge.");
  }

  return normalized;
}

function approvalPolicyCandidates(accessMode) {
  return accessMode === "on-request" ? ["on-request", "onRequest"] : ["never"];
}

function sandboxLegacyValue(accessMode) {
  return accessMode === "on-request" ? "workspace-write" : "danger-full-access";
}

function runtimeSandboxPolicyObject(accessMode) {
  if (accessMode === "on-request") {
    return {
      type: "workspaceWrite",
      networkAccess: true,
    };
  }

  return {
    type: "dangerFullAccess",
  };
}

function shouldRetryWithApprovalPolicyFallback(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError || (rpcError.code !== -32600 && rpcError.code !== -32602)) {
    return false;
  }
  const message = rpcError.message.toLowerCase();
  return message.includes("approval")
    || message.includes("unknown variant")
    || message.includes("expected one of")
    || message.includes("onrequest")
    || message.includes("on-request");
}

function shouldFallbackFromSandboxPolicy(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError || (rpcError.code !== -32600 && rpcError.code !== -32602)) {
    return false;
  }
  const message = rpcError.message.toLowerCase();
  if (message.includes("thread not found") || message.includes("unknown thread")) {
    return false;
  }
  return message.includes("invalid params")
    || message.includes("invalid param")
    || message.includes("unknown field")
    || message.includes("unexpected field")
    || message.includes("unrecognized field")
    || message.includes("failed to parse")
    || message.includes("unsupported");
}

function shouldRetryInitializeWithoutCapabilities(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError || (rpcError.code !== -32600 && rpcError.code !== -32602)) {
    return false;
  }
  const message = rpcError.message.toLowerCase();
  return message.includes("capabilities")
    || message.includes("experimentalapi")
    || message.includes("experimental api")
    || message.includes("unknown field")
    || message.includes("invalid");
}

function shouldIgnoreThreadResumeFailure(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError) {
    return false;
  }
  const message = rpcError.message.toLowerCase();
  return message.includes("already resumed")
    || message.includes("not materialized")
    || message.includes("thread not found")
    || message.includes("no rollout found");
}

function shouldTreatThreadAsEmpty(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError) {
    return false;
  }
  const message = rpcError.message.toLowerCase();
  return message.includes("not materialized")
    || (message.includes("includeturns") && message.includes("before first user message"))
    || (message.includes("failed to load rollout") && message.includes("is empty"));
}

function shouldRetryTurnStartWithoutCollaborationMode(error) {
  const rpcError = extractRpcError(error);
  if (!rpcError || (rpcError.code !== -32600 && rpcError.code !== -32602)) {
    return false;
  }

  const message = rpcError.message.toLowerCase();
  return message.includes("collaborationmode")
    || message.includes("collaboration mode")
    || message.includes("experimentalapi")
    || message.includes("experimental api")
    || message.includes("plan mode")
    || message.includes("unknown field")
    || message.includes("invalid");
}

function extractRpcError(error) {
  return error && error.rpcError ? error.rpcError : null;
}

function toRpcError(rpcError) {
  const error = new Error(rpcError.message || "RPC error");
  error.rpcError = {
    code: Number(rpcError.code),
    message: String(rpcError.message || "RPC error"),
    data: rpcError.data || null,
  };
  return error;
}

function buildTurnStartParams({ threadId, text, model = "", effort = "", collaborationMode = null }) {
  const params = {
    threadId,
    input: [
      {
        type: "text",
        text,
      },
    ],
  };

  if (String(model || "").trim()) {
    params.model = String(model).trim();
  }
  if (String(effort || "").trim()) {
    params.effort = String(effort).trim();
  }
  if (collaborationMode && typeof collaborationMode === "object") {
    params.collaborationMode = collaborationMode;
  }

  return params;
}

function decodeServerRequest(rpcMessage) {
  const method = stringOrEmpty(rpcMessage?.method);
  if (!method || rpcMessage?.id == null) {
    return null;
  }

  const params = rpcMessage.params && typeof rpcMessage.params === "object"
    ? rpcMessage.params
    : {};
  const request = {
    id: String(rpcMessage.id),
    method,
    kind: "",
    isApprovalLike: false,
    params,
    threadId: stringOrEmpty(params.threadId),
    turnId: stringOrEmpty(params.turnId),
    itemId: stringOrEmpty(params.itemId),
    createdAt: new Date().toISOString(),
  };

  if (method === "item/tool/requestUserInput") {
    request.kind = "userInputPrompt";
    request.questions = decodeStructuredQuestions(params.questions);
    return request;
  }

  if (!isApprovalRequestMethod(method)) {
    return null;
  }

  request.kind = approvalRequestKind(method);
  request.isApprovalLike = true;
  request.reason = stringOrEmpty(params.reason);
  request.command = stringOrEmpty(params.command);
  request.cwd = stringOrEmpty(params.cwd);
  request.grantRoot = stringOrEmpty(params.grantRoot);
  request.permissions = params.permissions && typeof params.permissions === "object"
    ? params.permissions
    : {};
  request.availableDecisions = Array.isArray(params.availableDecisions)
    ? params.availableDecisions
    : [];
  return request;
}

function buildServerRequestResponsePayload(request, payload = {}) {
  if (request.method === "item/tool/requestUserInput") {
    return buildStructuredUserInputResponse(payload.answersByQuestionId || payload.answers || {});
  }

  if (request.method === "item/permissions/requestApproval") {
    const scope = normalizePermissionScope(payload.scope);
    const normalizedDecision = normalizeApprovalDecision(payload.decision, "accept");
    const permissions = normalizedDecision === "decline" || normalizedDecision === "cancel"
      ? {}
      : clonePlainObject(request.permissions);
    return {
      permissions,
      scope,
    };
  }

  if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
    return {
      decision: mapReviewDecision(payload.decision),
    };
  }

  if (request.method === "item/fileChange/requestApproval") {
    return {
      decision: mapFileChangeDecision(payload.decision),
    };
  }

  return {
    decision: mapCommandExecutionDecision(payload.decision),
  };
}

function buildStructuredUserInputResponse(answersByQuestionId) {
  const answers = {};

  for (const [questionId, rawAnswers] of Object.entries(answersByQuestionId || {})) {
    const nextAnswers = (Array.isArray(rawAnswers) ? rawAnswers : [rawAnswers])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    answers[questionId] = {
      answers: nextAnswers,
    };
  }

  return { answers };
}

function mergeTransientThreadMessages(threadId, messages, { pendingServerRequest = null, transientPlanState = null } = {}) {
  const mergedMessages = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];

  if (transientPlanState && transientPlanState.threadId === threadId) {
    const transientPlanMessage = buildTransientPlanMessage(transientPlanState);
    if (transientPlanMessage) {
      const existingIndex = mergedMessages.findIndex((message) => (
        message.kind === "plan"
        && (
          (transientPlanMessage.turnId && message.turnId === transientPlanMessage.turnId)
          || (transientPlanMessage.id && message.id === transientPlanMessage.id)
        )
      ));

      if (existingIndex >= 0) {
        mergedMessages[existingIndex] = {
          ...mergedMessages[existingIndex],
          ...transientPlanMessage,
          text: transientPlanMessage.text || mergedMessages[existingIndex].text,
        };
      } else {
        mergedMessages.push(transientPlanMessage);
      }
    }
  }

  if (pendingServerRequest?.kind === "userInputPrompt" && pendingServerRequest.threadId === threadId) {
    mergedMessages.push(buildStructuredUserInputPromptMessage(pendingServerRequest));
  }

  return mergedMessages.sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function buildTransientPlanMessage(transientPlanState) {
  const text = String(transientPlanState?.text || "").trim();
  const planState = {
    explanation: stringOrEmpty(transientPlanState?.explanation),
    steps: decodePlanSteps(transientPlanState?.steps),
  };
  if (!text && !planState.explanation && planState.steps.length === 0) {
    return null;
  }

  return {
    id: stringOrEmpty(transientPlanState?.itemId)
      || `plan-${stringOrEmpty(transientPlanState?.turnId) || stringOrEmpty(transientPlanState?.threadId)}`,
    threadId: stringOrEmpty(transientPlanState?.threadId),
    turnId: stringOrEmpty(transientPlanState?.turnId),
    kind: "plan",
    role: "system",
    text: text || "Plan updated",
    planState,
    createdAt: stringOrEmpty(transientPlanState?.updatedAt) || new Date().toISOString(),
  };
}

function buildStructuredUserInputPromptMessage(request) {
  return {
    id: request.id,
    requestId: request.id,
    threadId: request.threadId,
    turnId: request.turnId,
    kind: "userInputPrompt",
    role: "system",
    text: "Response required",
    structuredUserInputRequest: {
      questions: decodeStructuredQuestions(request.questions || request.params?.questions),
    },
    createdAt: request.createdAt || new Date().toISOString(),
  };
}

function decodeStructuredQuestions(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      return {
        id: stringOrEmpty(entry.id),
        header: stringOrEmpty(entry.header) || "Question",
        question: stringOrEmpty(entry.question),
        isOther: Boolean(entry.isOther),
        isSecret: Boolean(entry.isSecret),
        options: (Array.isArray(entry.options) ? entry.options : [])
          .map((option) => {
            if (!option || typeof option !== "object") {
              return null;
            }
            return {
              label: stringOrEmpty(option.label),
              description: stringOrEmpty(option.description),
            };
          })
          .filter(Boolean),
      };
    })
    .filter((entry) => entry && entry.id);
}

function normalizePermissionScope(scope) {
  return String(scope || "").trim().toLowerCase() === "session" ? "session" : "turn";
}

function normalizeApprovalDecision(value, fallback = "accept") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function mapCommandExecutionDecision(value) {
  const normalized = normalizeApprovalDecision(value, "accept");
  switch (normalized) {
    case "acceptForSession":
      return "acceptForSession";
    case "decline":
      return "decline";
    case "cancel":
      return "cancel";
    case "accept":
    default:
      return "accept";
  }
}

function mapFileChangeDecision(value) {
  const normalized = normalizeApprovalDecision(value, "accept");
  switch (normalized) {
    case "acceptForSession":
      return "acceptForSession";
    case "decline":
      return "decline";
    case "cancel":
      return "cancel";
    case "accept":
    default:
      return "accept";
  }
}

function mapReviewDecision(value) {
  const normalized = normalizeApprovalDecision(value, "accept");
  switch (normalized) {
    case "acceptForSession":
      return "approved_for_session";
    case "decline":
      return "denied";
    case "cancel":
      return "abort";
    case "approved":
    case "approved_for_session":
    case "denied":
    case "abort":
      return normalized;
    case "accept":
    default:
      return "approved";
  }
}

function approvalRequestKind(method) {
  switch (String(method || "").trim()) {
    case "item/fileChange/requestApproval":
      return "fileChangeApproval";
    case "item/permissions/requestApproval":
      return "permissionsApproval";
    case "applyPatchApproval":
      return "applyPatchApproval";
    case "execCommandApproval":
      return "execCommandApproval";
    default:
      return "commandApproval";
  }
}

function clonePlainObject(value) {
  return value && typeof value === "object"
    ? JSON.parse(JSON.stringify(value))
    : {};
}

function isApprovalRequestMethod(method) {
  const normalized = String(method || "").trim();
  return normalized === "item/commandExecution/requestApproval"
    || normalized === "item/command_execution/request_approval"
    || normalized === "item/fileChange/requestApproval"
    || normalized === "item/permissions/requestApproval"
    || normalized === "applyPatchApproval"
    || normalized === "execCommandApproval";
}

function openWebSocket(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function decodeThreadSummary(threadObject, pinnedThreadIDs = null) {
  if (!threadObject || typeof threadObject !== "object") {
    return null;
  }

  const title = stringOrEmpty(threadObject.name)
    || normalizeThreadTitle(threadObject.title)
    || stringOrEmpty(threadObject.preview)
    || "New Thread";

  return {
    id: stringOrEmpty(threadObject.id),
    title,
    preview: stringOrEmpty(threadObject.preview),
    cwd: stringOrEmpty(threadObject.cwd || threadObject.current_working_directory || threadObject.working_directory),
    updatedAt: threadObject.updatedAt || threadObject.updated_at || null,
    createdAt: threadObject.createdAt || threadObject.created_at || null,
    model: stringOrEmpty(threadObject.model),
    pinned: pinnedThreadIDs instanceof Set
      ? pinnedThreadIDs.has(stringOrEmpty(threadObject.id))
      : decodePinnedThreadState(threadObject),
  };
}

function decodeModelOption(modelObject) {
  if (!modelObject || typeof modelObject !== "object") {
    return null;
  }

  const model = stringOrEmpty(modelObject.model) || stringOrEmpty(modelObject.id);
  const id = stringOrEmpty(modelObject.id) || model;
  if (!id) {
    return null;
  }

  return {
    id,
    model,
    displayName: stringOrEmpty(modelObject.displayName || modelObject.display_name) || model || id,
    description: stringOrEmpty(modelObject.description),
    isDefault: Boolean(modelObject.isDefault ?? modelObject.is_default),
    supportedReasoningEfforts: decodeReasoningEfforts(
      modelObject.supportedReasoningEfforts
      || modelObject.supported_reasoning_efforts
      || modelObject.supportedReasoningLevels
      || modelObject.supported_reasoning_levels
    ),
    defaultReasoningEffort: stringOrEmpty(
      modelObject.defaultReasoningEffort
      || modelObject.default_reasoning_effort
      || modelObject.defaultReasoningLevel
      || modelObject.default_reasoning_level
    ),
  };
}

function decodeReasoningEfforts(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === "string") {
        const normalized = entry.trim();
        return normalized
          ? { reasoningEffort: normalized, description: "" }
          : null;
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const reasoningEffort = stringOrEmpty(
        entry.reasoningEffort || entry.reasoning_effort || entry.effort
      );
      if (!reasoningEffort) {
        return null;
      }
      return {
        reasoningEffort,
        description: stringOrEmpty(entry.description),
      };
    })
    .filter(Boolean);
}

function decodePinnedThreadState(threadObject) {
  const directCandidates = [
    threadObject.pinned,
    threadObject.isPinned,
    threadObject.is_pinned,
    threadObject.pin,
  ];
  for (const candidate of directCandidates) {
    const resolved = decodeBooleanLike(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }

  const metadata = threadObject.metadata && typeof threadObject.metadata === "object"
    ? threadObject.metadata
    : null;
  if (!metadata) {
    return false;
  }

  const metadataCandidates = [
    metadata.pinned,
    metadata.isPinned,
    metadata.is_pinned,
    metadata.pin,
    metadata.pinnedThread,
    metadata.pinned_thread,
  ];
  for (const candidate of metadataCandidates) {
    const resolved = decodeBooleanLike(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }

  if (metadata.pinnedAt != null || metadata.pinned_at != null) {
    return true;
  }

  return false;
}

function decodeBooleanLike(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
    return null;
  }
  if (value && typeof value === "object") {
    if (typeof value.boolValue === "boolean") {
      return value.boolValue;
    }
    if (typeof value.value === "boolean") {
      return value.value;
    }
    if (typeof value.value === "string") {
      return decodeBooleanLike(value.value);
    }
  }
  return null;
}

function decodeThreadMessages(threadId, threadObject) {
  const turns = Array.isArray(threadObject.turns) ? threadObject.turns : [];
  const baseTimestamp = decodeTimestamp(
    threadObject.createdAt || threadObject.created_at || threadObject.updatedAt || threadObject.updated_at
  ) || new Date(0);

  let offsetMs = 0;
  const messages = [];

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }

    const turnId = stringOrEmpty(turn.id);
    const turnTimestamp = decodeTimestamp(turn.createdAt || turn.created_at || turn.updatedAt || turn.updated_at);
    const items = Array.isArray(turn.items) ? turn.items : [];

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const itemType = normalizeItemType(item.type);
      const createdAt = decodeTimestamp(item.createdAt || item.created_at || item.updatedAt || item.updated_at)
        || turnTimestamp
        || new Date(baseTimestamp.getTime() + offsetMs);
      offsetMs += 1;

      const itemId = stringOrEmpty(item.id) || `${turnId || "turn"}-${messages.length}`;
      const text = decodeItemText(item);
      const message = {
        id: itemId,
        threadId,
        turnId,
        kind: "chat",
        role: "system",
        text,
        createdAt: createdAt.toISOString(),
      };

      switch (itemType) {
      case "usermessage":
        message.role = "user";
        break;
      case "agentmessage":
      case "assistantmessage":
        message.role = "assistant";
        break;
      case "message":
        message.role = String(item.role || "").toLowerCase().includes("user") ? "user" : "assistant";
        break;
      case "reasoning":
        message.kind = "thinking";
        message.text = decodeReasoningItemText(item);
        break;
      case "toolcall":
        message.kind = "tool";
        message.text = decodeToolCallItemText(item);
        break;
      case "commandexecution":
        message.kind = "command";
        message.text = decodeCommandExecutionItemText(item);
        break;
      case "filechange":
      case "diff":
        message.kind = "file";
        message.text = decodeFileChangeItemText(item);
        break;
      case "plan":
        message.kind = "plan";
        message.text = decodePlanItemText(item);
        message.planState = decodePlanState(item);
        break;
      default:
        if (!text) {
          continue;
        }
        break;
      }

      if (!message.text.trim()) {
        continue;
      }

      messages.push(message);
    }
  }

  return messages.sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function decodeItemText(itemObject) {
  const contentItems = Array.isArray(itemObject.content) ? itemObject.content : [];
  const textParts = [];

  for (const part of contentItems) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const partType = normalizeItemType(part.type);
    if (partType === "text" || partType === "inputtext" || partType === "outputtext" || partType === "message") {
      if (stringOrEmpty(part.text)) {
        textParts.push(String(part.text));
      }
      continue;
    }

    if (partType === "skill") {
      const skillId = stringOrEmpty(part.id) || stringOrEmpty(part.name);
      if (skillId) {
        textParts.push(`$${skillId}`);
      }
      continue;
    }

    if (partType === "text" && part.data && typeof part.data === "object" && stringOrEmpty(part.data.text)) {
      textParts.push(String(part.data.text));
    }
  }

  const joined = textParts.join("\n").trim();
  if (joined) {
    return joined;
  }

  return stringOrEmpty(itemObject.text) || stringOrEmpty(itemObject.message);
}

function decodeReasoningItemText(itemObject) {
  return decodeItemText(itemObject) || "Reasoning";
}

function decodeToolCallItemText(itemObject) {
  const toolName = stringOrEmpty(itemObject.toolName || itemObject.tool_name || itemObject.name);
  const status = stringOrEmpty(itemObject.status);
  const base = toolName ? `Tool: ${toolName}` : "Tool activity";
  return status ? `${base} (${status})` : base;
}

function decodeCommandExecutionItemText(itemObject) {
  const command = stringOrEmpty(itemObject.command) || decodeItemText(itemObject);
  const status = stringOrEmpty(itemObject.status);
  if (command && status) {
    return `$ ${command}\n${status}`;
  }
  if (command) {
    return `$ ${command}`;
  }
  return "Command execution";
}

function decodeFileChangeItemText(itemObject) {
  return decodeItemText(itemObject) || "File change";
}

function decodePlanItemText(itemObject) {
  return decodeItemText(itemObject) || "Plan updated";
}

function decodePlanState(itemObject) {
  return {
    explanation: stringOrEmpty(itemObject?.explanation),
    steps: decodePlanSteps(itemObject?.plan),
  };
}

function decodePlanSteps(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const step = stringOrEmpty(entry.step);
      if (!step) {
        return null;
      }

      const normalizedStatus = String(entry.status || "").trim();
      let status = "pending";
      if (normalizedStatus === "completed") {
        status = "completed";
      } else if (normalizedStatus === "in_progress" || normalizedStatus === "inProgress") {
        status = "inProgress";
      }

      return {
        step,
        status,
      };
    })
    .filter(Boolean);
}

function normalizeItemType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]/g, "");
}

function normalizeThreadTitle(value) {
  const trimmed = stringOrEmpty(value);
  if (!trimmed || trimmed === "Conversation" || trimmed === "New Thread") {
    return "";
  }
  return trimmed;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeTimestamp(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    const milliseconds = rawValue > 10_000_000_000 ? rawValue : rawValue * 1000;
    return new Date(milliseconds);
  }

  if (typeof rawValue === "string") {
    const parsed = Date.parse(rawValue);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  return null;
}

function encryptEnvelopePayload(payloadObject, key, sender, counter, sessionId, keyEpoch) {
  const nonce = nonceForDirection(sender, counter);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payloadObject), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    kind: "encryptedEnvelope",
    v: SECURE_PROTOCOL_VERSION,
    sessionId,
    keyEpoch,
    sender,
    counter,
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptEnvelopeBuffer(envelope, key, sender, counter) {
  try {
    const nonce = nonceForDirection(sender, counter);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(base64ToBuffer(envelope.tag));
    return Buffer.concat([
      decipher.update(base64ToBuffer(envelope.ciphertext)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}

function deriveAesKey(sharedSecret, salt, infoLabel) {
  return Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(infoLabel, "utf8"), 32));
}

function signTranscript(privateKeyBase64, publicKeyBase64, transcriptBytes) {
  const signature = sign(
    null,
    transcriptBytes,
    createPrivateKey({
      key: {
        crv: "Ed25519",
        d: base64ToBase64Url(privateKeyBase64),
        kty: "OKP",
        x: base64ToBase64Url(publicKeyBase64),
      },
      format: "jwk",
    })
  );
  return signature.toString("base64");
}

function verifyTranscript(publicKeyBase64, transcriptBytes, signatureBase64) {
  try {
    return verify(
      null,
      transcriptBytes,
      createPublicKey({
        key: {
          crv: "Ed25519",
          kty: "OKP",
          x: base64ToBase64Url(publicKeyBase64),
        },
        format: "jwk",
      }),
      base64ToBuffer(signatureBase64)
    );
  } catch {
    return false;
  }
}

function buildTranscriptBytes({
  sessionId,
  protocolVersion,
  handshakeMode,
  keyEpoch,
  macDeviceId,
  phoneDeviceId,
  macIdentityPublicKey,
  phoneIdentityPublicKey,
  macEphemeralPublicKey,
  phoneEphemeralPublicKey,
  clientNonce,
  serverNonce,
  expiresAtForTranscript,
}) {
  return Buffer.concat([
    encodeLengthPrefixedUTF8(HANDSHAKE_TAG),
    encodeLengthPrefixedUTF8(sessionId),
    encodeLengthPrefixedUTF8(String(protocolVersion)),
    encodeLengthPrefixedUTF8(handshakeMode),
    encodeLengthPrefixedUTF8(String(keyEpoch)),
    encodeLengthPrefixedUTF8(macDeviceId),
    encodeLengthPrefixedUTF8(phoneDeviceId),
    encodeLengthPrefixedBuffer(base64ToBuffer(macIdentityPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(phoneIdentityPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(macEphemeralPublicKey)),
    encodeLengthPrefixedBuffer(base64ToBuffer(phoneEphemeralPublicKey)),
    encodeLengthPrefixedBuffer(clientNonce),
    encodeLengthPrefixedBuffer(serverNonce),
    encodeLengthPrefixedUTF8(String(expiresAtForTranscript)),
  ]);
}

function encodeLengthPrefixedUTF8(value) {
  return encodeLengthPrefixedBuffer(Buffer.from(String(value), "utf8"));
}

function encodeLengthPrefixedBuffer(buffer) {
  const lengthBuffer = Buffer.allocUnsafe(4);
  lengthBuffer.writeUInt32BE(buffer.length, 0);
  return Buffer.concat([lengthBuffer, buffer]);
}

function nonceForDirection(sender, counter) {
  const nonce = Buffer.alloc(12, 0);
  nonce.writeUInt8(sender === SECURE_SENDER_MAC ? 1 : 2, 0);
  let value = BigInt(counter);
  for (let index = 11; index >= 1; index -= 1) {
    nonce[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return nonce;
}

function base64ToBuffer(value) {
  return Buffer.from(String(value || ""), "base64");
}

function base64UrlToBase64(value) {
  const raw = String(value || "");
  const padded = `${raw}${"=".repeat((4 - (raw.length % 4 || 4)) % 4)}`;
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function base64ToBase64Url(value) {
  return String(value || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rejectControlWaiters(waiters, error) {
  for (const waiter of [...waiters]) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
    waiters.delete(waiter);
  }
}

module.exports = {
  RemodexWebClient,
  buildTurnStartParams,
  buildServerRequestResponsePayload,
  buildStructuredUserInputResponse,
  decodePlanState,
  decodePlanSteps,
  decodeServerRequest,
  decodeThreadMessages,
  mergeTransientThreadMessages,
  shouldRetryTurnStartWithoutCollaborationMode,
  server,
};
