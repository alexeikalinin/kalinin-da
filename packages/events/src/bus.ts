import type { WorkflowEvent, WorkflowEventType } from "./events.ts";

export type EventHandler<E> = (event: E) => void | Promise<void>;
export type Unsubscribe = () => void;

// In-memory pub/sub — a placeholder for the real event bus (technology
// choice explicitly out of scope for Events, see docs §Scope). Good enough
// to encode and test the *subscription rules* from Events §2; not meant to
// survive a process restart on its own (that's ADR-0002's job for Workflow
// Engine state, and Logging/Audit's job for the durable record of events).
export interface EventBus {
  publish(event: WorkflowEvent): Promise<void>;
  // "*" subscribes to every event type — this is exactly what Logging/Audit
  // requires (Events §2: "подписан на все события без исключения").
  subscribe(type: WorkflowEventType | "*", handler: EventHandler<WorkflowEvent>): Unsubscribe;
}

export function createEventBus(): EventBus {
  const handlersByType = new Map<
    WorkflowEventType | "*",
    Set<EventHandler<WorkflowEvent>>
  >();

  function handlersFor(type: WorkflowEventType | "*"): Set<EventHandler<WorkflowEvent>> {
    let set = handlersByType.get(type);
    if (!set) {
      set = new Set();
      handlersByType.set(type, set);
    }
    return set;
  }

  return {
    async publish(event) {
      const specific = handlersByType.get(event.type) ?? new Set();
      const wildcard = handlersByType.get("*") ?? new Set();
      for (const handler of [...specific, ...wildcard]) {
        await handler(event);
      }
    },
    subscribe(type, handler) {
      const set = handlersFor(type);
      set.add(handler);
      return () => set.delete(handler);
    },
  };
}
