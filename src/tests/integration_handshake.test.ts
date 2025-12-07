import { afterEach, beforeEach, describe, expect, it } from "vitest"
import net from "net"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { startServer } from "../server/server.ts"
import { LeoClient } from "../client/client.ts"

let server: net.Server | null = null
let port = 0
let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leo-"))
  server = await startServer({ host: "127.0.0.1", port: 0, storagePath: dir, credentials: { username: "user", password: "pass" } })
  const address = server.address() as net.AddressInfo
  port = address.port
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

describe("handshake and auth", () => {
  it("completes handshake and auth", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    const ok = await client.auth("user", "pass")
    expect(ok).toBe(true)
    await client.bye()
  })

  it("rejects invalid credentials", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    const ok = await client.auth("user", "wrong")
    expect(ok).toBe(false)
    await client.bye()
  })
})
