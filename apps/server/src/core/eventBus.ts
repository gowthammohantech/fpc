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
      Promise.resolve(handler(event)).catch((error) =>
        logger.error({ err: error, event: event.type }, 'domain event handler failed'),
      );
    });
  }
}

export const eventBus = new DomainEventBus();
