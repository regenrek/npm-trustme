export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug'

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  success: (message: string) => void
  debug: (message: string) => void
}

export function createLogger(verbose = false): Logger {
  const prefix = (level: LogLevel) => {
    switch (level) {
      case 'warn': return '[!]' 
      case 'error': return '[x]'
      case 'success': return '[ok]'
      case 'debug': return '[..]'
      default: return '[i]'
    }
  }
  const log = (level: LogLevel, message: string) => {
    if (level === 'debug' && !verbose) return
    const tag = prefix(level)
    process.stdout.write(`${tag} ${message}\n`)
  }
  return {
    info: (msg) => log('info', msg),
    warn: (msg) => log('warn', msg),
    error: (msg) => log('error', msg),
    success: (msg) => log('success', msg),
    debug: (msg) => log('debug', msg)
  }
}
