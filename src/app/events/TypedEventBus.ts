export type EventHandler<TPayload> = (payload: TPayload) => void;

export interface EventSubscription {
  unsubscribe(): void;
}

/**
 * Small synchronous event bus used at module boundaries.
 * It deliberately has no React, Live2D, or Tauri dependency.
 */
export class TypedEventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();

  on<TKey extends keyof TEvents>(
    eventName: TKey,
    handler: EventHandler<TEvents[TKey]>,
  ): EventSubscription {
    const eventHandlers = this.handlers.get(eventName) ?? new Set<EventHandler<unknown>>();
    eventHandlers.add(handler as EventHandler<unknown>);
    this.handlers.set(eventName, eventHandlers);

    return {
      unsubscribe: () => {
        eventHandlers.delete(handler as EventHandler<unknown>);
        if (eventHandlers.size === 0) {
          this.handlers.delete(eventName);
        }
      },
    };
  }

  emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): void {
    const eventHandlers = this.handlers.get(eventName);
    if (!eventHandlers) return;

    for (const handler of [...eventHandlers]) {
      handler(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
