import net from "net"
import { randomBytes } from "crypto"
import {
  Del,
  DelResult,
  Info,
  LeoMessage,
  NodeBuffer,
  ServerHello,
  AuthCommand,
  encodeFrame,
  encodeJsonLine,
  consumeFrames,
  decodeJsonLine,
  Bye
} from "../protocol.ts"
import { encryptAesGcm, decryptAesGcm } from "../cipher.ts"
import { createX25519KeyPair, computeSharedSecret, deriveSessionKeys } from "../crypto.ts"
import { logError, logInfo, logWarn } from "./logger.ts"
import { Storage, StorageError } from "./storage.ts"

type Credentials = { username: string; password: string }
type ServerInfo = { version: string; protocolVersion: number; capabilities: string[]; storageRoot?: string; maxUploadSize?: number }

type SessionError = { errorCode: string; message: string; details?: string }

export class LeoSession {
  private handshakeBuffer = ""
  private frameBuffer: NodeBuffer = Buffer.alloc(0)
  private handshakeComplete = false
  private authed = false
  private clientToServerKey: Buffer | null = null
  private serverToClientKey: Buffer | null = null
  private sessionId = ""
  private serverKeyPair = createX25519KeyPair()
  private handshakeTimeout: NodeJS.Timeout
  private ongoingUploads = new Map<string, { size: number; received: number }>()
  private closed = false

  constructor(
    private socket: net.Socket,
    private storage: Storage,
    private credentials: Credentials,
    private info: ServerInfo
  ) {
    this.handshakeTimeout = setTimeout(() => {
      logWarn("session", "Handshake timeout, closing socket", this.sessionContext())
      this.socket.destroy(new Error("Handshake timeout"))
    }, 10000)

    this.socket.on("data", chunk => this.onData(chunk))
    this.socket.on("close", hadError => this.onClose(hadError))
    this.socket.on("error", err => logError("session", "Socket error", { ...this.sessionContext(), error: err.message }))
    logInfo("session", "Client connected", this.sessionContext())
  }

  private sessionContext() {
    const address = this.socket.remoteAddress ?? "unknown"
    return { sessionId: this.sessionId || "pending", remote: address }
  }

