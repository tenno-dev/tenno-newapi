import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import type { BlobStore, BlobObject, BlobListResult } from "../../app/types";

class LocalBlobObject implements BlobObject {
  constructor(private readonly filePath: string) {}

  async text(): Promise<string> {
    return readFile(this.filePath, "utf8");
  }

  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text) as T;
  }
}

async function collectFiles(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    const { readdir } = await import("fs/promises");
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, results);
    } else {
      results.push(full);
    }
  }
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly basePath: string) {}

  async get(key: string): Promise<BlobObject | null> {
    const filePath = path.join(this.basePath, key);
    if (!existsSync(filePath)) return null;
    return new LocalBlobObject(filePath);
  }

  async put(
    key: string,
    value: string,
    _opts?: { httpMetadata?: { contentType?: string } }
  ): Promise<void> {
    const filePath = path.join(this.basePath, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value, "utf8");
  }

  async list(
    opts: { prefix?: string; cursor?: string; limit?: number } = {}
  ): Promise<BlobListResult> {
    const limit = opts.limit ?? 50;
    const prefix = opts.prefix ?? "";
    const cursorOffset = opts.cursor ? parseInt(opts.cursor, 10) : 0;

    const allFiles: string[] = [];
    await collectFiles(this.basePath, allFiles);

    const relFiles = allFiles
      .map((f) => path.relative(this.basePath, f).replace(/\\/g, "/"))
      .filter((f) => f.startsWith(prefix))
      .sort();

    const page = relFiles.slice(cursorOffset, cursorOffset + limit);

    const objects = await Promise.all(
      page.map(async (key) => {
        const filePath = path.join(this.basePath, key);
        try {
          const s = await stat(filePath);
          return { key, size: s.size };
        } catch {
          return { key, size: 0 };
        }
      })
    );

    const nextOffset = cursorOffset + limit;
    const hasMore = nextOffset < relFiles.length;

    return {
      objects,
      truncated: hasMore,
      cursor: hasMore ? String(nextOffset) : undefined,
    };
  }
}

export function createLocalBlobStore(basePath: string): BlobStore {
  return new LocalBlobStore(basePath);
}
