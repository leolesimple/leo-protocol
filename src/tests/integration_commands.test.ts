import { afterEach, beforeEach, describe, expect, it } from "vitest"
import net from "net"
import path from "path"
import { mkdtemp, rm, stat, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { startServer } from "../server/server.ts"
import { LeoClient, LeoProtocolError } from "../client/client.ts"

let server: net.Server | null = null
let port = 0
let dir = ""
let localDir = ""

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leo-"))
  localDir = await mkdtemp(path.join(tmpdir(), "leo-local-"))
  server = await startServer({ host: "127.0.0.1", port: 0, storagePath: dir, credentials: { username: "user", password: "pass" } })
  const address = server.address() as net.AddressInfo
  port = address.port
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(localDir, { recursive: true, force: true })
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

describe("DEL and INFO", () => {
  it("deletes an uploaded file", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    const localPath = path.join(localDir, "file.txt")
    await writeFile(localPath, Buffer.from("hello"))
    await client.put(localPath, "remote/file.txt")
    await client.del("remote/file.txt")
    await expect(stat(path.join(dir, "remote/file.txt"))).rejects.toThrow()
    await client.bye()
  })

  it("returns an error when file does not exist", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    await expect(client.del("missing.txt")).rejects.toBeInstanceOf(LeoProtocolError)
    await client.bye()
  })

  it("rejects invalid traversal path", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    await expect(client.del("../evil.txt")).rejects.toBeInstanceOf(LeoProtocolError)
    await client.bye()
  })

  it("returns server info", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    const info = await client.info()
    expect(info.protocolVersion).toBe(1)
    expect(info.capabilities).toContain("DEL")
    await client.bye()
  })
})

describe("error handling", () => {
  it("returns structured error on missing GET", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    await expect(client.get("absent.txt", path.join(localDir, "local.txt"))).rejects.toBeInstanceOf(LeoProtocolError)
    await client.bye()
  })
})
