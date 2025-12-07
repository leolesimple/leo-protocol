import net from "net"
import { randomBytes } from "crypto"
import { encryptAesGcm, decryptAesGcm } from "../cipher.ts"
import { createX25519KeyPair, computeSharedSecret, deriveSessionKeys } from "../crypto.ts"
import { AuthCommand, Bye, ClientHello, LeoMessage, ServerHello, encodeFrame, encodeJsonLine, consumeFrames, decodeJsonLine } from "../protocol.ts"
import { Storage } from "./storage.ts"

type Credentials = { username: string; password: string }

export class LeoSession {
  private handshakeBuffer = ""
  private frameBuffer = Buffer.alloc(0)
  private handshakeComplete = false
  private authed = false
  private clientToServerKey: Buffer | null = null
  private serverToClientKey: Buffer | null = null
  private sessionId = ""
  private serverKeyPair = createX25519KeyPair()
  private timeout: NodeJS.Timeout
  private ongoingUploads = new Map<string, { size: number; received: number }>()

  constructor(private socket: net.Socket, private storage: Storage, private credentials: Credentials) {
    this.timeout = setTimeout(() => this.socket.destroy(), 10000)
    this.socket.on("data", chunk => this.onData(chunk))
    this.socket.on("close", () => clearTimeout(this.timeout))
  }

  private onData(chunk: Buffer) {
    if (!this.handshakeComplete) {
      this.handshakeBuffer += chunk.toString("utf8")
      const index = this.handshakeBuffer.indexOf("\n")
      if (index !== -1) {
        const line = this.handshakeBuffer.slice(0, index)
        this.handshakeBuffer = this.handshakeBuffer.slice(index + 1)
        this.handleClientHello(line)
      }
    } else {
      this.frameBuffer = Buffer.concat([this.frameBuffer, chunk])
      const { frames, remaining } = consumeFrames(this.frameBuffer)
      this.frameBuffer = remaining
      for (const frame of frames) {
        this.handleEncryptedFrame(frame)
      }
    }
  }

  private handleClientHello(line: string) {
    let parsed: ClientHello
    try {
      parsed = decodeJsonLine(line) as ClientHello
    } catch {
      this.socket.destroy()
      return
    }
    if (parsed.type !== "CLIENT_HELLO" || parsed.version !== 1 || parsed.kex !== "X25519" || parsed.cipher !== "AES-256-GCM") {
      this.socket.destroy()
      return
    }
    const clientPublicKey = Buffer.from(parsed.clientPublicKey, "base64")
    this.sessionId = randomBytes(8).toString("hex")
    const sharedSecret = computeSharedSecret(this.serverKeyPair.privateKey, clientPublicKey)
    const { clientToServerKey, serverToClientKey } = deriveSessionKeys(sharedSecret, this.sessionId)
    this.clientToServerKey = clientToServerKey
    this.serverToClientKey = serverToClientKey
    const response: ServerHello = {
      type: "SERVER_HELLO",
      ok: true,
      version: 1,
      cipher: "AES-256-GCM",
      kex: "X25519",
      serverPublicKey: this.serverKeyPair.publicKey.toString("base64"),
      sessionId: this.sessionId
    }
    this.socket.write(encodeJsonLine(response))
    this.handshakeComplete = true
    clearTimeout(this.timeout)
  }

  private handleEncryptedFrame(frame: Buffer) {
    if (!this.clientToServerKey) {
      this.socket.destroy()
      return
    }
    let plaintext: Buffer
    try {
      plaintext = decryptAesGcm(this.clientToServerKey, frame)
    } catch {
      this.socket.destroy()
      return
    }
    let message: LeoMessage
    try {
      message = JSON.parse(plaintext.toString("utf8")) as LeoMessage
    } catch {
      this.socket.destroy()
      return
    }
    this.routeMessage(message)
  }

  private sendMessage(message: LeoMessage | ServerHello) {
    if (!this.serverToClientKey || !this.handshakeComplete) return
    const payload = Buffer.from(JSON.stringify(message))
    const encrypted = encryptAesGcm(this.serverToClientKey, payload)
    this.socket.write(encodeFrame(encrypted))
  }

  private ensureAuth(message: LeoMessage): boolean {
    if (this.authed) return true
    if ((message as AuthCommand).type === "AUTH") return true
    this.sendMessage({ type: "ERROR", error: "Unauthorized" })
    return false
  }

  private routeMessage(message: LeoMessage) {
    if (!this.ensureAuth(message)) return
    if ((message as any).type === "AUTH") this.handleAuth(message as any)
    else if ((message as any).type === "PUT_BEGIN") this.handlePutBegin(message as any)
    else if ((message as any).type === "PUT_CHUNK") this.handlePutChunk(message as any)
    else if ((message as any).type === "PUT_END") this.handlePutEnd(message as any)
    else if ((message as any).type === "GET_BEGIN") this.handleGetBegin(message as any)
    else if ((message as any).type === "LIST") this.handleList(message as any)
    else if ((message as any).type === "BYE") this.handleBye()
  }

  private handleAuth(message: { type: "AUTH"; username: string; password: string }) {
    if (message.username === this.credentials.username && message.password === this.credentials.password) {
      this.authed = true
      this.sendMessage({ type: "AUTH_OK" })
    } else {
      this.sendMessage({ type: "AUTH_ERROR", error: "Invalid credentials" })
    }
  }

  private handlePutBegin(message: { type: "PUT_BEGIN"; path: string; size: number }) {
    this.ongoingUploads.set(message.path, { size: message.size, received: 0 })
    this.storage.writeWholeFile(message.path, Buffer.alloc(0)).then(() => {})
  }

  private handlePutChunk(message: { type: "PUT_CHUNK"; path: string; offset: number; data: string }) {
    const state = this.ongoingUploads.get(message.path)
    if (!state) return
    const chunk = Buffer.from(message.data, "base64")
    state.received += chunk.length
    this.storage.writeChunk(message.path, chunk, message.offset).then(() => {})
  }

  private handlePutEnd(message: { type: "PUT_END"; path: string }) {
    if (this.ongoingUploads.has(message.path)) this.ongoingUploads.delete(message.path)
    this.sendMessage({ type: "PUT_OK", path: message.path })
  }

  private async handleGetBegin(message: { type: "GET_BEGIN"; path: string }) {
    try {
      const size = await this.storage.fileSize(message.path)
      this.sendMessage({ type: "GET_META", path: message.path, size })
      let offset = 0
      const chunkSize = 65536
      while (offset < size) {
        const chunk = await this.storage.readChunk(message.path, offset, chunkSize)
        this.sendMessage({ type: "GET_CHUNK", path: message.path, offset, data: chunk.toString("base64") })
        offset += chunk.length
      }
      this.sendMessage({ type: "GET_END", path: message.path })
    } catch {
      this.sendMessage({ type: "ERROR", error: "GET failed" })
    }
  }

  private async handleList(message: { type: "LIST"; path: string }) {
    try {
      const items = await this.storage.list(message.path)
      this.sendMessage({ type: "LIST_RESULT", path: message.path, items })
    } catch {
      this.sendMessage({ type: "ERROR", error: "LIST failed" })
    }
  }

  private handleBye() {
    this.socket.end()
  }
}
