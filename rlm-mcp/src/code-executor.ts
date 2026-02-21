/**
 * Code Executor - Safe JavaScript execution environment for RLM
 *
 * Uses Node.js built-in vm module for sandboxed execution.
 * Code runs in a separate V8 context with controlled access to APIs.
 */

import vm from 'node:vm';
import { contextStore } from './context-store.js';

export interface ExecutionResult {
  success: boolean;
  result?: unknown;
  output: string[];
  error?: string;
  executionTimeMs: number;
}

export class CodeExecutor {
  private output: string[] = [];

  /**
   * Execute JavaScript code in a sandboxed vm context
   */
  async execute(code: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.output = [];
    const output = this.output;

    try {
      // Get context data
      const contextData: Record<string, unknown> = contextStore.getAllAsObject();
      const pendingStores: Record<string, string> = {};

      // Create sandbox with limited API
      const sandbox = {
        context: { ...contextData },
        console: {
          log: (...args: unknown[]) => {
            output.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
          },
          info: (...args: unknown[]) => {
            output.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
          },
          warn: (...args: unknown[]) => {
            output.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
          },
          error: (...args: unknown[]) => {
            output.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
          },
        },
        get: (name: string) => contextData[name],
        store: (name: string, value: unknown) => {
          const strValue = typeof value === 'string' ? value : JSON.stringify(value);
          pendingStores[name] = strValue;
          contextData[name] = value;
          return true;
        },
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Math,
        Date,
        RegExp,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
      };

      // Create VM context
      const vmContext = vm.createContext(sandbox);

      // Wrap code in async function to support return statements
      const wrappedCode = `
        (function() {
          ${code}
        })();
      `;

      // Execute with timeout
      const script = new vm.Script(wrappedCode);
      const result = script.runInContext(vmContext, { timeout: timeoutMs });

      // Store any pending values
      for (const [name, value] of Object.entries(pendingStores)) {
        contextStore.store_value(name, value);
      }

      return {
        success: true,
        result: this.serializeResult(result),
        output: this.output,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: this.output,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  private serializeResult(result: unknown): unknown {
    if (result === undefined) return undefined;
    if (result === null) return null;
    if (typeof result === 'string') return result;
    if (typeof result === 'number') return result;
    if (typeof result === 'boolean') return result;

    try {
      return JSON.parse(JSON.stringify(result));
    } catch {
      return String(result);
    }
  }

  reset(): void {
    this.output = [];
  }

  dispose(): void {
    this.output = [];
  }
}

// Export singleton instance
export const codeExecutor = new CodeExecutor();
