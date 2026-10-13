// In-memory stand-in for the parts of the GitHub API the app uses. Test-only.

import { createHash } from 'node:crypto';

import type { FetchLike } from '../src/core/github';

type Obj = { type: 'blob'; data: Buffer } | { type: 'tree'; entries: Map<string, string> } | { type: 'commit'; tree: string; parents: string[] };

export function createFakeGitHub(options: { private?: boolean } = {}) {
  const objects = new Map<string, Obj>();
  let head: string | null = null;
  const calls: string[] = [];
  // Lets a test simulate another phone pushing between our tree and ref update.
  let beforeRefUpdate: (() => void) | null = null;

  const put = (obj: Obj) => {
    const sha = createHash('sha1').update(JSON.stringify(obj, (_, v) => (v instanceof Map ? [...v] : v))).update(String(objects.size)).digest('hex');
    objects.set(sha, obj);
    return sha;
  };
  const emptyTree = () => put({ type: 'tree', entries: new Map() });

  const getTree = (sha: string) => {
    const obj = objects.get(sha);
    if (obj?.type !== 'tree') throw new Error('not a tree');
    return obj;
  };

  // Returns a new tree sha with `path` set to blob `blobSha`.
  const setPath = (treeSha: string | null, parts: string[], blobSha: string): string => {
    const entries = new Map(treeSha ? getTree(treeSha).entries : []);
    const [name, ...rest] = parts;
    entries.set(name, rest.length === 0 ? blobSha : setPath(entries.get(name) ?? null, rest, blobSha));
    return put({ type: 'tree', entries });
  };

  const findPath = (treeSha: string, parts: string[]): string | null => {
    const sha = getTree(treeSha).entries.get(parts[0]);
    if (!sha) return null;
    return parts.length === 1 ? sha : objects.get(sha)?.type === 'tree' ? findPath(sha, parts.slice(1)) : null;
  };

  const listing = (treeSha: string, recursive: boolean, prefix = ''): any[] =>
    [...getTree(treeSha).entries].flatMap(([name, sha]) => {
      const obj = objects.get(sha)!;
      const path = prefix + name;
      if (obj.type === 'tree') return [{ path, sha, type: 'tree' }, ...(recursive ? listing(sha, true, path + '/') : [])];
      return [{ path, sha, type: 'blob', size: (obj as any).data.length }];
    });

  const commitTree = () => (head ? (objects.get(head) as any).tree : null);

  const respond = (status: number, body?: unknown, raw?: Buffer) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => {
      const buf = raw ?? Buffer.from(JSON.stringify(body));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  });

  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''));
    const body = init.body ? JSON.parse(init.body) : undefined;
    const raw = init.headers?.Accept?.includes('raw');
    calls.push(`${method} ${path}`);

    if (method === 'GET' && path === '') return respond(200, { private: options.private ?? true, default_branch: 'main', size: 0 });

    if (path.startsWith('/contents/')) {
      const filePath = path.slice('/contents/'.length);
      if (method === 'GET') {
        const tree = commitTree();
        const sha = tree ? findPath(tree, filePath.split('/')) : null;
        if (!sha) return respond(404, { message: 'Not Found' });
        const data = (objects.get(sha) as any).data as Buffer;
        return raw ? respond(200, undefined, data) : respond(200, { sha, content: data.toString('base64').replace(/(.{60})/g, '$1\n') });
      }
      if (method === 'PUT') {
        const blob = put({ type: 'blob', data: Buffer.from(body.content, 'base64') });
        const tree = setPath(commitTree(), filePath.split('/'), blob);
        head = put({ type: 'commit', tree, parents: head ? [head] : [] });
        return respond(201, { content: { sha: blob } });
      }
    }

    if (path === '/git/ref/heads/main') {
      if (!head) return respond(409, { message: 'Git Repository is empty.' });
      return respond(200, { object: { sha: head } });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      beforeRefUpdate?.();
      beforeRefUpdate = null;
      const commit = objects.get(body.sha) as any;
      if (!commit.parents.includes(head)) return respond(422, { message: 'Update is not a fast forward' });
      head = body.sha;
      return respond(200, { object: { sha: head } });
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const commit = objects.get(path.split('/').pop()!) as any;
      return respond(200, { sha: path.split('/').pop(), tree: { sha: commit.tree } });
    }
    if (method === 'POST' && path === '/git/commits') {
      return respond(201, { sha: put({ type: 'commit', tree: body.tree, parents: body.parents }) });
    }
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      return respond(200, { tree: listing(path.split('/').pop()!, u.searchParams.has('recursive')), truncated: false });
    }
    if (method === 'POST' && path === '/git/trees') {
      let tree = body.base_tree ?? emptyTree();
      for (const entry of body.tree) tree = setPath(tree, entry.path.split('/'), entry.sha);
      return respond(201, { sha: tree });
    }
    if (method === 'POST' && path === '/git/blobs') {
      return respond(201, { sha: put({ type: 'blob', data: Buffer.from(body.content, 'base64') }) });
    }
    if (method === 'GET' && path.startsWith('/git/blobs/')) {
      const obj = objects.get(path.split('/').pop()!) as any;
      return respond(200, undefined, obj.data);
    }
    return respond(404, { message: `Fake GitHub does not handle ${method} ${path}` });
  };

  return {
    fetch,
    calls,
    commitCount() {
      let n = 0;
      for (let c = head; c; c = (objects.get(c) as any).parents[0] ?? null) n++;
      return n;
    },
    onNextRefUpdate(fn: () => void) {
      beforeRefUpdate = fn;
    },
    // Simulates a push from elsewhere that adds a file directly.
    externalPush(filePath: string, content: string) {
      const blob = put({ type: 'blob', data: Buffer.from(content) });
      const tree = setPath(commitTree(), filePath.split('/'), blob);
      head = put({ type: 'commit', tree, parents: head ? [head] : [] });
    },
  };
}
