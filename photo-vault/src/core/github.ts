// Minimal GitHub REST client for storing the vault in a repository.
//
// Uploads go through the Git Data API (blobs -> tree -> commit -> ref) so a
// whole batch of photos lands in a single commit instead of one per file.

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type GitHubConfig = {
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  apiUrl?: string;
  fetch?: FetchLike;
  // Override for tests so retries don't actually sleep.
  sleep?: (ms: number) => Promise<void>;
};

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type TreeEntry = { path: string; sha: string; size: number };

export type NewFile = { path: string; base64: string };

type RequestOptions = { body?: unknown; accept?: string; allow?: number[] };

const MAX_ATTEMPTS = 4;

export class GitHub {
  readonly owner: string;
  readonly repo: string;
  branch: string | undefined;
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: GitHubConfig) {
    this.token = config.token;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch;
    this.apiUrl = config.apiUrl ?? 'https://api.github.com';
    this.fetchImpl = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private repoPath(path: string) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`;
  }

  private async send(method: string, path: string, options: RequestOptions = {}) {
    let attempt = 0;
    for (;;) {
      attempt++;
      const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: options.accept ?? 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      if (response.ok || options.allow?.includes(response.status)) return response;

      const retryable =
        response.status >= 500 ||
        response.status === 429 ||
        (response.status === 403 && (response.headers.get('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'));
      if (retryable && attempt < MAX_ATTEMPTS) {
        await this.sleep(retryDelay(response.headers, attempt));
        continue;
      }
      let message = `${method} ${path} failed with ${response.status}`;
      try {
        const body = await response.json();
        if (body?.message) message = `GitHub: ${body.message} (${response.status})`;
      } catch {
        // Body wasn't JSON; keep the generic message.
      }
      throw new GitHubError(message, response.status);
    }
  }

  private async json(method: string, path: string, options?: RequestOptions) {
    const response = await this.send(method, path, options);
    return response.json();
  }

  async getRepo(): Promise<{ private: boolean; defaultBranch: string; sizeKb: number }> {
    const data = await this.json('GET', this.repoPath(''));
    this.branch ??= data.default_branch;
    return { private: data.private, defaultBranch: data.default_branch, sizeKb: data.size };
  }

  private async ensureBranch(): Promise<string> {
    if (!this.branch) await this.getRepo();
    return this.branch!;
  }

  // Returns null if the file doesn't exist (or the repository is still empty).
  async getFile(path: string): Promise<{ sha: string; base64: string } | null> {
    const branch = await this.ensureBranch();
    const response = await this.send('GET', this.repoPath(`/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`), {
      allow: [404],
    });
    if (response.status === 404) return null;
    const data = await response.json();
    return { sha: data.sha, base64: data.content };
  }

  // Raw bytes of a file by path (works for files up to 100 MB).
  async getFileBytes(path: string): Promise<Uint8Array> {
    const branch = await this.ensureBranch();
    const response = await this.send('GET', this.repoPath(`/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`), {
      accept: 'application/vnd.github.raw+json',
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  // Raw bytes of a blob by sha (as returned by listTree).
  async getBlobBytes(sha: string): Promise<Uint8Array> {
    const response = await this.send('GET', this.repoPath(`/git/blobs/${sha}`), { accept: 'application/vnd.github.raw+json' });
    return new Uint8Array(await response.arrayBuffer());
  }

  // Creates or replaces a single file. Unlike the Git Data API this also works
  // on a brand new, empty repository, so it's used to write vault.json.
  async putFile(path: string, base64: string, message: string, sha?: string): Promise<void> {
    const branch = await this.ensureBranch();
    await this.json('PUT', this.repoPath(`/contents/${encodePath(path)}`), {
      body: { message, content: base64, branch, ...(sha ? { sha } : {}) },
    });
  }

  private async getHead(): Promise<{ commitSha: string; treeSha: string } | null> {
    const branch = await this.ensureBranch();
    const response = await this.send('GET', this.repoPath(`/git/ref/heads/${encodePath(branch)}`), { allow: [404, 409] });
    if (!response.ok) return null;
    const ref = await response.json();
    const commit = await this.json('GET', this.repoPath(`/git/commits/${ref.object.sha}`));
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  // Lists every file under a top-level folder, e.g. "thumbs".
  async listTree(folder: string): Promise<TreeEntry[]> {
    const head = await this.getHead();
    if (!head) return [];
    const root = await this.json('GET', this.repoPath(`/git/trees/${head.treeSha}`));
    const dir = (root.tree as any[]).find((e) => e.path === folder && e.type === 'tree');
    if (!dir) return [];
    const tree = await this.json('GET', this.repoPath(`/git/trees/${dir.sha}?recursive=1`));
    if (tree.truncated) {
      // GitHub stops at ~100k entries per response. Not expected for a
      // personal library, but say so rather than silently hiding photos.
      console.warn(`Tree listing for ${folder} was truncated by GitHub`);
    }
    return (tree.tree as any[])
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: `${folder}/${e.path}`, sha: e.sha, size: e.size }));
  }

  async createBlob(base64: string): Promise<string> {
    const data = await this.json('POST', this.repoPath('/git/blobs'), { body: { content: base64, encoding: 'base64' } });
    return data.sha;
  }

  // Adds files in one commit. If another phone pushed in the meantime the
  // branch update is rejected, so rebuild on top of the new head and retry.
  async commitFiles(files: NewFile[], message: string): Promise<string> {
    const branch = await this.ensureBranch();
    const entries = [];
    for (const file of files) {
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: await this.createBlob(file.base64) });
    }
    for (let attempt = 1; ; attempt++) {
      const head = await this.getHead();
      if (!head) throw new GitHubError('Repository has no commits yet; set up the vault first', 409);
      const tree = await this.json('POST', this.repoPath('/git/trees'), { body: { base_tree: head.treeSha, tree: entries } });
      const commit = await this.json('POST', this.repoPath('/git/commits'), {
        body: { message, tree: tree.sha, parents: [head.commitSha] },
      });
      const update = await this.send('PATCH', this.repoPath(`/git/refs/heads/${encodePath(branch)}`), {
        body: { sha: commit.sha, force: false },
        allow: [409, 422],
      });
      if (update.ok) return commit.sha;
      if (attempt >= MAX_ATTEMPTS) throw new GitHubError('Could not update branch after several attempts', update.status);
    }
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function retryDelay(headers: { get(name: string): string | null }, attempt: number) {
  const retryAfter = Number(headers.get('retry-after'));
  if (retryAfter > 0) return Math.min(retryAfter, 120) * 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 120_000);
  }
  return 1000 * 2 ** (attempt - 1);
}
