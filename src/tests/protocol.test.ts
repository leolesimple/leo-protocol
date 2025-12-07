import { describe, expect, it } from "vitest"
import { encodeJsonLine, decodeJsonLine, encodeFrame, consumeFrames } from "../protocol.ts"

describe("protocol framing", () => {
  it("encodes and decodes json lines", () => {
    const payload = { type: "TEST", value: 1 }
    const line = encodeJsonLine(payload)
    const decoded = decodeJsonLine(line.toString("utf8").trim()) as { type: string; value: number }
    expect(decoded.type).toBe("TEST")
    expect(decoded.value).toBe(1)
  })

  it("splits frames", () => {
    const a = encodeFrame(Buffer.from([1, 2, 3]))
    const b = encodeFrame(Buffer.from([4, 5]))
    const combined = Buffer.concat([a, b])
    const { frames, remaining } = consumeFrames(combined)
    expect(remaining.length).toBe(0)
    expect(frames[0].equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(frames[1].equals(Buffer.from([4, 5]))).toBe(true)
  })
})
