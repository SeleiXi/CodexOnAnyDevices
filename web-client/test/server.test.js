const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  RemodexWebClient,
  buildServerRequestResponsePayload,
  buildTurnStartParams,
  decodeThreadMessages,
  mergeTransientThreadMessages,
  server,
} = require("../server");

function rpcError(message, code = -32602) {
  const error = new Error(message);
  error.rpcError = {
    code,
    message,
  };
  return error;
}

function createClientStub() {
  const client = Object.create(RemodexWebClient.prototype);
  client.pendingRequests = new Map();
  client.pendingControlWaiters = new Set();
  client.pendingApproval = null;
  client.pendingServerRequest = null;
  client.lastPlanModeDowngrade = null;
  client.lastModelReroute = null;
  client.lastDisconnect = null;
  client.isConnected = false;
  client.isInitialized = false;
  client.supportsTurnCollaborationMode = true;
  client.transientPlanStateByThread = new Map();
  client.transientLiveMessagesByThread = new Map();
  client.connectionOperation = Promise.resolve();
  return client;
}

function createSocketStub() {
  const socket = new EventEmitter();
  socket.off = socket.removeListener.bind(socket);
  socket.readyState = 1;
  socket.close = () => {
    socket.readyState = 3;
    socket.emit("close", 1000, Buffer.from("closed"));
  };
  return socket;
}

test.after(() => {
  if (server.listening) {
    server.close();
  }
});

