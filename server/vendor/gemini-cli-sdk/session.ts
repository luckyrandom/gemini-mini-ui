/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type AgentLoopContext,
  Config,
  type ConfigParameters,
  AuthType,
  PREVIEW_GEMINI_MODEL_AUTO,
  GeminiEventType,
  type ToolCallRequestInfo,
  type ServerGeminiStreamEvent,
  type GeminiClient,
  type Content,
  scheduleAgentTools,
  getAuthTypeFromEnv,
  type ToolRegistry,
  loadSkillsFromDir,
  ActivateSkillTool,
  type ResumedSessionData,
  PolicyDecision,
  recordToolCallInteractions,
  ToolErrorType,
  isFatalToolError,
  WRITE_FILE_TOOL_NAME,
  EDIT_TOOL_NAME,
  SHELL_TOOL_NAME,
  type MessageBus,
} from '@google/gemini-cli-core';

import { type Tool, SdkTool } from './tool.js';
import { SdkAgentFilesystem } from './fs.js';
import { SdkAgentShell } from './shell.js';
import type {
  SessionContext,
  GeminiCliAgentOptions,
  SystemInstructions,
} from './types.js';
import type { SkillReference } from './skills.js';
import type { GeminiCliAgent } from './agent.js';

export class GeminiCliSession {
  private readonly config: Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools: Array<Tool<any>>;
  private readonly skillRefs: SkillReference[];
  private readonly instructions: SystemInstructions | undefined;
  private client: GeminiClient | undefined;
  private initialized = false;

  constructor(
    options: GeminiCliAgentOptions,
    private readonly sessionId: string,
    private readonly agent: GeminiCliAgent,
    private readonly resumedData?: ResumedSessionData,
  ) {
    this.instructions = options.instructions;
    const cwd = options.cwd || process.cwd();
    this.tools = options.tools || [];
    this.skillRefs = options.skills || [];

    let initialMemory = '';
    if (typeof this.instructions === 'string') {
      initialMemory = this.instructions;
    } else if (this.instructions && typeof this.instructions !== 'function') {
      throw new Error('Instructions must be a string or a function.');
    }

    const configParams: ConfigParameters = {
      sessionId: this.sessionId,
      targetDir: cwd,
      cwd,
      debugMode: options.debug ?? false,
      model: options.model || PREVIEW_GEMINI_MODEL_AUTO,
      userMemory: initialMemory,
      // Minimal config
      enableHooks: false,
      mcpEnabled: false,
      extensionsEnabled: false,
      recordResponses: options.recordResponses,
      fakeResponses: options.fakeResponses,
      skillsSupport: true,
      adminSkillsEnabled: true,
      // Interactive mode is required so the policy engine's ASK_USER rules
      // below actually prompt instead of erroring. The browser UI provides
      // the "user" that answers the prompt.
      interactive: true,
      policyEngineConfig: {
        defaultDecision: PolicyDecision.ALLOW,
        rules: [
          // Destructive / write tools are gated behind per-call approval.
          // v1: no cross-turn memory — every call re-asks.
          {
            toolName: WRITE_FILE_TOOL_NAME,
            decision: PolicyDecision.ASK_USER,
            priority: 10,
          },
          {
            toolName: EDIT_TOOL_NAME,
            decision: PolicyDecision.ASK_USER,
            priority: 10,
          },
          {
            toolName: SHELL_TOOL_NAME,
            decision: PolicyDecision.ASK_USER,
            priority: 10,
          },
        ],
      },
    };

    this.config = new Config(configParams);
  }

  get id(): string {
    return this.sessionId;
  }

  /**
   * Exposes the message bus so the SDK embedder can participate in the
   * tool-confirmation flow (subscribe to TOOL_CALLS_UPDATE, publish
   * TOOL_CONFIRMATION_RESPONSE). Safe to access after construction.
   */
  get messageBus(): MessageBus {
    const ctx: AgentLoopContext = this.config;
    return ctx.messageBus;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const authType = getAuthTypeFromEnv() || AuthType.COMPUTE_ADC;

    await this.config.refreshAuth(authType);
    await this.config.initialize();

    // Load additional skills from options
    if (this.skillRefs.length > 0) {
      const skillManager = this.config.getSkillManager();

      const loadPromises = this.skillRefs.map(async (ref) => {
        try {
          if (ref.type === 'dir') {
            return await loadSkillsFromDir(ref.path);
          }
        } catch (e) {
          // TODO: refactor this to use a proper logger interface
          // eslint-disable-next-line no-console
          console.error(`Failed to load skills from ${ref.path}:`, e);
        }
        return [];
      });

      const loadedSkills = (await Promise.all(loadPromises)).flat();

      if (loadedSkills.length > 0) {
        skillManager.addSkills(loadedSkills);
      }
    }

    // Re-register ActivateSkillTool if we have skills
    const skillManager = this.config.getSkillManager();
    if (skillManager.getSkills().length > 0) {
      const loopContext: AgentLoopContext = this.config;
      const registry = loopContext.toolRegistry;
      const toolName = ActivateSkillTool.Name;
      if (registry.getTool(toolName)) {
        registry.unregisterTool(toolName);
      }
      registry.registerTool(
        new ActivateSkillTool(this.config, loopContext.messageBus),
      );
    }

    // Register tools
    const loopContext2: AgentLoopContext = this.config;
    const registry = loopContext2.toolRegistry;
    const messageBus = loopContext2.messageBus;

    for (const toolDef of this.tools) {
      const sdkTool = new SdkTool(toolDef, messageBus, this.agent, undefined);
      registry.registerTool(sdkTool);
    }

    this.client = loopContext2.geminiClient;

    if (this.resumedData) {
      const history: Content[] = this.resumedData.conversation.messages.map(
        (m) => {
          const role = m.type === 'gemini' ? 'model' : 'user';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let parts: any[] = [];
          if (Array.isArray(m.content)) {
            parts = m.content;
          } else if (m.content) {
            parts = [{ text: String(m.content) }];
          }
          return { role, parts };
        },
      );
      await this.client.resumeChat(history, this.resumedData);
    }

    this.initialized = true;
  }

