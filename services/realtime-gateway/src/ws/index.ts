/**
 * WebSocket Module - Enhanced Real-Time Infrastructure
 *
 * Exports all WebSocket-related components for the real-time gateway
 */

export {
  DEFAULT_CONFIG,
  EnhancedConnectionManager,
} from "./enhanced-connection-manager.js";
export { MessageBuffer } from "./message-buffer.js";
export { MetricsCollector } from "./metrics-collector.js";
export {
  PollingFallbackHandler,
  createPollingRoutes,
} from "./polling-fallback.js";
export * from "./types.js";