test("buildTurnStartParams forwards model, effort, and collaboration mode", () => {
  const params = buildTurnStartParams({
    threadId: "thread-1",
    text: "hello",
    model: "gpt-5.4",
    effort: "high",
    collaborationMode: {
      mode: "plan",
      settings: {
        model: "gpt-5.4",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    },
  });

  assert.deepEqual(params, {
    threadId: "thread-1",
    input: [
      {
        type: "text",
        text: "hello",
      },
    ],
    model: "gpt-5.4",
    effort: "high",
    collaborationMode: {
      mode: "plan",
      settings: {
        model: "gpt-5.4",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    },
  });
});

test("startTurn retries once without collaboration mode when the runtime rejects it", async () => {
  const client = createClientStub();
  const requests = [];

  client.resumeThread = async () => null;
  client.sendRequestWithSandboxFallback = async (method, params) => {
    requests.push({ method, params });
    if (requests.length === 1) {
      throw rpcError("Unknown field collaborationMode");
    }
    return {
      result: {
        ok: true,
      },
    };
  };

  const response = await client.startTurn("thread-1", "Ship it", {
    accessMode: "on-request",
    model: "gpt-5.4",
    effort: "medium",
    collaborationMode: {
      mode: "plan",
      settings: {
        model: "gpt-5.4",
        reasoning_effort: "medium",
        developer_instructions: null,
      },
    },
  });

  assert.deepEqual(response, { ok: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "turn/start");
  assert.equal(requests[0].params.effort, "medium");
  assert.deepEqual(requests[0].params.collaborationMode, {
    mode: "plan",
    settings: {
      model: "gpt-5.4",
      reasoning_effort: "medium",
      developer_instructions: null,
    },
  });
  assert.equal(requests[1].method, "turn/start");
  assert.equal(requests[1].params.effort, "medium");
  assert.equal("collaborationMode" in requests[1].params, false);
  assert.equal(client.supportsTurnCollaborationMode, false);
  assert.match(client.lastPlanModeDowngrade.reason, /Plan mode is not supported/);
});

test("readThread falls back when includeTurns hits a transient empty rollout", async () => {
  const client = createClientStub();
  const requests = [];

  client.sendRequest = async (method, params) => {
    requests.push({ method, params });
    if (requests.length === 1) {
      throw rpcError(
        "failed to load rollout `C:\\Users\\KarsaGuo\\.codex\\sessions\\2026\\03\\30\\rollout-thread-1.jsonl`: rollout at C:\\Users\\KarsaGuo\\.codex\\sessions\\2026\\03\\30\\rollout-thread-1.jsonl is empty",
        -32000
      );
    }

    return {
      result: {
        thread: {
          id: "thread-1",
          title: "New Thread",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z",
        },
      },
    };
  };

  const result = await client.readThread("thread-1");

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    method: "thread/read",
    params: {
      threadId: "thread-1",
      includeTurns: true,
    },
  });
  assert.deepEqual(requests[1], {
    method: "thread/read",
    params: {
      threadId: "thread-1",
    },
  });
  assert.equal(result.thread.id, "thread-1");
  assert.equal(result.messages.length, 0);
});

test("listModels follows runtime pagination and dedupes models", async () => {
  const client = createClientStub();
  const requests = [];

  client.sendRequest = async (method, params) => {
    requests.push({ method, params });
    if (!params.cursor) {
      return {
        result: {
          data: [
            { id: "gpt-5.4", displayName: "GPT-5.4" },
            { id: "gpt-5.4", displayName: "GPT-5.4 duplicate" },
          ],
          nextCursor: "page-2",
        },
      };
    }

    return {
      result: {
        data: [
          { id: "gpt-5.5", displayName: "GPT-5.5" },
        ],
      },
    };
  };

  const models = await client.listModels({ pageSize: 2, maxPages: 5 });

  assert.deepEqual(models.map((model) => model.id), ["gpt-5.4", "gpt-5.5"]);
  assert.deepEqual(requests.map((request) => request.params.cursor), [null, "page-2"]);
  assert.equal(requests[0].params.limit, 2);
  assert.equal(client.cachedModels.length, 2);
});

test("listModels accepts snake_case next cursors from the runtime", async () => {
  const client = createClientStub();
  const requests = [];

  client.sendRequest = async (method, params) => {
    requests.push({ method, params });
    if (!params.cursor) {
      return {
        result: {
          models: [
            { model: "gpt-5.4", display_name: "GPT-5.4" },
          ],
          next_cursor: "cursor-2",
        },
      };
    }

    return {
      result: {
        models: [
          { model: "gpt-5.5", display_name: "GPT-5.5" },
        ],
      },
    };
  };

  const models = await client.listModels({ pageSize: 1 });

  assert.deepEqual(models.map((model) => model.model), ["gpt-5.4", "gpt-5.5"]);
  assert.deepEqual(requests.map((request) => request.params.cursor), [null, "cursor-2"]);
});

test("listModels stops when the runtime repeats a cursor", async () => {
  const client = createClientStub();
  const requests = [];

  client.sendRequest = async (method, params) => {
    requests.push({ method, params });
    return {
      result: {
        data: [
          { id: params.cursor ? `model-${params.cursor}` : "model-first" },
        ],
        nextCursor: "same-cursor",
      },
    };
  };

  const models = await client.listModels({ pageSize: 1, maxPages: 10 });

  assert.deepEqual(models.map((model) => model.id), ["model-first", "model-same-cursor"]);
  assert.equal(requests.length, 2);
});

test("routeRpcMessage tracks typed requests, clears resolved requests, and stores notifications", () => {
  const client = createClientStub();

  client.routeRpcMessage({
    id: "req-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [
        {
          id: "model_choice",
          header: "Model",
          question: "Pick one",
          options: [
            { label: "Fast", description: "Lower reasoning" },
            { label: "Deep", description: "Higher reasoning" },
          ],
        },
      ],
    },
  });

  assert.equal(client.pendingServerRequest.kind, "userInputPrompt");
  assert.equal(client.pendingServerRequest.questions[0].id, "model_choice");
  assert.equal(client.pendingApproval, null);

  client.routeRpcMessage({
    method: "turn/plan/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      explanation: "Plan the implementation",
      plan: [
        { step: "Inspect protocol", status: "completed" },
        { step: "Render prompt cards", status: "in_progress" },
      ],
    },
  });

  client.routeRpcMessage({
    method: "item/plan/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "plan-1",
      delta: "Plan delta text",
    },
  });

  client.routeRpcMessage({
    method: "model/rerouted",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      fromModel: "gpt-5.4",
      toModel: "gpt-5.4-mini",
      reason: "Capacity fallback",
    },
  });

  const mergedMessages = mergeTransientThreadMessages("thread-1", [], {
    pendingServerRequest: client.pendingServerRequest,
    transientPlanState: client.transientPlanStateByThread.get("thread-1"),
  });

  assert.equal(mergedMessages.length, 2);
  const planMessage = mergedMessages.find((message) => message.kind === "plan");
  const inputPrompt = mergedMessages.find((message) => message.kind === "userInputPrompt");
  assert.ok(planMessage);
  assert.ok(inputPrompt);
  assert.equal(planMessage.planState.explanation, "Plan the implementation");
  assert.equal(planMessage.planState.steps[1].status, "inProgress");
  assert.equal(planMessage.text, "Plan delta text");
  assert.equal(client.lastModelReroute.toModel, "gpt-5.4-mini");

  client.routeRpcMessage({
    method: "serverRequest/resolved",
    params: {
      requestId: "req-1",
    },
  });

  assert.equal(client.pendingServerRequest, null);
});

