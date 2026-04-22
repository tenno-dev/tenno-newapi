import * as path from "node:path";
import type { BlobStore, BlobObject, BlobListResult } from "../../app/types";

class LocalBlobObject implements BlobObject {
  constructor(private readonly filePath: string) {}

  async text(): Promise<string> {
    return Bun.file(this.filePath).text();
  }

  async json<T = unknown>(): Promise<T> {
    return Bun.file(this.filePath).json();
  }
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly basePath: string) {}

  async get(key: string): Promise<BlobObject | null> {
    const filePath = path.join(this.basePath, key);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return new LocalBlobObject(filePath);
  }

  async put(
    key: string,
    value: string,
    _opts?: { httpMetadata?: { contentType?: string } }
  ): Promise<void> {
    const filePath = path.join(this.basePath, key);
    // Bun.write natively creates parent directories as needed. 
    // No explicit mkdir(dirname) call required.
    await Bun.write(filePath, value);
  }

  async list(
    opts: { prefix?: string; cursor?: string; limit?: number } = {}
  ): Promise<BlobListResult> {
    const limit = opts.limit ?? 50;
    const prefix = opts.prefix ?? "";
    const cursorOffset = opts.cursor ? parseInt(opts.cursor, 10) : 0;

    const glob = new Bun.Glob("**/*");
    const allFiles: string[] = [];
    
    for await (const file of glob.scan({ cwd: this.basePath })) {
      const normalizedPath = file.replace(/\\/g, "/");
      if (normalizedPath.startsWith(prefix)) {
        allFiles.push(normalizedPath);
      }
    }

    allFiles.sort();

    const page = allFiles.slice(cursorOffset, cursorOffset + limit);

    const objects = await Promise.all(
      page.map(async (key) => {
        const file = Bun.file(path.join(this.basePath, key));
        return { key, size: file.size };
      })
    );

    const nextOffset = cursorOffset + limit;
    const hasMore = nextOffset < allFiles.length;

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
