import { describe, expect, it } from 'vitest'

import { pickVibrantColor } from '../cover-color.service'

function solidPixels(r: number, g: number, b: number, size = 8): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = r
    pixels[index + 1] = g
    pixels[index + 2] = b
    pixels[index + 3] = 255
  }
  return pixels
}

describe('pickVibrantColor', () => {
  it('returns a saturated variant of the dominant color', () => {
    // Тёмно-приглушённый синий: доминирует, но бледный — должен стать насыщеннее.
    const color = pickVibrantColor(solidPixels(40, 55, 90))

    expect(color).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
    const [, saturation, lightness] = (color as string).match(/^hsl\(\d+ (\d+)% (\d+)%\)$/u) as string[]
    expect(Number(saturation)).toBeGreaterThanOrEqual(45)
    expect(Number(lightness)).toBeGreaterThanOrEqual(50)
    expect(Number(lightness)).toBeLessThanOrEqual(72)
  })

  it('keeps the hue of the source color', () => {
    const red = pickVibrantColor(solidPixels(180, 30, 30))
    const green = pickVibrantColor(solidPixels(30, 150, 40))

    expect(red).toMatch(/^hsl\(0?\.?\d* /u)
    expect(Number(red?.match(/^hsl\((\d+)/u)?.[1])).toBeLessThan(30)
    expect(Number(green?.match(/^hsl\((\d+)/u)?.[1])).toBeGreaterThan(90)
    expect(Number(green?.match(/^hsl\((\d+)/u)?.[1])).toBeLessThan(180)
  })

  it('ignores near-black and near-white outliers', () => {
    // 3/4 пикселей почти чёрные (отбрасываются), 1/4 — насыщенный оранжевый.
    const size = 8
    const pixels = new Uint8ClampedArray(size * size * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      const pixelIndex = index / 4
      const isAccent = pixelIndex % 4 === 0
      pixels[index] = isAccent ? 220 : 8
      pixels[index + 1] = isAccent ? 120 : 8
      pixels[index + 2] = isAccent ? 30 : 10
      pixels[index + 3] = 255
    }

    const color = pickVibrantColor(pixels)
    expect(Number(color?.match(/^hsl\((\d+)/u)?.[1])).toBeGreaterThan(15)
    expect(Number(color?.match(/^hsl\((\d+)/u)?.[1])).toBeLessThan(60)
  })

  it('returns null for a fully transparent sample', () => {
    const size = 8
    const pixels = new Uint8ClampedArray(size * size * 4)
    for (let index = 3; index < pixels.length; index += 4) {
      pixels[index] = 0
    }

    expect(pickVibrantColor(pixels)).toBeNull()
  })
})
