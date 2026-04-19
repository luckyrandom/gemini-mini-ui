/**
 * Per-stream approval bridge.
 *
 * The SDK's scheduler parks destructive tool calls in AwaitingApproval and
 * publishes a TOOL_CALLS_UPDATE with a correlationId. We surface those to the
 * browser as synthetic stream events and, when the user responds, publish a
 * TOOL_CONFIRMATION_RESPONSE back onto the bus so the scheduler unblocks.
 *
 * v1: each call is prompted individually. There is no session-scoped "always
 * allow" — every destructive call re-asks.
 */

import { randomUUID } from 'node:crypto';

import {
  MessageBusType,
  ToolConfirmationOutcome,
  type Message,
  type ToolCallsUpdateMessage,
} from '@google/gemini-cli-core';

/**
 * Narrow slice of MessageBus that ApprovalBridge actually uses. Keeping the
 * surface small means a fake session can satisfy it without constructing a
 * real PolicyEngine.
 */
export interface ApprovalBus {
  subscribe(
    type: MessageBusType.TOOL_CALLS_UPDATE,
    listener: (msg: ToolCallsUpdateMessage) => void,
  ): void;
  unsubscribe(
    type: MessageBusType.TOOL_CALLS_UPDATE,
    listener: (msg: ToolCallsUpdateMessage) => void,
  ): void;
  publish(message: Message): Promise<void> | void;
}

export type ApprovalOutcome = 'proceed' | 'cancel';

export type PendingApproval = {
  correlationId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  details: unknown;
};

export type ApprovalEvent =
  | { type: 'tool_confirmation_request'; value: PendingApproval }
  | { type: 'tool_confirmation_resolved'; value: { correlationId: string; outcome: ApprovalOutcome } };

/**
 * Bridge owned by a single in-flight stream. Outlives no stream — create one
 * per sendStream, dispose when the stream ends.
 */
export class ApprovalBridge {
  readonly id = randomUUID();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly seen = new Set<string>();
  private readonly listener: (msg: ToolCallsUpdateMessage) => void;
  private disposed = false;
  private emit: (event: ApprovalEvent) => void;

  constructor(
    private readonly bus: ApprovalBus,
    emit: (event: ApprovalEvent) => void,
  ) {
    this.emit = emit;
    this.listener = (msg) => this.onToolCallsUpdate(msg);
    this.bus.subscribe(MessageBusType.TOOL_CALLS_UPDATE, this.listener);
  }

  setEmit(emit: (event: ApprovalEvent) => void): void {
    this.emit = emit;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  getAllPending(): PendingApproval[] {
    return Array.from(this.pending.values());
  }

  getPending(correlationId: string): PendingApproval | undefined {
    return this.pending.get(correlationId);
  }

  /**
   * Publish the user's decision onto the message bus so the scheduler can
   * resume. Also clears local pending state for this correlationId.
   */
  async resolve(correlationId: string, outcome: ApprovalOutcome): Promise<void> {
    if (this.disposed) return;
    this.pending.delete(correlationId);
    await this.bus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId,
      confirmed: outcome === 'proceed',
      outcome:
        outcome === 'proceed'
          ? ToolConfirmationOutcome.ProceedOnce
          : ToolConfirmationOutcome.Cancel,
    });
    this.emit({
      type: 'tool_confirmation_resolved',
      value: { correlationId, outcome },
    });
  }

  /**
   * Auto-cancel any still-pending approvals (e.g. when the stream aborts).
   * Without this the scheduler would hang until its own abort signal fires,
   * but this is cheap insurance and keeps the bus clean.
   */
  async cancelAllPending(): Promise<void> {
    if (this.disposed) return;
    const ids = [...this.pending.keys()];
    for (const id of ids) await this.resolve(id, 'cancel');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bus.unsubscribe(MessageBusType.TOOL_CALLS_UPDATE, this.listener);
    this.pending.clear();
  }

  private onToolCallsUpdate(msg: ToolCallsUpdateMessage): void {
    for (const call of msg.toolCalls) {
      if (call.status !== 'awaiting_approval') continue;
      const correlationId = (call as { correlationId?: string }).correlationId;
      if (!correlationId || this.seen.has(correlationId)) continue;
      this.seen.add(correlationId);
      const pending: PendingApproval = {
        correlationId,
        callId: call.request.callId,
        toolName: call.request.name,
        args: (call.request.args ?? {}) as Record<string, unknown>,
        details: (call as { confirmationDetails?: unknown }).confirmationDetails,
      };
      this.pending.set(correlationId, pending);
      this.emit({ type: 'tool_confirmation_request', value: pending });
    }
  }
}
