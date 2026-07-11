import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const correlationStorage = new AsyncLocalStorage();

/**
 * Executes a callback within a correlation context.
 * If no ID is provided, a new random UUID is generated.
 *
 * @param {string} [id] - Optional predefined correlation ID (e.g. from an incoming HTTP header)
 * @param {Function} callback - The function to run within the context
 * @returns The result of the callback
 */
export function withCorrelationId(id, callback) {
  const correlationId = id || crypto.randomUUID();
  return correlationStorage.run(correlationId, callback);
}

/**
 * Retrieves the current correlation ID from the async context.
 *
 * @returns {string | undefined} The current correlation ID, or undefined if outside a context
 */
export function getCorrelationId() {
  return correlationStorage.getStore();
}
