export type NodeBuffer = Buffer

export type ClientHello = {
  type: "CLIENT_HELLO"
  version: 1
  cipher: "AES-256-GCM"
  kex: "X25519"
  clientPublicKey: string
}

export type ServerHello = {
  type: "SERVER_HELLO"
  ok: boolean
  version: 1
  cipher: "AES-256-GCM"
  kex: "X25519"
  serverPublicKey: string
  sessionId: string
  error?: string
}

export type AuthCommand = { type: "AUTH"; username: string; password: string }
export type PutBegin = { type: "PUT_BEGIN"; path: string; size: number }
export type PutChunk = { type: "PUT_CHUNK"; path: string; offset: number; data: string }
export type PutEnd = { type: "PUT_END"; path: string }
export type GetBegin = { type: "GET_BEGIN"; path: string }
export type GetMeta = { type: "GET_META"; path: string; size: number }
export type GetChunk = { type: "GET_CHUNK"; path: string; offset: number; data: string }
export type GetEnd = { type: "GET_END"; path: string }
export type List = { type: "LIST"; path: string }
export type ListResult = { type: "LIST_RESULT"; path: string; items: Array<{ name: string; type: "file" | "dir"; size?: number }> }
export type Del = { type: "DEL"; path: string }
export type DelResult = { type: "DEL_OK"; path: string } | { type: "DEL_ERROR"; path: string; errorCode: string; message: string; error?: string }
export type Info = { type: "INFO" }
export type InfoResult = {
  type: "INFO_RESULT"
  version: string
  protocolVersion: number
  capabilities: string[]
  storageRoot?: string
  maxUploadSize?: number
}
export type Bye = { type: "BYE" }
export type AuthResult =
  | { type: "AUTH_OK" }
  | { type: "AUTH_ERROR"; error: string; errorCode: string; message?: string; details?: string }
export type PutAck = { type: "PUT_OK"; path: string }
export type ErrorMessage = { type: "ERROR"; error: string; errorCode: string; message: string; details?: string }

export type LeoMessage =
  | AuthCommand
  | PutBegin
  | PutChunk
  | PutEnd
  | GetBegin
  | GetMeta
  | GetChunk
  | GetEnd
  | List
  | ListResult
  | Del
  | DelResult
  | Info
  | InfoResult
  | Bye
  | AuthResult
  | PutAck
  | ErrorMessage

export function encodeJsonLine(value: unknown): NodeBuffer {
  return Buffer.from(JSON.stringify(value) + "\n")
}

export function decodeJsonLine(line: string): unknown {
  return JSON.parse(line)
}

export function encodeFrame(payload: NodeBuffer): NodeBuffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)
  return Buffer.concat([length, payload])
}

export function consumeFrames(buffer: NodeBuffer): { frames: NodeBuffer[]; remaining: NodeBuffer } {
  let offset = 0
  const frames: NodeBuffer[] = []
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.length - offset - 4 < length) break
    const start = offset + 4
    const end = start + length
    frames.push(buffer.subarray(start, end))
    offset = end
  }
  return { frames, remaining: buffer.subarray(offset) }
}
