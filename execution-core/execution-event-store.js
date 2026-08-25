'use strict';

export class ExecutionEventStore {
  constructor({ eventsCollection, outboxCollection, logger = console } = {}) {
    if (!eventsCollection || !outboxCollection) {
      throw new Error('EXECUTION_EVENT_STORE_COLLECTIONS_REQUIRED');
    }
    this.events = eventsCollection;
    this.outbox = outboxCollection;
    this.logger = logger;
  }

  async append(event) {
    const now = new Date();
    const record = {
      _id: event.eventId || crypto.randomUUID(),
      executionId: event.executionId,
      type: event.type,
      state: event.state,
      sequence: event.sequence,
      fencingToken: event.fencingToken,
      payload: event.payload || {},
      createdAt: now
    };

    // Event and outbox records are separately durable. A transaction can
    // wrap both writes when the caller has a Mongo session.
    await this.events.insertOne(record);
    await this.outbox.insertOne({
      _id: `outbox:${record._id}`,
      eventId: record._id,
      status: 'PENDING',
      createdAt: now,
      payload: record
    });

    return record;
  }
}

export default ExecutionEventStore;
