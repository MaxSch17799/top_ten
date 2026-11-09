import { isUncertainFailure } from './http';

interface CommandOperations<A> {
  execute(action: A): Promise<unknown>;
  afterCommit?(action: A): Promise<void>;
  refresh(): Promise<unknown>;
  start(): void;
  failed(error: unknown, retry: A | null): void;
  settled(): void;
}

/** Serializes user submissions; action construction and replay metadata stay game-owned. */
export class CommandSender<A> {
  private active = false;
  async send(action: A, operations: CommandOperations<A>): Promise<boolean> {
    if (this.active) return false;
    // Freeze the submitted decision before awaiting anything or exposing a retry button.
    const submitted = structuredClone(action);
    this.active = true;
    let committed = false, failed = false;
    try {
      operations.start();
      await operations.execute(submitted);
      committed = true;
      await operations.afterCommit?.(submitted);
      return true;
    } catch (error) {
      failed = true;
      operations.failed(error, !committed && isUncertainFailure(error) ? submitted : null);
      return false;
    } finally {
      try { await operations.refresh(); }
      catch (error) { if (!failed) operations.failed(error, null); }
      finally { this.active = false; operations.settled(); }
    }
  }
}