  async *sendStream(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (!this.initialized || !this.client) {
      await this.initialize();
    }
    const client = this.client!;
    const abortSignal = signal ?? new AbortController().signal;
    const sessionId = this.config.getSessionId();

    const fs = new SdkAgentFilesystem(this.config);
    const shell = new SdkAgentShell(this.config);

    let request: Parameters<GeminiClient['sendMessageStream']>[0] = [
      { text: prompt },
    ];

    const maxTurns = this.config.getMaxSessionTurns();
    let turnCount = 0;

    while (true) {
      turnCount++;
      if (maxTurns >= 0 && turnCount > maxTurns) {
        yield { type: GeminiEventType.MaxSessionTurns };
        return;
      }
      if (typeof this.instructions === 'function') {
        const context: SessionContext = {
          sessionId,
          transcript: client.getHistory(),
          cwd: this.config.getWorkingDir(),
          timestamp: new Date().toISOString(),
          fs,
          shell,
          agent: this.agent,
          session: this,
        };
        const newInstructions = await this.instructions(context);
        this.config.setUserMemory(newInstructions);
        client.updateSystemInstruction();
      }

      const stream = client.sendMessageStream(request, abortSignal, sessionId);

      const toolCallsToSchedule: ToolCallRequestInfo[] = [];

      for await (const event of stream) {
        yield event;
        if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCall = event.value;
          let args = toolCall.args;
          if (typeof args === 'string') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            args = JSON.parse(args);
          }
          toolCallsToSchedule.push({
            ...toolCall,
            args,
            isClientInitiated: false,
            prompt_id: sessionId,
          });
          continue;
        }
        // Bail out on terminal events instead of continuing the loop and
        // potentially scheduling tools from a half-formed stream.
        switch (event.type) {
          case GeminiEventType.Error:
          case GeminiEventType.InvalidStream:
          case GeminiEventType.ContextWindowWillOverflow:
          case GeminiEventType.UserCancelled:
          case GeminiEventType.AgentExecutionStopped:
          case GeminiEventType.MaxSessionTurns:
            return;
          default:
            break;
        }
      }

      if (toolCallsToSchedule.length === 0) {
        break;
      }

      const transcript: readonly Content[] = client.getHistory();
      const context: SessionContext = {
        sessionId,
        transcript,
        cwd: this.config.getWorkingDir(),
        timestamp: new Date().toISOString(),
        fs,
        shell,
        agent: this.agent,
        session: this,
      };

      const loopContext: AgentLoopContext = this.config;
      const originalRegistry = loopContext.toolRegistry;
      const scopedRegistry: ToolRegistry = originalRegistry.clone();
      const originalGetTool = scopedRegistry.getTool.bind(scopedRegistry);
      scopedRegistry.getTool = (name: string) => {
        const tool = originalGetTool(name);
        if (tool instanceof SdkTool) {
          return tool.bindContext(context);
        }
        return tool;
      };

      const completedCalls = await scheduleAgentTools(
        this.config,
        toolCallsToSchedule,
        {
          schedulerId: sessionId,
          toolRegistry: scopedRegistry,
          signal: abortSignal,
        },
      );

      // Persist tool calls into the chat recording so they survive a server
      // reload. scheduleAgentTools doesn't do this itself — only the legacy
      // agent loop and local-executor call recordCompletedToolCalls — so when
      // we drive the loop ourselves we have to record them here. Prefer the
      // model that actually served this turn (matters under auto-routing).
      const recordedModel =
        client.getCurrentSequenceModel() ?? this.config.getModel();
      client.getChat().recordCompletedToolCalls(recordedModel, completedCalls);
      // Code Assist tool-call telemetry. No-ops when not authed against a
      // Code Assist server, so it's safe to call unconditionally.
      await recordToolCallInteractions(this.config, completedCalls);

      // Surface each completed tool call to the consumer so it can render a
      // result alongside the earlier ToolCallRequest. Core does not emit these
      // itself — the scheduler hands them back out-of-band — so this bridge
      // is the only place they can be yielded.
      for (const call of completedCalls) {
        yield {
          type: GeminiEventType.ToolCallResponse,
          value: call.response,
        };
      }

      // A tool can ask us to stop the loop entirely (e.g. complete_task) by
      // returning STOP_EXECUTION; a fatal tool error means feeding the result
      // back to the model would just spin. In both cases, end the stream
      // instead of continuing the loop.
      const stopTool = completedCalls.find(
        (c) =>
          c.response.errorType === ToolErrorType.STOP_EXECUTION &&
          c.response.error !== undefined,
      );
      if (stopTool) return;
      const fatalTool = completedCalls.find((c) =>
        isFatalToolError(c.response.errorType),
      );
      if (fatalTool) return;

      const functionResponses = completedCalls.flatMap(
        (call) => call.response.responseParts,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      request = functionResponses as unknown as Parameters<
        GeminiClient['sendMessageStream']
      >[0];
    }
  }
}
