import net from "net"
import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"
import { createX25519KeyPair, computeSharedSecret, deriveSessionKeys } from "../crypto.ts"
import { encryptAesGcm, decryptAesGcm } from "../cipher.ts"
import { AuthCommand, Bye, ClientHello, GetBegin, GetChunk, GetEnd, GetMeta, LeoMessage, List, ListResult, NodeBuffer, PutAck, encodeFrame, encodeJsonLine, consumeFrames } from "../protocol.ts"

class LeoClient {
  private socket: net.Socket | null = null
  private frameBuffer: NodeBuffer = Buffer.alloc(0)
  private handshakeBuffer = ""
  private clientKeyPair = createX25519KeyPair()
  private clientToServerKey: Buffer | null = null
  private serverToClientKey: Buffer | null = null
  private messageQueue: LeoMessage[] = []
  private resolvers: Array<(msg: LeoMessage) => void> = []

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
  }

  private readHandshakeLine(): Promise<string> {
    return new Promise(resolve => {
      const handler = (chunk: Buffer) => {
        this.handshakeBuffer += chunk.toString("utf8")
        const index = this.handshakeBuffer.indexOf("\n")
        if (index !== -1) {
          const line = this.handshakeBuffer.slice(0, index)
          this.handshakeBuffer = this.handshakeBuffer.slice(index + 1)
          this.socket?.off("data", handler)
          resolve(line)
        }
      }
      this.socket?.on("data", handler)
    })
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
      if (this.resolvers.length > 0) this.resolvers.shift()?.(message)
      else this.messageQueue.push(message)
    }
  }

  private sendMessage(message: LeoMessage) {
    if (!this.socket || !this.clientToServerKey) throw new Error("Not connected")
    const payload = Buffer.from(JSON.stringify(message))
    const encrypted = encryptAesGcm(this.clientToServerKey, payload)
    this.socket.write(encodeFrame(encrypted))
  }

  private async nextMessage(): Promise<LeoMessage> {
    if (this.messageQueue.length > 0) return this.messageQueue.shift() as LeoMessage
    return new Promise(resolve => this.resolvers.push(resolve))
  }

  async auth(username: string, password: string): Promise<boolean> {
    const message: AuthCommand = { type: "AUTH", username, password }
    this.sendMessage(message)
    const response = await this.nextMessage()
    return (response as any).type === "AUTH_OK"
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
    } while ((response as PutAck).type !== "PUT_OK")
  }

  async get(remotePath: string, localPath: string): Promise<void> {
    const request: GetBegin = { type: "GET_BEGIN", path: remotePath }
    this.sendMessage(request as LeoMessage)
    await this.nextMessage()
    let received = Buffer.alloc(0)
    while (true) {
      const msg = await this.nextMessage()
      if ((msg as GetEnd).type === "GET_END") break
      const chunk = msg as GetChunk
      const data = Buffer.from(chunk.data, "base64")
      const before = received
      received = Buffer.alloc(Math.max(received.length, chunk.offset + data.length))
      before.copy(received, 0)
      data.copy(received, chunk.offset)
    }
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, received)
  }

  async list(remotePath: string): Promise<ListResult> {
    const req: List = { type: "LIST", path: remotePath }
    this.sendMessage(req as LeoMessage)
    const response = await this.nextMessage()
    return response as ListResult
  }

  async bye(): Promise<void> {
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
  await client.connect(host, port)
  const ok = await client.auth(username, password)
  if (!ok) throw new Error("AUTH failed")
  if (command === "put") {
    const [local, remote] = args
    await client.put(local, remote)
  } else if (command === "get") {
    const [remote, local] = args
    await client.get(remote, local)
  } else if (command === "list") {
    const [remote] = args
    const res = await client.list(remote)
    process.stdout.write(JSON.stringify(res) + "\n")
  }
  await client.bye()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { LeoClient }
