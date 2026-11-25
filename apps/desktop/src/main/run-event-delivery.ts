/** Serialize history repair with live journal publication while allowing either to yield. */
export class RunEventDelivery {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  settled(): Promise<void> {
    return this.tail;
  }
}
