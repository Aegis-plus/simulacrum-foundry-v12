/**
 * WebSocket side of the Foundry MCP server.
 *
 * Listens on 127.0.0.1 for the Simulacrum module running in the GM's browser.
 * The browser connects out to us (a web page cannot accept connections), proves
 * it knows the shared token, and then answers tool requests.
 *
 * Protocol (JSON text frames):
 *   browser -> server  {type:'hello', protocol, token, world, module}
 *   server  -> browser {type:'welcome', protocol, server} | {type:'rejected', reason}
 *   server  -> browser {type:'list_tools', id} | {type:'call_tool', id, name, arguments}
 *   browser -> server  {type:'response', id, ok, result | error}
 *   browser -> server  {type:'tools_changed'}
 */

import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

export const PROTOCOL_VERSION = 1;
const HELLO_TIMEOUT_MS = 10_000;

function sameToken(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export class FoundryBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.token - Shared secret the browser must present
   * @param {number} [options.port=47391]
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.requestTimeoutMs=120000]
   * @param {(msg: string) => void} [options.log]
   */
  constructor({ token, port = 47391, host = '127.0.0.1', requestTimeoutMs = 120_000, log }) {
    super();
    this.token = token;
    this.port = port;
    this.host = host;
    this.requestTimeoutMs = requestTimeoutMs;
    this.log = log ?? (() => {});
    this.socket = null;
    this.world = null;
    this.pending = new Map();
    this.nextId = 1;
    this.listenError = null;
    this.wss = null;
    this.retryTimer = null;
  }

  get connected() {
    return this.socket !== null;
  }

  /** Start listening. Retries every few seconds while the port is taken. */
  start() {
    return new Promise(resolve => {
      const attempt = () => {
        const wss = new WebSocketServer({
          host: this.host,
          port: this.port,
          maxPayload: 64 * 1024 * 1024,
        });
        wss.once('listening', () => {
          this.wss = wss;
          this.listenError = null;
          this.log(`Listening for Foundry on ws://${this.host}:${this.port}`);
          wss.on('connection', socket => this._onConnection(socket));
          resolve();
        });
        wss.once('error', error => {
          wss.close();
          this.listenError = error;
          if (error.code === 'EADDRINUSE') {
            this.log(`Port ${this.port} is in use (another Claude Code session?). Retrying in 5s.`);
          } else {
            this.log(
              `Cannot listen on ${this.host}:${this.port}: ${error.message}. Retrying in 5s.`
            );
          }
          this.retryTimer = setTimeout(attempt, 5000);
          this.retryTimer.unref?.();
          resolve();
        });
      };
      attempt();
    });
  }

  async stop() {
    clearTimeout(this.retryTimer);
    this._dropSocket('server shutting down');
    await new Promise(resolve => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = null;
  }

  /** Resolve once Foundry is connected, or false after timeoutMs. */
  waitForConnection(timeoutMs) {
    if (this.connected) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.off('connected', onConnected);
        resolve(false);
      }, timeoutMs);
      const onConnected = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.once('connected', onConnected);
    });
  }

  /** Ask the browser for its tool list (MCP tool definitions). */
  listTools() {
    return this._request({ type: 'list_tools' });
  }

  /** Run a tool in the browser. Resolves to {text, isError}. */
  callTool(name, args) {
    return this._request({ type: 'call_tool', name, arguments: args ?? {} });
  }

  status() {
    return {
      connected: this.connected,
      listening: this.wss !== null,
      address: `ws://${this.host}:${this.port}`,
      listenError: this.listenError?.message ?? null,
      world: this.world,
    };
  }

  _request(message) {
    if (!this.socket) return Promise.reject(new Error('Foundry is not connected'));
    const id = this.nextId++;
    const socket = this.socket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Foundry did not answer within ${Math.round(this.requestTimeoutMs / 1000)}s`)
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ ...message, id }));
    });
  }

  _onConnection(socket) {
    let authenticated = false;
    const helloTimer = setTimeout(() => socket.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS);

    socket.on('message', raw => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!authenticated) {
        clearTimeout(helloTimer);
        if (message?.type !== 'hello') {
          socket.close(4002, 'expected hello');
          return;
        }
        if (!this.token) {
          this._reject(socket, 'The MCP server has no FOUNDRY_MCP_TOKEN configured.');
          return;
        }
        if (!sameToken(message.token, this.token)) {
          this._reject(
            socket,
            'Token mismatch: the token in Foundry does not match FOUNDRY_MCP_TOKEN.'
          );
          return;
        }
        if (message.protocol !== PROTOCOL_VERSION) {
          this._reject(
            socket,
            `Protocol mismatch (Foundry ${message.protocol}, server ${PROTOCOL_VERSION}). Update both sides.`
          );
          return;
        }
        authenticated = true;
        this._adopt(socket, message);
        return;
      }

      if (message?.type === 'response') this._onResponse(message);
      else if (message?.type === 'tools_changed') this.emit('toolsChanged');
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (this.socket === socket) {
        this._dropSocket('Foundry disconnected');
        this.log('Foundry disconnected');
        this.emit('disconnected');
      }
    });
    socket.on('error', () => {});
  }

  _reject(socket, reason) {
    this.log(`Rejected a Foundry connection: ${reason}`);
    socket.send(JSON.stringify({ type: 'rejected', reason }));
    socket.close(4003, 'rejected');
  }

  _adopt(socket, hello) {
    if (this.socket) {
      this.log('A newer Foundry connection replaced the previous one');
      const previous = this.socket;
      this._dropSocket('replaced by a newer Foundry connection');
      previous.close(4004, 'replaced');
    }
    this.socket = socket;
    this.world = hello.world ?? null;
    socket.send(
      JSON.stringify({
        type: 'welcome',
        protocol: PROTOCOL_VERSION,
        server: 'simulacrum-foundry-mcp',
      })
    );
    const title = this.world?.title ? `"${this.world.title}"` : 'a world';
    this.log(`Foundry connected: ${title}`);
    this.emit('connected', this.world);
  }

  _onResponse(message) {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || 'Foundry reported an error'));
  }

  _dropSocket(reason) {
    this.socket = null;
    this.world = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
