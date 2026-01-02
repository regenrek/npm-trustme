import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CredentialOptions } from '../src/core/credentials/types.js'
import { directProvider } from '../src/core/credentials/providers/direct.js'
import { onePasswordProvider } from '../src/core/credentials/providers/onepassword.js'
import { bitwardenProvider } from '../src/core/credentials/providers/bitwarden.js'
import { lastPassProvider } from '../src/core/credentials/providers/lastpass.js'
import { keepassxcProvider } from '../src/core/credentials/providers/keepassxc.js'
import { resolveCredentials } from '../src/core/credentials/index.js'
import { createLogger } from '../src/core/logger.js'

const execFileMock = vi.hoisted(() => {
  const fn = vi.fn()
  ;(fn as any)[Symbol.for('nodejs.util.promisify.custom')] = (...args: any[]) =>
    new Promise((resolve, reject) => {
      fn(...args, (err: Error | null, stdout?: string, stderr?: string) => {
        if (err) return reject(err)
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
  return fn
})

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: vi.fn()
}))

function setExecFileResponse(handler: (cmd: string, args: string[]) => { stdout?: string; stderr?: string }) {
  execFileMock.mockImplementation((cmd: string, args: string[], _opts: any, cb: any) => {
    const result = handler(cmd, args)
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    cb(null, stdout, stderr)
  })
}

describe('credential providers', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('direct provider returns supplied creds', async () => {
    const provider = directProvider()
    const result = await provider.resolve({ username: 'u', password: 'p', otp: '123' }, {}, createLogger(false))
    expect(result).toEqual({ username: 'u', password: 'p', otp: '123' })
  })

  it('onepassword provider reads op refs', async () => {
    setExecFileResponse((_cmd, args) => {
      const ref = args[1]
      if (ref.endsWith('/username')) return { stdout: 'user\n' }
      if (ref.endsWith('/password')) return { stdout: 'pass\n' }
      if (ref.endsWith('/one-time password')) return { stdout: '654321\n' }
      return { stdout: '' }
    })

    const provider = onePasswordProvider()
    const result = await provider.resolve({ opVault: 'Vault', opItem: 'Item' }, {}, createLogger(false))
    expect(result).toEqual({ username: 'user', password: 'pass', otp: '654321' })
  })

  it('bitwarden provider reads item + totp', async () => {
    setExecFileResponse((cmd, args) => {
      if (cmd === 'bw' && args[0] === 'get' && args[1] === 'item') {
        return { stdout: JSON.stringify({ login: { username: 'bw-user', password: 'bw-pass' } }) }
      }
      if (cmd === 'bw' && args[0] === 'get' && args[1] === 'totp') {
        return { stdout: '112233\n' }
      }
      return { stdout: '' }
    })

    const provider = bitwardenProvider()
    const result = await provider.resolve({ bwItem: 'item-1' }, {}, createLogger(false))
    expect(result).toEqual({ username: 'bw-user', password: 'bw-pass', otp: '112233' })
  })

  it('lastpass provider reads item + otp field', async () => {
    setExecFileResponse((cmd, args) => {
      if (cmd === 'lpass' && args.includes('--json')) {
        return { stdout: JSON.stringify([{ username: 'lp-user', password: 'lp-pass' }]) }
      }
      if (cmd === 'lpass' && args.find(arg => arg.startsWith('--field='))) {
        return { stdout: '445566\n' }
      }
      return { stdout: '' }
    })

    const provider = lastPassProvider()
    const result = await provider.resolve({ lpassItem: 'npm', lpassOtpField: 'totp' }, {}, createLogger(false))
    expect(result).toEqual({ username: 'lp-user', password: 'lp-pass', otp: '445566' })
  })

  it('keepassxc provider reads entry', async () => {
    setExecFileResponse((cmd, args) => {
      if (cmd === 'keepassxc-cli' && args[0] === '--help') {
        return { stdout: '--pw-stdin\n--key-file\n' }
      }
      if (cmd === 'keepassxc-cli' && args[0] === 'show') {
        return { stdout: 'kp-user\nkp-pass\n778899\n' }
      }
      return { stdout: '' }
    })

    const provider = keepassxcProvider()
    const result = await provider.resolve({ kpxDb: '/tmp/db.kdbx', kpxEntry: 'npm' }, {}, createLogger(false))
    expect(result).toEqual({ username: 'kp-user', password: 'kp-pass', otp: '778899' })
  })

  it('resolveCredentials merges providers', async () => {
    setExecFileResponse((cmd, args) => {
      if (cmd === 'op' && args[0] === 'read' && args[1].includes('/password')) return { stdout: 'from-op\n' }
      return { stdout: '' }
    })

    const options: CredentialOptions = {
      username: 'direct-user',
      opVault: 'Vault',
      opItem: 'Item'
    }
    const resolved = await resolveCredentials(options, false, createLogger(false))
    expect(resolved).not.toBeNull()
    if (!resolved) throw new Error('Expected credentials to resolve')
    expect(resolved.username).toBe('direct-user')
    expect(resolved.password).toBe('from-op')
  })
})
