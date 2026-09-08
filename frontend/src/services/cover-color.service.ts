const cache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

const SAMPLE_SIZE = 32

export function getCachedCoverColor(url: string): string | null {
  return cache.get(url) ?? null
}

export function getCoverAccentColor(url: string): Promise<string | null> {
  const cached = cache.get(url)
  if (cached) {
    return Promise.resolve(cached)
  }

  const inFlight = pending.get(url)
  if (inFlight) {
    return inFlight
  }

  const promise = extractColor(url)
    .then((color) => {
      if (color) {
        cache.set(url, color)
      }
      return color
    })
    .finally(() => {
      pending.delete(url)
    })

  pending.set(url, promise)
  return promise
}

/** Синхронно берёт цвет из кэша и запускает извлечение, если его там нет. */
export function resolveCoverColor(url: string | null, onReady?: (color: string | null) => void): string | null {
  if (!url) {
    return null
  }

  const cached = cache.get(url)
  if (cached) {
    return cached
  }

  void getCoverAccentColor(url).then((color) => {
    onReady?.(color)
  })
  return null
}

async function extractColor(url: string): Promise<string | null> {
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      return null
    }
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    return pickVibrantColor(data)
  } catch {
    // Обложка не загрузилась или canvas недоступен — останется дефолтный акцент.
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`cover load failed: ${url}`))
    image.src = url
  })
}

interface ColorBucket {
  count: number
  r: number
  g: number
  b: number
}

/**
 * Доминирующий «живой» цвет сэмпла: квантование до 4096 корзин, худшие
 * выбросы (прозрачные, почти чёрные/белые) отбрасываются, победившая корзина
 * усредняется и доводится до контрастной насыщенности/светлоты.
 */
export function pickVibrantColor(pixels: Uint8ClampedArray): string | null {
  const buckets = new Map<number, ColorBucket>()

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] as number
    if (alpha < 128) {
      continue
    }
    const r = pixels[index] as number
    const g = pixels[index + 1] as number
    const b = pixels[index + 2] as number
    const { l } = rgbToHsl(r, g, b)
    if (l < 0.1 || l > 0.94) {
      continue
    }

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }

  let best: ColorBucket | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket
    }
  }

  if (!best || best.count === 0) {
    return null
  }

  const r = best.r / best.count
  const g = best.g / best.count
  const b = best.b / best.count
  const { h, s, l } = rgbToHsl(r, g, b)
  const vibrantS = Math.min(1, Math.max(0.45, s))
  const vibrantL = Math.min(0.72, Math.max(0.5, l))
  return `hsl(${Math.round(h)} ${Math.round(vibrantS * 100)}% ${Math.round(vibrantL * 100)}%)`
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }

  return { h: h * 60, s, l }
}