test("stale socket close events do not clear a newer bridge connection", () => {
  const client = createClientStub();
  const oldSocket = createSocketStub();
  const newSocket = createSocketStub();

  client.socket = oldSocket;
  client.attachSocketHandlers(oldSocket);
  client.socket = newSocket;
  client.attachSocketHandlers(newSocket);

  oldSocket.emit("close", 1006, Buffer.from("stale"));

  assert.equal(client.socket, newSocket);
  assert.equal(client.isConnected, false);
  assert.equal(client.lastDisconnect, null);

  newSocket.emit("close", 1006, Buffer.from("live"));
  assert.equal(client.socket, null);
  assert.equal(client.lastDisconnect.reason, "live");
});

test("live notifications are merged into thread reads while rollout history catches up", () => {
  const client = createClientStub();

  client.routeRpcMessage({
    method: "turn/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });
  client.routeRpcMessage({
    method: "item/reasoning/textDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "thinking-1",
      delta: "Inspecting",
    },
  });
  client.routeRpcMessage({
    method: "item/reasoning/textDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "thinking-1",
      delta: " files",
    },
  });
  client.routeRpcMessage({
    method: "codex/event/exec_command_begin",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      call_id: "cmd-1",
      command: "npm test",
    },
  });
  client.routeRpcMessage({
    method: "codex/event/exec_command_output_delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      call_id: "cmd-1",
      command: "npm test",
      chunk: "pass\n",
    },
  });
  client.routeRpcMessage({
    method: "codex/event/agent_message",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      message: "Done",
    },
  });

  const mergedMessages = mergeTransientThreadMessages("thread-1", [], {
    transientLiveMessages: client.transientLiveMessagesByThread.get("thread-1"),
  });

  assert.equal(mergedMessages.some((message) => message.text === "Inspecting files"), true);
  assert.equal(mergedMessages.some((message) => message.kind === "command" && message.text.includes("pass")), true);
  assert.equal(mergedMessages.some((message) => message.role === "assistant" && message.text === "Done"), true);
});

test("buildServerRequestResponsePayload encodes typed response shapes", () => {
  const commandResponse = buildServerRequestResponsePayload(
    {
      method: "item/commandExecution/requestApproval",
    },
    {
      decision: "acceptForSession",
    }
  );
  assert.deepEqual(commandResponse, {
    decision: "acceptForSession",
  });

  const reviewResponse = buildServerRequestResponsePayload(
    {
      method: "applyPatchApproval",
    },
    {
      decision: "acceptForSession",
    }
  );
  assert.deepEqual(reviewResponse, {
    decision: "approved_for_session",
  });

  const permissionsResponse = buildServerRequestResponsePayload(
    {
      method: "item/permissions/requestApproval",
      permissions: {
        sandbox: {
          type: "workspaceWrite",
        },
      },
    },
    {
      decision: "accept",
      scope: "session",
    }
  );
  assert.deepEqual(permissionsResponse, {
    permissions: {
      sandbox: {
        type: "workspaceWrite",
      },
    },
    scope: "session",
  });

  const inputResponse = buildServerRequestResponsePayload(
    {
      method: "item/tool/requestUserInput",
    },
    {
      answersByQuestionId: {
        model_choice: ["Deep"],
      },
    }
  );
  assert.deepEqual(inputResponse, {
    answers: {
      model_choice: {
        answers: ["Deep"],
      },
    },
  });
});

test("decodeThreadMessages preserves plan state for persisted plan items", () => {
  const messages = decodeThreadMessages("thread-1", {
    id: "thread-1",
    turns: [
      {
        id: "turn-1",
        createdAt: "2026-03-30T10:00:00.000Z",
        items: [
          {
            id: "plan-1",
            type: "plan",
            explanation: "Keep the rollout visible",
            plan: [
              { step: "Inspect current protocol", status: "completed" },
              { step: "Ship typed responses", status: "in_progress" },
            ],
            content: [
              {
                type: "output_text",
                text: "Plan card body",
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, "plan");
  assert.equal(messages[0].text, "Plan card body");
  assert.deepEqual(messages[0].planState, {
    explanation: "Keep the rollout visible",
    steps: [
      { step: "Inspect current protocol", status: "completed" },
      { step: "Ship typed responses", status: "inProgress" },
    ],
  });
});
