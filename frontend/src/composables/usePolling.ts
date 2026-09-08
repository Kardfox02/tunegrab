export interface PollingOptions {
  intervalMs?: number
  hiddenIntervalMs?: number
  // Выполнить задачу сразу при старте (по умолчанию — да).
  runOnStart?: boolean
}

export interface PollingController {
  start(): void
  stop(): void
  isActive(): boolean
}

export function createPolling(task: () => Promise<void>, options: PollingOptions = {}): PollingController {
  const intervalMs = options.intervalMs ?? 1500
  const hiddenIntervalMs = options.hiddenIntervalMs ?? 12000
  const runOnStart = options.runOnStart ?? true

  let timer: number | null = null
  let running = false
  let runningTask = false

  function currentIntervalMs(): number {
    return document.visibilityState === 'hidden' ? hiddenIntervalMs : intervalMs
  }

  function scheduleNext(): void {
    if (!running || timer !== null) {
      return
    }
    timer = window.setTimeout(() => {
      timer = null
      void runTask()
    }, currentIntervalMs())
  }

  function start(): void {
    if (running) {
      return
    }
    running = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (runOnStart) {
      void runTask()
    } else {
      scheduleNext()
    }
  }

  async function runTask(): Promise<void> {
    if (!running || runningTask) {
      return
    }
    runningTask = true
    try {
      await task()
    } finally {
      runningTask = false
      scheduleNext()
    }
  }

  function handleVisibilityChange(): void {
    if (!running) {
      return
    }
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (document.visibilityState === 'visible') {
      void runTask()
    } else {
      scheduleNext()
    }
  }

  return {
    start,
    stop() {
      if (!running) {
        return
      }
      running = false
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    },
    isActive() {
      return running
    },
  }
}
