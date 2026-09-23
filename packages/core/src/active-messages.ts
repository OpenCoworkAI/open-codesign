import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import {
  type ActiveRunMessageInputV1,
  type ActiveRunMessageV1,
  CodesignError,
} from '@open-codesign/shared';

type QueuedUserMessage = Extract<AgentMessage, { role: 'user' }> & { codesignMessageId: string };

/** Tracks delivery receipts; pi alone owns scheduling and draining its queues. */
export class ActiveRunMessages {
  private agent: Agent | null = null;
  private accepting = false;
  private readonly records = new Map<string, ActiveRunMessageV1>();

  constructor(
    readonly designId: string,
    readonly generationId: string,
    private readonly onChange: (message: ActiveRunMessageV1) => void,
    private readonly signal?: AbortSignal,
  ) {}

  get hasAcceptedMessages(): boolean {
    return this.records.size > 0;
  }

  bind(agent: Agent): void {
    this.agent?.clearAllQueues();
    this.agent = agent;
    this.accepting = true;
    agent.steeringMode = 'one-at-a-time';
    agent.followUpMode = 'one-at-a-time';
    for (const message of this.records.values()) {
      if (message.status === 'pending') this.enqueue(message);
    }
  }

  submit(input: ActiveRunMessageInputV1): ActiveRunMessageV1 {
    if (input.designId !== this.designId || input.generationId !== this.generationId) {
      throw new CodesignError('The selected generation has changed.', 'IPC_BAD_INPUT');
    }
    const existing = this.records.get(input.messageId);
    if (existing) {
      if (existing.text !== input.text || existing.mode !== input.mode) {
        throw new CodesignError(
          'Message ID already belongs to different content.',
          'IPC_BAD_INPUT',
        );
      }
      return { ...existing };
    }
    if (!this.agent || !this.accepting || this.signal?.aborted) {
      throw new CodesignError(
        'This generation is not accepting messages. Keep the draft and send after it finishes.',
        'GENERATION_NOT_ACTIVE',
      );
    }
    const row: ActiveRunMessageV1 = {
      ...input,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.onChange(row);
    this.records.set(row.messageId, row);
    this.enqueue(row);
    return { ...row };
  }

  private enqueue(row: ActiveRunMessageV1): void {
    const message: QueuedUserMessage = {
      role: 'user',
      content: [{ type: 'text', text: row.text }],
      timestamp: Date.parse(row.createdAt),
      codesignMessageId: row.messageId,
    };
    if (row.mode === 'steer') this.agent?.steer(message);
    else this.agent?.followUp(message);
  }

  handleEvent(event: AgentEvent, onDelivered: () => void): void {
    if (event.type === 'agent_end') {
      this.accepting = false;
      return;
    }
    if (event.type !== 'message_start' || event.message.role !== 'user') return;
    const id = (event.message as Partial<QueuedUserMessage>).codesignMessageId;
    const pending = id ? this.records.get(id) : undefined;
    if (!pending || pending.status !== 'pending') return;
    if (this.signal?.aborted)
      throw new CodesignError(
        'Generation cancelled before message delivery.',
        'GENERATION_CANCELLED',
      );
    const delivered = { ...pending, status: 'delivered' as const };
    this.onChange(delivered);
    this.records.set(delivered.messageId, delivered);
    onDelivered();
  }

  close(
    reason = 'Generation ended before this message was delivered. Recover it to send again.',
  ): void {
    this.accepting = false;
    this.agent?.clearAllQueues();
    this.agent = null;
    for (const pending of this.records.values()) {
      if (pending.status !== 'pending') continue;
      const row = { ...pending, status: 'not-delivered' as const, reason };
      this.onChange(row);
      this.records.set(row.messageId, row);
    }
  }
}