  private onClose(hadError: boolean) {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.handshakeTimeout)
    logInfo("session", "Client disconnected", { ...this.sessionContext(), hadError })
  }

  private onData(chunk: Buffer) {
    if (this.closed) return
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
    let parsed: unknown
    try {
      parsed = decodeJsonLine(line)
    } catch (err) {
      logWarn("handshake", "Invalid CLIENT_HELLO JSON", { error: err instanceof Error ? err.message : String(err) })
      this.socket.destroy()
      return
    }
    const msg = parsed as Partial<AuthCommand>
    if (
      typeof msg !== "object" ||
      (msg as { type?: string }).type !== "CLIENT_HELLO" ||
      (msg as { version?: number }).version !== 1 ||
      (msg as { kex?: string }).kex !== "X25519" ||
      (msg as { cipher?: string }).cipher !== "AES-256-GCM" ||
      typeof (msg as { clientPublicKey?: string }).clientPublicKey !== "string"
    ) {
      logWarn("handshake", "Invalid CLIENT_HELLO payload", {})
      this.socket.destroy()
      return
    }
    const clientPublicKey = Buffer.from((msg as { clientPublicKey: string }).clientPublicKey, "base64")
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
    clearTimeout(this.handshakeTimeout)
    logInfo("handshake", "Handshake completed", this.sessionContext())
  }

  private handleEncryptedFrame(frame: Buffer) {
    if (!this.clientToServerKey) {
      this.socket.destroy()
      return
    }
    let plaintext: Buffer
    try {
      plaintext = decryptAesGcm(this.clientToServerKey, frame)
    } catch (err) {
      logError("cipher", "Failed to decrypt frame", { ...this.sessionContext(), error: err instanceof Error ? err.message : String(err) })
      this.socket.destroy()
      return
    }
    let message: LeoMessage
    try {
      message = JSON.parse(plaintext.toString("utf8")) as LeoMessage
    } catch (err) {
      logWarn("protocol", "Invalid JSON message", { ...this.sessionContext(), error: err instanceof Error ? err.message : String(err) })
      this.sendError({ errorCode: "INVALID_MESSAGE", message: "Message illisible" })
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

  private sendError(err: SessionError) {
    const body = { type: "ERROR", error: err.message, errorCode: err.errorCode, message: err.message, details: err.details }
    this.sendMessage(body as LeoMessage)
    logWarn("protocol", "Sent protocol error", { ...this.sessionContext(), errorCode: err.errorCode, message: err.message })
  }

  private ensureAuth(message: LeoMessage): boolean {
    if (this.authed) return true
    if ((message as AuthCommand).type === "AUTH") return true
    this.sendError({ errorCode: "UNAUTHORIZED", message: "Authentification requise" })
    return false
  }

  private routeMessage(message: LeoMessage) {
    const type = (message as { type?: string }).type
    if (!type) {
      this.sendError({ errorCode: "INVALID_MESSAGE", message: "Type absent" })
      return
    }
    if (!this.ensureAuth(message)) return
    switch (type) {
      case "AUTH":
        this.handleAuth(message as AuthCommand)
        break
      case "PUT_BEGIN":
        this.handlePutBegin(message as any)
        break
      case "PUT_CHUNK":
        this.handlePutChunk(message as any)
        break
      case "PUT_END":
        this.handlePutEnd(message as any)
        break
      case "GET_BEGIN":
        this.handleGetBegin(message as any)
        break
      case "LIST":
        this.handleList(message as any)
        break
      case "DEL":
        this.handleDel(message as Del)
        break
      case "INFO":
        this.handleInfo(message as Info)
        break
      case "BYE":
        this.handleBye()
        break
      default:
        this.sendError({ errorCode: "INVALID_COMMAND", message: `Commande inconnue: ${type}` })
    }
  }

  private handleAuth(message: AuthCommand) {
    const ok = message.username === this.credentials.username && message.password === this.credentials.password
    if (ok) {
      this.authed = true
      logInfo("auth", "AUTH succeeded", this.sessionContext())
      this.sendMessage({ type: "AUTH_OK" })
    } else {
      logWarn("auth", "AUTH failed", { ...this.sessionContext(), username: message.username })
      this.sendMessage({ type: "AUTH_ERROR", error: "Invalid credentials", errorCode: "AUTH_INVALID_CREDENTIALS", message: "Identifiants invalides" })
    }
  }

  private handlePutBegin(message: { type: "PUT_BEGIN"; path: string; size: number }) {
    this.ongoingUploads.set(message.path, { size: message.size, received: 0 })
    this.storage
      .writeWholeFile(message.path, Buffer.alloc(0))
      .then(() => logInfo("put", "PUT_BEGIN", { ...this.sessionContext(), path: message.path, size: message.size }))
      .catch(err => {
        this.sendStorageError(err, `PUT_BEGIN échoué pour ${message.path}`)
      })
  }

  private handlePutChunk(message: { type: "PUT_CHUNK"; path: string; offset: number; data: string }) {
    const state = this.ongoingUploads.get(message.path)
    if (!state) {
      this.sendError({ errorCode: "UPLOAD_NOT_INITIALIZED", message: "PUT_BEGIN manquant" })
      return
    }
    const chunk = Buffer.from(message.data, "base64")
    state.received += chunk.length
    this.storage.writeChunk(message.path, chunk, message.offset).catch(err => this.sendStorageError(err, `PUT_CHUNK échoué pour ${message.path}`))
  }

  private handlePutEnd(message: { type: "PUT_END"; path: string }) {
    if (this.ongoingUploads.has(message.path)) this.ongoingUploads.delete(message.path)
    logInfo("put", "PUT_END", { ...this.sessionContext(), path: message.path })
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
      logInfo("get", "GET completed", { ...this.sessionContext(), path: message.path, size })
    } catch (err) {
      this.sendStorageError(err, `GET échoué pour ${message.path}`)
    }
  }

  private async handleList(message: { type: "LIST"; path: string }) {
    try {
      const items = await this.storage.list(message.path)
      this.sendMessage({ type: "LIST_RESULT", path: message.path, items })
      logInfo("list", "LIST processed", { ...this.sessionContext(), path: message.path, count: items.length })
    } catch (err) {
      this.sendStorageError(err, `LIST échoué pour ${message.path}`)
    }
  }

  private async handleDel(message: Del) {
    try {
      await this.storage.deleteFile(message.path)
      const result: DelResult = { type: "DEL_OK", path: message.path }
      this.sendMessage(result)
      logInfo("del", "DEL_OK", { ...this.sessionContext(), path: message.path })
    } catch (err) {
      const mapped = this.mapStorageError(err)
      const result: DelResult = {
        type: "DEL_ERROR",
        path: message.path,
        errorCode: mapped.errorCode,
        message: mapped.message,
        error: mapped.message
      }
      this.sendMessage(result as LeoMessage)
      logWarn("del", "DEL_ERROR", { ...this.sessionContext(), path: message.path, errorCode: mapped.errorCode, message: mapped.message })
    }
  }

  private handleInfo(_message: Info) {
    this.sendMessage({
      type: "INFO_RESULT",
      version: this.info.version,
      protocolVersion: this.info.protocolVersion,
      capabilities: this.info.capabilities,
      storageRoot: this.info.storageRoot,
      maxUploadSize: this.info.maxUploadSize
    } as LeoMessage)
  }

  private handleBye() {
    logInfo("session", "BYE received", this.sessionContext())
    this.socket.end()
  }

  private sendStorageError(err: unknown, contextMessage: string) {
    const mapped = this.mapStorageError(err)
    this.sendError(mapped)
    logWarn("storage", contextMessage, { ...this.sessionContext(), errorCode: mapped.errorCode, message: mapped.message })
  }

  private mapStorageError(err: unknown): SessionError {
    if (err instanceof StorageError) {
      switch (err.code) {
        case "INVALID_PATH":
          return { errorCode: "INVALID_PATH", message: err.message }
        case "FILE_NOT_FOUND":
          return { errorCode: "FILE_NOT_FOUND", message: err.message }
        case "PERMISSION_DENIED":
          return { errorCode: "PERMISSION_DENIED", message: err.message }
        case "NOT_A_FILE":
          return { errorCode: "NOT_A_FILE", message: err.message }
        default:
          return { errorCode: "IO_ERROR", message: err.message }
      }
    }
    return { errorCode: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Erreur interne" }
  }
}
