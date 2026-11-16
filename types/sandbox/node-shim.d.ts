// Minimal Node.js type declarations used only where @types/node cannot be installed
// (the sandbox this project was first built in). The real build uses @types/node via tsconfig.json.
// Keep this file in sync with the Node APIs the code base actually uses.

declare var process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  cwd(): string;
  on(event: string, listener: (...args: any[]) => void): void;
  platform: string;
  version: string;
  pid: number;
  uptime(): number;
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number };
  hrtime: { bigint(): bigint };
  nextTick(fn: (...args: any[]) => void, ...args: any[]): void;
  stdout: { write(s: string): boolean };
  stderr: { write(s: string): boolean };
};

declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
};

declare class Buffer extends Uint8Array {
  static from(data: string | ArrayLike<number> | ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  static alloc(size: number, fill?: number | string): Buffer;
  static concat(list: Uint8Array[], totalLength?: number): Buffer;
  static byteLength(s: string | Uint8Array, encoding?: string): number;
  static isBuffer(x: unknown): x is Buffer;
  toString(encoding?: string, start?: number, end?: number): string;
  write(s: string, offset?: number, encoding?: string): number;
  writeUInt32LE(v: number, offset: number): number;
  writeUInt16LE(v: number, offset: number): number;
  readUInt32LE(offset: number): number;
  readUInt16LE(offset: number): number;
  equals(other: Uint8Array): boolean;
  subarray(start?: number, end?: number): Buffer;
  slice(start?: number, end?: number): Buffer;
}

declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearTimeout(t: any): void;
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearInterval(t: any): void;
declare function setImmediate(fn: (...args: any[]) => void): any;
declare function queueMicrotask(fn: () => void): void;
declare function structuredClone<T>(v: T): T;
declare function fetch(input: string | URL, init?: any): Promise<any>;
declare var performance: { now(): number };
declare var globalThis: any;

declare class URL {
  constructor(input: string, base?: string | URL);
  href: string;
  origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  hash: string;
  toString(): string;
}
declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | Iterable<[string, string]>);
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  delete(name: string): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  forEach(cb: (value: string, key: string) => void): void;
  toString(): string;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare class TextEncoder { encode(s: string): Uint8Array; }
declare class TextDecoder { constructor(label?: string); decode(b: Uint8Array | ArrayBuffer): string; }
declare class AbortController { signal: any; abort(): void; }
declare class AbortSignal { static timeout(ms: number): any; }

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
    on(event: 'data', cb: (chunk: Buffer) => void): this;
    on(event: 'end', cb: () => void): this;
    on(event: 'error', cb: (e: Error) => void): this;
    on(event: string, cb: (...args: any[]) => void): this;
  }
  export interface ServerResponse {
    statusCode: number;
    headersSent: boolean;
    setHeader(name: string, value: string | number | string[]): void;
    getHeader(name: string): string | number | string[] | undefined;
    writeHead(status: number, headers?: Record<string, string | number | string[]>): this;
    write(chunk: string | Uint8Array): boolean;
    end(chunk?: string | Uint8Array): void;
    on(event: string, cb: (...args: any[]) => void): this;
  }
  export interface Server {
    listen(port: number, host?: string, cb?: () => void): this;
    listen(port: number, cb?: () => void): this;
    close(cb?: (err?: Error) => void): this;
    address(): { port: number; address: string } | string | null;
    on(event: string, cb: (...args: any[]) => void): this;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function readFileSync(path: string): Buffer;
  export function writeFileSync(path: string, data: string | Uint8Array, options?: any): void;
  export function appendFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number; mtimeMs: number; isDirectory(): boolean; isFile(): boolean };
  export function copyFileSync(src: string, dest: string): void;
  export function unlinkSync(path: string): void;
  export function renameSync(a: string, b: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function normalize(p: string): string;
  export const sep: string;
}

declare module 'node:url' {
  export function fileURLToPath(u: string | URL): string;
  export function pathToFileURL(p: string): URL;
}

declare module 'node:crypto' {
  export function randomBytes(n: number): Buffer;
  export function randomUUID(): string;
  export function randomInt(max: number): number;
  export function randomInt(min: number, max: number): number;
  export function createHash(alg: string): { update(d: string | Uint8Array): any; digest(enc?: string): any };
  export function createHmac(alg: string, key: string | Uint8Array): { update(d: string | Uint8Array): any; digest(enc?: string): any };
  export function scryptSync(password: string | Uint8Array, salt: string | Uint8Array, keylen: number, options?: { N?: number; r?: number; p?: number; maxmem?: number }): Buffer;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
    setReadBigInts?(flag: boolean): void;
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    open(): void;
    isOpen: boolean;
  }
}

declare module 'node:zlib' {
  export function deflateRawSync(data: string | Uint8Array, options?: { level?: number }): Buffer;
  export function inflateRawSync(data: Uint8Array): Buffer;
  export function gzipSync(data: string | Uint8Array): Buffer;
  export function crc32(data: string | Uint8Array, value?: number): number;
}

declare module 'node:net' {
  export interface Socket {
    write(data: string | Uint8Array, cb?: () => void): boolean;
    end(data?: string): void;
    destroy(): void;
    setEncoding(enc: string): void;
    setTimeout(ms: number, cb?: () => void): void;
    on(event: 'data', cb: (chunk: any) => void): this;
    on(event: string, cb: (...args: any[]) => void): this;
    once(event: string, cb: (...args: any[]) => void): this;
    removeListener(event: string, cb: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
  }
  export function connect(options: { host: string; port: number }, cb?: () => void): Socket;
}

declare module 'node:tls' {
  import type { Socket } from 'node:net';
  export function connect(options: { host: string; port?: number; socket?: Socket; servername?: string; rejectUnauthorized?: boolean }, cb?: () => void): Socket;
}

declare module 'node:os' {
  export function hostname(): string;
  export function tmpdir(): string;
  export function homedir(): string;
}

declare module 'node:child_process' {
  export function execSync(cmd: string, options?: any): Buffer | string;
  export function spawn(cmd: string, args?: string[], options?: any): any;
}

declare module 'node:test' {
  type TestFn = (t: any) => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function test(name: string, options: any, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
  export function before(fn: TestFn): void;
  export function after(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
  export default test;
}

declare module 'node:assert/strict' {
  function assert(value: unknown, message?: string): asserts value;
  namespace assert {
    function equal(actual: unknown, expected: unknown, message?: string): void;
    function notEqual(actual: unknown, expected: unknown, message?: string): void;
    function deepEqual(actual: unknown, expected: unknown, message?: string): void;
    function ok(value: unknown, message?: string): asserts value;
    function match(value: string, re: RegExp, message?: string): void;
    function doesNotMatch(value: string, re: RegExp, message?: string): void;
    function throws(fn: () => unknown, expected?: any, message?: string): void;
    function rejects(p: Promise<unknown> | (() => Promise<unknown>), expected?: any, message?: string): Promise<void>;
    function fail(message?: string): never;
  }
  export = assert;
}

declare module 'node:module' {
  export function createRequire(path: string | URL): (id: string) => any;
}

interface ImportMeta { url: string; dirname: string; filename: string }
