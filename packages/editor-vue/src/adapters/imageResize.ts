export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface ResizeInput {
  readonly width: number
  readonly height: number
  readonly dx: number
  readonly dy: number
  readonly handle: ResizeHandle
  readonly lockAspectRatio: boolean
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function resizedImageDimensions(input: ResizeInput): { width: number; height: number } {
  const { width, height, dx, dy, handle, lockAspectRatio } = input
  const horizontal = handle.includes('e') || handle.includes('w')
  const vertical = handle.includes('n') || handle.includes('s')
  const nextWidth = width + (handle.includes('w') ? -dx : horizontal ? dx : 0)
  const nextHeight = height + (handle.includes('n') ? -dy : vertical ? dy : 0)
  if (!lockAspectRatio) return { width: Math.round(clamp(nextWidth, 16, 4096)), height: Math.round(clamp(nextHeight, 16, 4096)) }
  const scaleX = nextWidth / width
  const scaleY = nextHeight / height
  const requested = !horizontal ? scaleY : !vertical ? scaleX : Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
  const scale = clamp(requested, Math.max(16 / width, 16 / height), Math.min(4096 / width, 4096 / height))
  return { width: Math.round(clamp(width * scale, 16, 4096)), height: Math.round(clamp(height * scale, 16, 4096)) }
}
