/**
 * Debug Logger for Instagram Claw Connector
 * 
 * Provides structured logging with configurable debug mode and timestamp formatting.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5
 */

/**
 * DebugLogger class
 * 
 * A logger that supports multiple log levels with conditional output based on debug mode.
 * All logs include ISO 8601 timestamps and a configurable prefix.
 */
export class DebugLogger {
  /**
   * Creates a new DebugLogger instance
   * 
   * @param enabled - Whether debug logging is enabled
   * @param prefix - Prefix to prepend to all log messages (default: '[InstaClawConnector]')
   */
  constructor(
    private enabled: boolean,
    private prefix: string = '[InstaClawConnector]'
  ) {}

  /**
   * Log an informational message
   * Always outputs regardless of debug mode
   * 
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  info(message: string, ...args: any[]): void {
    const timestamp = this.formatTimestamp();
    console.log(`${timestamp} [INFO] ${this.prefix}`, message, ...args);
  }

  /**
   * Log a debug message
   * Only outputs when debug mode is enabled
   * 
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  debug(message: string, ...args: any[]): void {
    if (this.enabled) {
      const timestamp = this.formatTimestamp();
      console.log(`${timestamp} [DEBUG] ${this.prefix}`, message, ...args);
    }
  }

  /**
   * Log a warning message
   * Always outputs regardless of debug mode
   * 
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  warn(message: string, ...args: any[]): void {
    const timestamp = this.formatTimestamp();
    console.warn(`${timestamp} [WARN] ${this.prefix}`, message, ...args);
  }

  /**
   * Log an error message with optional error stack
   * Always outputs regardless of debug mode
   * 
   * @param message - The error message to log
   * @param error - Optional Error object (stack will be included)
   * @param args - Additional arguments to log
   */
  error(message: string, errorOrContext?: unknown, ...args: any[]): void {
    const timestamp = this.formatTimestamp();
    
    if (errorOrContext instanceof Error) {
      console.error(
        `${timestamp} [ERROR] ${this.prefix}`,
        message,
        '\nError:',
        errorOrContext.message,
        '\nStack:',
        errorOrContext.stack,
        ...args
      );
    } else {
      const trailingArgs = errorOrContext === undefined ? args : [errorOrContext, ...args];
      console.error(`${timestamp} [ERROR] ${this.prefix}`, message, ...trailingArgs);
    }
  }

  /**
   * Format the current timestamp in ISO 8601 format
   * 
   * @returns ISO 8601 formatted timestamp string
   * @private
   */
  private formatTimestamp(): string {
    return new Date().toISOString();
  }
}
