import { concatBytes, latin1Decode } from './bytes';

type Waiter = { resolve: () => void; reject: (e: Error) => void };

/**
 * Buffers incoming socket chunks and hands them out as CRLF-terminated lines
 * or fixed-length byte runs (IMAP literals).
 */
export class ByteReader {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private waiter: Waiter | null = null;
  private error: Error | null = null;

  push(chunk: Uint8Array) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
    this.wake();
  }

  fail(err: Error) {
    this.error = err;
    const w = this.waiter;
    this.waiter = null;
    w?.reject(err);
  }

  /** Reads one line without its trailing CRLF (or bare LF). */
  async readLine(): Promise<string> {
    for (;;) {
      const idx = this.indexOfLF();
      if (idx >= 0) {
        const bytes = this.take(idx + 1);
        const end = bytes.length >= 2 && bytes[bytes.length - 2] === 13 ? bytes.length - 2 : bytes.length - 1;
        return latin1Decode(bytes.subarray(0, end));
      }
      await this.wait();
    }
  }

  async readBytes(n: number): Promise<Uint8Array> {
    while (this.length < n) await this.wait();
    return this.take(n);
  }

  private indexOfLF(): number {
    let base = 0;
    for (const c of this.chunks) {
      const i = c.indexOf(10);
      if (i >= 0) return base + i;
      base += c.length;
    }
    return -1;
  }

  private take(n: number): Uint8Array {
    const all = this.chunks.length === 1 ? this.chunks[0] : concatBytes(this.chunks);
    const head = all.slice(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    return head;
  }

  private wait(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  private wake() {
    const w = this.waiter;
    this.waiter = null;
    w?.resolve();
  }
}
