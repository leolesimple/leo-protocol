import net from "net"
import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"
import { createX25519KeyPair, computeSharedSecret, deriveSessionKeys } from "../crypto.ts"
import { encryptAesGcm, decryptAesGcm } from "../cipher.ts"
import {
  AuthCommand,
  Bye,
  ClientHello,
  Del,
  DelResult,
  GetBegin,
  GetChunk,
  GetEnd,
  GetMeta,
  Info,
  InfoResult,
  LeoMessage,
  List,
  ListResult,
  NodeBuffer,
  PutAck,
  encodeFrame,
  encodeJsonLine,
  consumeFrames
} from "../protocol.ts"

export class LeoProtocolError extends Error {
  constructor(public code: string, message: string, public details?: string) {
    super(message)
    this.name = "LeoProtocolError"
  }
}

export class LeoClient {
  private socket: net.Socket | null = null
  private frameBuffer: NodeBuffer = Buffer.alloc(0)
  private handshakeBuffer = ""
  private clientKeyPair = createX25519KeyPair()
  private clientToServerKey: Buffer | null = null
  private serverToClientKey: Buffer | null = null
  private messageQueue: LeoMessage[] = []
  private waiters: Array<{ resolve: (msg: LeoMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }> = []
  private closed = false
  private defaultTimeoutMs = Number(process.env.LEO_TIMEOUT_MS ?? "15000")

  async connect(host: string, port: number): Promise<void> {
    this.socket = net.createConnection({ host, port })
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) return reject(new Error("Socket not created"))
      this.socket.once("error", reject)
      this.socket.once("connect", () => resolve())
    })
    const hello: ClientHello = {
      type: "CLIENT_HELLO",
      version: 1,
      cipher: "AES-256-GCM",
      kex: "X25519",
      clientPublicKey: this.clientKeyPair.publicKey.toString("base64")
    }
    this.socket.write(encodeJsonLine(hello))
    const serverHelloLine = await this.readHandshakeLine()
    const serverHello = JSON.parse(serverHelloLine) as { serverPublicKey: string; sessionId: string }
    const sharedSecret = computeSharedSecret(this.clientKeyPair.privateKey, Buffer.from(serverHello.serverPublicKey, "base64"))
    const { clientToServerKey, serverToClientKey } = deriveSessionKeys(sharedSecret, serverHello.sessionId)
    this.clientToServerKey = clientToServerKey
    this.serverToClientKey = serverToClientKey
    this.socket.on("data", chunk => this.onData(chunk))
    this.socket.on("close", () => this.onSocketClosed(new Error("Socket fermée")))
    this.socket.on("error", err => this.onSocketClosed(err instanceof Error ? err : new Error(String(err))))
  }

  private readHandshakeLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout handshake")), this.defaultTimeoutMs)
      const handler = (chunk: Buffer) => {
        this.handshakeBuffer += chunk.toString("utf8")
        const index = this.handshakeBuffer.indexOf("\n")
        if (index !== -1) {
          const line = this.handshakeBuffer.slice(0, index)
          this.handshakeBuffer = this.handshakeBuffer.slice(index + 1)
          this.socket?.off("data", handler)
          clearTimeout(timer)
          resolve(line)
        }
      }
      this.socket?.on("data", handler)
    })
  }

  private onSocketClosed(err: Error) {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    this.waiters = []
  }

  private onData(chunk: Buffer) {
    if (!this.serverToClientKey) {
      this.handshakeBuffer += chunk.toString("utf8")
      return
    }
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk])
    const { frames, remaining } = consumeFrames(this.frameBuffer)
    this.frameBuffer = remaining
    for (const frame of frames) {
      const plaintext = decryptAesGcm(this.serverToClientKey, frame)
      const message = JSON.parse(plaintext.toString("utf8")) as LeoMessage
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift()
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.resolve(message)
        }
      } else this.messageQueue.push(message)
    }
  }

  private sendMessage(message: LeoMessage) {
    if (!this.socket || !this.clientToServerKey) throw new Error("Not connected")
    const payload = Buffer.from(JSON.stringify(message))
    const encrypted = encryptAesGcm(this.clientToServerKey, payload)
    this.socket.write(encodeFrame(encrypted))
  }

  private async nextMessage(timeoutMs = this.defaultTimeoutMs): Promise<LeoMessage> {
    if (this.messageQueue.length > 0) return this.messageQueue.shift() as LeoMessage
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w.reject !== reject)
        reject(new Error("Timeout en attente de réponse"))
      }, timeoutMs)
      this.waiters.push({ resolve, reject, timer })
      if (this.closed) {
        clearTimeout(timer)
        reject(new Error("Socket fermée"))
      }
    })
  }

  private raiseIfError(message: LeoMessage): asserts message is LeoMessage {
    const type = (message as { type?: string }).type
    if (type === "ERROR") {
      const { errorCode, message: msg, details } = message as { errorCode: string; message: string; details?: string }
      throw new LeoProtocolError(errorCode, msg, details)
    }
    if (type === "AUTH_ERROR") {
      const payload = message as { error: string; errorCode: string; message?: string; details?: string }
      throw new LeoProtocolError(payload.errorCode, payload.message ?? payload.error, payload.details)
    }
  }

  async auth(username: string, password: string): Promise<void> {
    const message: AuthCommand = { type: "AUTH", username, password }
    this.sendMessage(message)
    const response = await this.nextMessage()
    this.raiseIfError(response)
    if ((response as any).type !== "AUTH_OK") throw new LeoProtocolError("AUTH_FAILED", "Réponse AUTH inattendue")
  }

  async put(localPath: string, remotePath: string): Promise<void> {
    const data = await readFile(localPath)
    this.sendMessage({ type: "PUT_BEGIN", path: remotePath, size: data.length } as LeoMessage)
    const chunkSize = 65536
    let offset = 0
    while (offset < data.length) {
      const end = Math.min(offset + chunkSize, data.length)
      const chunk = data.subarray(offset, end)
      this.sendMessage({ type: "PUT_CHUNK", path: remotePath, offset, data: chunk.toString("base64") } as LeoMessage)
      offset = end
    }
    this.sendMessage({ type: "PUT_END", path: remotePath } as LeoMessage)
    let response: LeoMessage
    do {
      response = await this.nextMessage()
      this.raiseIfError(response)
    } while ((response as PutAck).type !== "PUT_OK")
  }

  async get(remotePath: string, localPath: string): Promise<void> {
    const request: GetBegin = { type: "GET_BEGIN", path: remotePath }
    this.sendMessage(request as LeoMessage)
    const first = await this.nextMessage()
    this.raiseIfError(first)
    if ((first as GetMeta).type !== "GET_META") throw new LeoProtocolError("GET_META_MISSING", "GET_META non reçu")
    const expectedSize = (first as GetMeta).size
    let received = Buffer.alloc(0)
    while (true) {
      const msg = await this.nextMessage()
      this.raiseIfError(msg)
      if ((msg as GetEnd).type === "GET_END") break
      const chunk = msg as GetChunk
      const data = Buffer.from(chunk.data, "base64")
      const before = received
      received = Buffer.alloc(Math.max(received.length, chunk.offset + data.length))
      before.copy(received, 0)
      data.copy(received, chunk.offset)
    }
    if (expectedSize !== undefined && received.length !== expectedSize) {
      throw new LeoProtocolError("GET_INCOMPLETE", "Taille reçue différente de la taille attendue")
    }
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, received)
  }

  async list(remotePath: string): Promise<ListResult> {
    const req: List = { type: "LIST", path: remotePath }
    this.sendMessage(req as LeoMessage)
    const response = await this.nextMessage()
    this.raiseIfError(response)
    if ((response as ListResult).type !== "LIST_RESULT") throw new LeoProtocolError("LIST_FAILED", "Réponse LIST inattendue")
    return response as ListResult
  }

  async del(remotePath: string): Promise<void> {
    const req: Del = { type: "DEL", path: remotePath }
    this.sendMessage(req as LeoMessage)
    const response = await this.nextMessage()
    if ((response as DelResult).type === "DEL_OK") return
    if ((response as DelResult).type === "DEL_ERROR") {
      const err = response as DelResult
      throw new LeoProtocolError(err.errorCode, err.message)
    }
    this.raiseIfError(response)
    throw new LeoProtocolError("DEL_FAILED", "Réponse DEL inattendue")
  }

  async info(): Promise<InfoResult> {
    const req: Info = { type: "INFO" }
    this.sendMessage(req as LeoMessage)
    const response = await this.nextMessage()
    this.raiseIfError(response)
    if ((response as InfoResult).type !== "INFO_RESULT") throw new LeoProtocolError("INFO_FAILED", "Réponse INFO inattendue")
    return response as InfoResult
  }

  async bye(): Promise<void> {
    if (this.closed || !this.socket || !this.clientToServerKey) return
    const msg: Bye = { type: "BYE" }
    this.sendMessage(msg as LeoMessage)
    this.socket?.end()
  }
}

