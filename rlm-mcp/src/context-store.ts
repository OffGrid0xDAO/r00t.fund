/**
 * Context Store - In-memory storage for RLM context variables
 *
 * Based on the RLM paper (Zhang et al., 2025), this treats prompts/context
 * as external environment variables that can be programmatically manipulated.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ContextMetadata {
  name: string;
  type: 'text' | 'file' | 'directory' | 'chunk' | 'result';
  length: number;
  lineCount: number;
  estimatedTokens: number;
  sourcePath?: string;
  createdAt: Date;
  chunks?: string[];
}

export interface ChunkInfo {
  name: string;
  index: number;
  startLine: number;
  endLine: number;
  length: number;
}

export interface SearchResult {
  lineNumber: number;
  content: string;
  context: string[];
}

class ContextStore {
  private store: Map<string, string> = new Map();
  private metadata: Map<string, ContextMetadata> = new Map();

  /**
   * Estimate token count (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Count lines in text
   */
  private countLines(text: string): number {
    return text.split('\n').length;
  }

  /**
   * Load content from a file
   */
  private loadFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Recursively load all files from a directory
   */
  private loadDirectory(dirPath: string, extensions?: string[]): string {
    const results: string[] = [];

    const walkDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        // Skip common non-code directories
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv'].includes(entry.name)) {
            continue;
          }
          walkDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          // Filter by extensions if provided
          if (extensions && !extensions.includes(ext)) {
            continue;
          }

          // Skip binary and non-text files
          const skipExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.wasm', '.bin'];
          if (skipExtensions.includes(ext)) {
            continue;
          }

          try {
            const relativePath = path.relative(dirPath, fullPath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            results.push(`\n${'='.repeat(80)}\n// FILE: ${relativePath}\n${'='.repeat(80)}\n${content}`);
          } catch (e) {
            // Skip files that can't be read as text
          }
        }
      }
    };

    walkDir(dirPath);
    return results.join('\n');
  }

  /**
   * Load content into the store
   */
  load(name: string, options: { path?: string; content?: string; extensions?: string[] }): ContextMetadata {
    let content: string;
    let type: ContextMetadata['type'];
    let sourcePath: string | undefined;

    if (options.content) {
      content = options.content;
      type = 'text';
    } else if (options.path) {
      sourcePath = options.path;
      const stat = fs.statSync(options.path);

      if (stat.isDirectory()) {
        content = this.loadDirectory(options.path, options.extensions);
        type = 'directory';
      } else {
        content = this.loadFile(options.path);
        type = 'file';
      }
    } else {
      throw new Error('Either path or content must be provided');
    }

    this.store.set(name, content);

    const meta: ContextMetadata = {
      name,
      type,
      length: content.length,
      lineCount: this.countLines(content),
      estimatedTokens: this.estimateTokens(content),
      sourcePath,
      createdAt: new Date(),
    };

    this.metadata.set(name, meta);
    return meta;
  }

  /**
   * Get content from the store
   */
  get(name: string): string | undefined {
    return this.store.get(name);
  }

  /**
   * Store a value (for results, aggregations, etc.)
   */
  store_value(name: string, value: string): ContextMetadata {
    this.store.set(name, value);

    const meta: ContextMetadata = {
      name,
      type: 'result',
      length: value.length,
      lineCount: this.countLines(value),
      estimatedTokens: this.estimateTokens(value),
      createdAt: new Date(),
    };

    this.metadata.set(name, meta);
    return meta;
  }

  /**
   * Peek at a portion of the content
   */
  peek(name: string, offset: number = 0, limit: number = 1000, unit: 'chars' | 'lines' = 'chars'): {
    content: string;
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  } {
    const content = this.store.get(name);
    if (!content) {
      throw new Error(`Context '${name}' not found`);
    }

    let result: string;
    let total: number;

    if (unit === 'lines') {
      const lines = content.split('\n');
      total = lines.length;
      result = lines.slice(offset, offset + limit).join('\n');
    } else {
      total = content.length;
      result = content.slice(offset, offset + limit);
    }

    return {
      content: result,
      offset,
      limit,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Search content using regex or keyword
   */
  search(name: string, pattern: string, contextLines: number = 2, maxResults: number = 20): SearchResult[] {
    const content = this.store.get(name);
    if (!content) {
      throw new Error(`Context '${name}' not found`);
    }

    const lines = content.split('\n');
    const results: SearchResult[] = [];
    const regex = new RegExp(pattern, 'gi');

    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);

        results.push({
          lineNumber: i + 1,
          content: lines[i],
          context: lines.slice(start, end),
        });
      }
      regex.lastIndex = 0; // Reset regex state
    }

    return results;
  }

  /**
   * Chunk content into smaller pieces
   */
  chunk(name: string, strategy: 'lines' | 'chars' | 'files' | 'regex', size: number = 100, regexDelimiter?: string): ChunkInfo[] {
    const content = this.store.get(name);
    if (!content) {
      throw new Error(`Context '${name}' not found`);
    }

    const chunks: ChunkInfo[] = [];
    const lines = content.split('\n');

    if (strategy === 'files') {
      // Split by file markers (created by loadDirectory)
      const fileRegex = /^={80}\n\/\/ FILE: (.+)\n={80}$/gm;
      const parts = content.split(fileRegex);

      let currentLine = 0;
      for (let i = 1; i < parts.length; i += 2) {
        const chunkName = `${name}_chunk_${Math.floor(i / 2)}`;
        const chunkContent = parts[i + 1] || '';

        this.store.set(chunkName, chunkContent);

        const chunkLines = this.countLines(chunkContent);
        chunks.push({
          name: chunkName,
          index: Math.floor(i / 2),
          startLine: currentLine,
          endLine: currentLine + chunkLines,
          length: chunkContent.length,
        });

        this.metadata.set(chunkName, {
          name: chunkName,
          type: 'chunk',
          length: chunkContent.length,
          lineCount: chunkLines,
          estimatedTokens: this.estimateTokens(chunkContent),
          createdAt: new Date(),
        });

        currentLine += chunkLines;
      }
    } else if (strategy === 'lines') {
      for (let i = 0; i < lines.length; i += size) {
        const chunkName = `${name}_chunk_${Math.floor(i / size)}`;
        const chunkLines = lines.slice(i, i + size);
        const chunkContent = chunkLines.join('\n');

        this.store.set(chunkName, chunkContent);

        chunks.push({
          name: chunkName,
          index: Math.floor(i / size),
          startLine: i,
          endLine: Math.min(i + size, lines.length),
          length: chunkContent.length,
        });

        this.metadata.set(chunkName, {
          name: chunkName,
          type: 'chunk',
          length: chunkContent.length,
          lineCount: chunkLines.length,
          estimatedTokens: this.estimateTokens(chunkContent),
          createdAt: new Date(),
        });
      }
    } else if (strategy === 'chars') {
      let currentLine = 0;
      for (let i = 0; i < content.length; i += size) {
        const chunkName = `${name}_chunk_${Math.floor(i / size)}`;
        const chunkContent = content.slice(i, i + size);
        const chunkLineCount = this.countLines(chunkContent);

        this.store.set(chunkName, chunkContent);

        chunks.push({
          name: chunkName,
          index: Math.floor(i / size),
          startLine: currentLine,
          endLine: currentLine + chunkLineCount,
          length: chunkContent.length,
        });

        this.metadata.set(chunkName, {
          name: chunkName,
          type: 'chunk',
          length: chunkContent.length,
          lineCount: chunkLineCount,
          estimatedTokens: this.estimateTokens(chunkContent),
          createdAt: new Date(),
        });

        currentLine += chunkLineCount;
      }
    } else if (strategy === 'regex' && regexDelimiter) {
      const parts = content.split(new RegExp(regexDelimiter, 'g'));
      let currentLine = 0;

      for (let i = 0; i < parts.length; i++) {
        const chunkName = `${name}_chunk_${i}`;
        const chunkContent = parts[i];
        const chunkLineCount = this.countLines(chunkContent);

        this.store.set(chunkName, chunkContent);

        chunks.push({
          name: chunkName,
          index: i,
          startLine: currentLine,
          endLine: currentLine + chunkLineCount,
          length: chunkContent.length,
        });

        this.metadata.set(chunkName, {
          name: chunkName,
          type: 'chunk',
          length: chunkContent.length,
          lineCount: chunkLineCount,
          estimatedTokens: this.estimateTokens(chunkContent),
          createdAt: new Date(),
        });

        currentLine += chunkLineCount;
      }
    }

    // Update parent metadata with chunk references
    const parentMeta = this.metadata.get(name);
    if (parentMeta) {
      parentMeta.chunks = chunks.map(c => c.name);
      this.metadata.set(name, parentMeta);
    }

    return chunks;
  }

  /**
   * List all stored contexts
   */
  list(): ContextMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get metadata for a specific context
   */
  getMetadata(name: string): ContextMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Clear a specific context or all contexts
   */
  clear(name?: string): void {
    if (name) {
      // Clear the named context and any chunks
      const meta = this.metadata.get(name);
      if (meta?.chunks) {
        for (const chunkName of meta.chunks) {
          this.store.delete(chunkName);
          this.metadata.delete(chunkName);
        }
      }
      this.store.delete(name);
      this.metadata.delete(name);
    } else {
      this.store.clear();
      this.metadata.clear();
    }
  }

  /**
   * Get all context as an object (for code execution)
   */
  getAllAsObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of this.store.entries()) {
      obj[key] = value;
    }
    return obj;
  }
}

// Export singleton instance
export const contextStore = new ContextStore();
