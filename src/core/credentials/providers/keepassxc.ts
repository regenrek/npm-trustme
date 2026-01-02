import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

const execFileAsync = promisify(execFile)

export function keepassxcProvider(): CredentialProvider {
  return {
    name: 'keepassxc',
    async resolve(options: CredentialOptions, current: PartialCredentials, logger: Logger) {
      if (!options.kpxDb || !options.kpxEntry) return {}

      const wantsOtp = !current.otp
      const lines = await readEntry(options, logger, wantsOtp)
      if (lines.length === 0) return {}

      const resolved: PartialCredentials = {}
      if (!current.username && lines[0]) resolved.username = lines[0]
      if (!current.password && lines[1]) resolved.password = lines[1]
      if (wantsOtp && lines[2]) resolved.otp = lines[2]

      return resolved
    }
  }
}

async function readEntry(
  options: CredentialOptions,
  logger: Logger,
  includeOtp: boolean
): Promise<string[]> {
  const args = ['show', options.kpxDb as string, options.kpxEntry as string, '--show-protected', '--attributes', 'username', '--attributes', 'password']
  if (includeOtp) args.push('--totp')

  const supportsPwStdin = await supportsFlag('--pw-stdin')
  const supportsKeyfile = await supportsFlag('--key-file')

  if (options.kpxKeyfile && supportsKeyfile) {
    args.push('--key-file', options.kpxKeyfile)
  }

  const usePwStdin = Boolean(options.kpxPassword && (options.kpxPwStdin || supportsPwStdin))
  if (usePwStdin && supportsPwStdin) {
    args.push('--pw-stdin')
  } else if (options.kpxPassword && !supportsPwStdin) {
    logger.warn('keepassxc-cli does not support --pw-stdin; password will be prompted interactively.')
  }

  const output = usePwStdin
    ? await runWithStdin('keepassxc-cli', args, `${options.kpxPassword}\n`)
    : await execFileAsync('keepassxc-cli', args, { env: process.env, windowsHide: true }).then(res => res.stdout)

  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

async function supportsFlag(flag: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync('keepassxc-cli', ['--help'], { env: process.env, windowsHide: true })
    const text = `${stdout}\n${stderr}`
    return text.includes(flag)
  } catch {
    return false
  }
}

function runWithStdin(cmd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `keepassxc-cli exited with code ${code}`))
      }
    })
    child.stdin.write(input)
    child.stdin.end()
  })
}