async function main() {
  const [,, command, ...args] = process.argv
  const host = process.env.LEO_HOST ?? "127.0.0.1"
  const port = Number(process.env.LEO_PORT ?? "9000")
  const username = process.env.LEO_USER ?? "user"
  const password = process.env.LEO_PASS ?? "pass"
  const client = new LeoClient()
  try {
    await client.connect(host, port)
    await client.auth(username, password)
    if (command === "put") {
      const [local, remote] = args
      await client.put(local, remote)
      console.log(`Upload terminé: ${remote}`)
    } else if (command === "get") {
      const [remote, local] = args
      await client.get(remote, local)
      console.log(`Download terminé: ${remote}`)
    } else if (command === "list") {
      const [remote] = args
      const res = await client.list(remote)
      process.stdout.write(JSON.stringify(res) + "\n")
    } else if (command === "del") {
      const [remote] = args
      await client.del(remote)
      console.log(`Suppression terminée: ${remote}`)
    } else if (command === "info") {
      const res = await client.info()
      process.stdout.write(JSON.stringify(res, null, 2) + "\n")
    } else {
      console.error("Commande inconnue. Utiliser put|get|list|del|info")
    }
  } catch (err) {
    if (err instanceof LeoProtocolError) {
      console.error(`Erreur (${err.code}): ${err.message}`)
      if (err.details) console.error(err.details)
    } else {
      console.error(err)
    }
  } finally {
    await client.bye().catch(() => {})
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
