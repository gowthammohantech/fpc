import { EventEmitter } from 'node:events';
import type { EntityType, Id, NotificationType, RoleKey } from '@fpc/shared';
import { logger } from '../config/logger.js';

/**
 * A minimal in-process event bus.
 *
 * Domain services publish facts ("an invoice was approved"); the notification
 * dispatcher subscribes to them. This keeps the invoice service from knowing
 * anything about email templates, and makes it cheap to add a second consumer
 * later without touching the publisher.
 */
export interface DomainEvent {
  type: NotificationType;
  tenantId: Id;
  companyId?: Id;
  entityType: EntityType;
  entityId: Id;
  /** Users who should be notified in-app. */
  recipientUserIds?: Id[];
  /**
   * Roles whose active members should be notified, resolved to users by the
   * notification handler. Lets a publisher say "whoever reviews invoices"
   * without querying for them itself.
   */
  recipientRoleKeys?: RoleKey[];
  /** External address, used for vendor payment confirmations. */
  recipientEmail?: string;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

class DomainEventBus extends EventEmitter {
  /** Handler promises still running, so a caller can wait for them. */
  private readonly inFlight = new Set<Promise<unknown>>();

  publish(event: DomainEvent): void {
    logger.debug({ type: event.type, entityId: event.entityId }, 'domain event published');
    // Handlers must never break the request that produced the event.
    setImmediate(() => {
      try {
        this.emit('domain-event', event);
      } catch (error) {
        logger.error({ err: error, event: event.type }, 'domain event handler threw');
      }
    });
  }

  subscribe(handler: (event: DomainEvent) => void | Promise<void>): void {
    this.on('domain-event', (event: DomainEvent) => {
      const task = Promise.resolve(handler(event)).catch((error) =>
        logger.error({ err: error, event: event.type }, 'domain event handler failed'),
      );
      this.inFlight.add(task);
      void task.finally(() => this.inFlight.delete(task));
    });
  }

  /**
   * Waits until every published event has been handled.
   *
   * Publishing defers to `setImmediate` and handlers are asynchronous, so a
   * caller that needs the resulting rows — the seed, which has to settle the
   * notification queue it just filled — cannot simply await `publish`. Each
   * pass lets the deferred emits run, then awaits whatever they started, and
   * repeats because a handler may itself publish.
   */
  async flush(): Promise<void> {
    for (let pass = 0; pass < 20; pass += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!this.inFlight.size) return;
      await Promise.allSettled([...this.inFlight]);
    }
    logger.warn('event bus did not settle after 20 passes');
  }
}

export const eventBus = new DomainEventBus();
