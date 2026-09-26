import TcpSocket from 'react-native-tcp-socket';

import { ByteReader } from './reader';

export type Security = 'tls' | 'starttls';

export interface Transport {
  readonly reader: ByteReader;
  write(data: Uint8Array | string): Promise<void>;
  /** Upgrades a plain connection to TLS in place (STARTTLS). */
  startTls(): Promise<void>;
  close(): void;
}

type RNSocket = ReturnType<typeof TcpSocket.createConnection>;

const CONNECT_TIMEOUT_MS = 20000;

class TcpTransport implements Transport {
  readonly reader = new ByteReader();
  private socket!: RNSocket;

  attach(socket: RNSocket) {
    this.socket = socket;
    socket.on('data', (d) => this.reader.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)));
    socket.on('error', (e) => this.reader.fail(e instanceof Error ? e : new Error(String(e))));
    socket.on('close', () => this.reader.fail(new Error('接続が切断されました')));
  }

  write(data: Uint8Array | string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, undefined, (err) => (err ? reject(err) : resolve()));
    });
  }

  async startTls(): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners();
    // TLSSocket emits no event when the handshake finishes on an upgraded
    // socket; writes are queued natively until the session is ready, and a
    // handshake failure surfaces through the reader as a socket error.
    this.attach(new TcpSocket.TLSSocket(plain, {}));
  }

  close() {
    this.socket?.destroy();
  }
}

export function connect(host: string, port: number, security: Security): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const t = new TcpTransport();
    const timer = setTimeout(() => {
      t.close();
      reject(new Error(`${host}:${port} への接続がタイムアウトしました`));
    }, CONNECT_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve(t);
    };
    const opts = { host, port, tlsCheckValidity: true };
    const socket = security === 'tls' ? TcpSocket.connectTLS(opts, done) : TcpSocket.createConnection(opts, done);
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    t.attach(socket);
  });
}
