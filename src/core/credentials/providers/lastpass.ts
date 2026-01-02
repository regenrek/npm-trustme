import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CredentialProvider, CredentialOptions, PartialCredentials } from '../types.js'
import type { Logger } from '../../logger.js'

const execFileAsync = promisify(execFile)

export function lastPassProvider(): CredentialProvider {
  return {
    name: 'lastpass',
    async resolve(options: CredentialOptions, current: PartialCredentials, logger: Logger) {
      const item = options.lpassItem
      if (!item) return {}

      const resolved: PartialCredentials = {}
      const entry = await readItem(item)
      const username = entry?.username || entry?.login?.username
      const password = entry?.password || entry?.login?.password

      if (!current.username && username) resolved.username = String(username)
      if (!current.password && password) resolved.password = String(password)

      if (!current.otp && options.lpassOtpField) {
        const otp = await readField(item, options.lpassOtpField, logger)
        if (otp) resolved.otp = otp
      }

      return resolved
    }
  }
}

async function readItem(item: string) {
  const { stdout } = await execFileAsync('lpass', ['show', '--json', item], {
    env: process.env,
    windowsHide: true
  })
  try {
    const data = JSON.parse(stdout)
    if (Array.isArray(data)) return data[0]
    return data
  } catch (error) {
    throw new Error('LastPass CLI returned invalid JSON for item')
  }
}

async function readField(item: string, field: string, logger: Logger): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('lpass', ['show', `--field=${field}`, item], {
      env: process.env,
      windowsHide: true
    })
    const value = stdout.trim()
    return value || undefined
  } catch (error) {
    logger.debug('LastPass CLI did not return a field value.')
    return undefined
  }
}
