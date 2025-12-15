import { afterEach, beforeEach, describe, expect, it } from "vitest"
import net from "net"
import path from "path"
import { mkdtemp, rm, writeFile, readFile } from "fs/promises"
import { tmpdir } from "os"
import { startServer } from "../server/server.ts"
import { LeoClient } from "../client/client.ts"

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

describe("file transfer", () => {
  it("uploads, lists, downloads, and ends", async () => {
    const client = new LeoClient()
    await client.connect("127.0.0.1", port)
    await client.auth("user", "pass")
    const localPath = path.join(localDir, "file.txt")
    const content = Buffer.from("hello leo")
    await writeFile(localPath, content)
    await client.put(localPath, "remote/file.txt")
    const list = await client.list("remote")
    expect(list.items.some(i => i.name === "file.txt")).toBe(true)
    const downloadPath = path.join(localDir, "download.txt")
    await client.get("remote/file.txt", downloadPath)
    const downloaded = await readFile(downloadPath)
    expect(downloaded.equals(content)).toBe(true)
    await client.bye()
  })
})
