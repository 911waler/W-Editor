import { inflateSync } from 'node:zlib'

export interface DecodedPng {
  readonly data: Uint8Array
  readonly height: number
  readonly width: number
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

export function decodePng(bytes: Buffer): DecodedPng {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new TypeError('Expected PNG screenshot bytes.')
  }
  let bitDepth = 0
  let colorType = 0
  let height = 0
  let interlace = 0
  let width = 0
  const imageData: Buffer[] = []
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      interlace = data[12] ?? 0
    } else if (type === 'IDAT') {
      imageData.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new TypeError('Only non-interlaced 8-bit RGB/RGBA Playwright screenshots are supported.')
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(imageData))
  if (inflated.length !== height * (stride + 1)) throw new TypeError('PNG scanline length is inconsistent with IHDR.')
  const rgba = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (stride + 1)
    const filter = inflated[scanlineOffset] ?? 0
    const reconstructed = new Uint8Array(stride)
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[scanlineOffset + 1 + x] ?? 0
      const left = x >= channels ? reconstructed[x - channels] ?? 0 : 0
      const up = previous[x] ?? 0
      const upperLeft = x >= channels ? previous[x - channels] ?? 0 : 0
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft) : Number.NaN
      if (!Number.isFinite(predictor)) throw new TypeError(`Unsupported PNG scanline filter: ${filter}.`)
      reconstructed[x] = (encoded + predictor) & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      rgba[target] = reconstructed[source] ?? 0
      rgba[target + 1] = reconstructed[source + 1] ?? 0
      rgba[target + 2] = reconstructed[source + 2] ?? 0
      rgba[target + 3] = channels === 4 ? reconstructed[source + 3] ?? 0 : 255
    }
    previous = reconstructed
  }
  return Object.freeze({ data: rgba, height, width })
}

export function countPixelsNear(
  image: DecodedPng,
  color: Readonly<{ readonly blue: number; readonly green: number; readonly red: number }>,
  tolerance = 4,
): number {
  let count = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if ((image.data[offset + 3] ?? 0) === 0) continue
    if (Math.abs((image.data[offset] ?? 0) - color.red) <= tolerance
      && Math.abs((image.data[offset + 1] ?? 0) - color.green) <= tolerance
      && Math.abs((image.data[offset + 2] ?? 0) - color.blue) <= tolerance) count += 1
  }
  return count
}

export function countNonWhitePixelsAtRightEdge(image: DecodedPng, edgeWidth = 12): number {
  let count = 0
  const from = Math.max(0, image.width - edgeWidth)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = from; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const red = image.data[offset] ?? 255
      const green = image.data[offset + 1] ?? 255
      const blue = image.data[offset + 2] ?? 255
      if (red < 225 || green < 225 || blue < 225) count += 1
    }
  }
  return count
}
