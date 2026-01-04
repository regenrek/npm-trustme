import {
  confirm,
  intro,
  outro,
  multiselect,
  select,
  text,
  spinner,
  note,
  isCancel
} from '@clack/prompts'
import type { WizardTargetInput, WizardWorkflowOptions } from './types.js'

export function installIntro(): void {
  intro('npm-trustme install')
}

export function installOutro(message: string): void {
  outro(message)
}

export async function promptWorkflowSetupChoice(): Promise<'yes' | 'preview' | 'skip' | null> {
  const choice = await select({
    message: 'Do you want to set up npm-release.yml?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'preview', label: 'Preview template' },
      { value: 'skip', label: 'Skip' }
    ]
  })
  if (isCancel(choice)) return null
  return choice as 'yes' | 'preview' | 'skip'
}

export async function promptWorkflowCustomize(defaults: WizardWorkflowOptions): Promise<WizardWorkflowOptions | null> {
  const wants = await confirm({
    message: 'Customize workflow options?',
    initialValue: false
  })
  if (isCancel(wants)) return null
  if (!wants) return defaults
  return promptWorkflowDetails(defaults)
}

export async function promptWorkflowDetails(current: WizardWorkflowOptions): Promise<WizardWorkflowOptions | null> {
  const fileName = await text({
    message: 'Workflow filename',
    initialValue: current.fileName,
    validate: (value) => (!value ? 'Workflow filename cannot be empty.' : undefined)
  })
  if (isCancel(fileName)) return null

  const nodeVersion = await text({
    message: 'Node version',
    initialValue: current.nodeVersion,
    validate: (value) => (!value ? 'Node version cannot be empty.' : undefined)
  })
  if (isCancel(nodeVersion)) return null

  const packageManager = await select({
    message: 'Package manager',
    options: [
      { value: 'pnpm', label: 'pnpm' },
      { value: 'npm', label: 'npm' }
    ],
    initialValue: current.packageManager
  })
  if (isCancel(packageManager)) return null

  const trigger = await select({
    message: 'Workflow trigger',
    options: [
      { value: 'release', label: 'Release published' },
      { value: 'tag', label: 'Git tag' }
    ],
    initialValue: current.trigger
  })
  if (isCancel(trigger)) return null

  let tagPattern = current.tagPattern
  if (trigger === 'tag') {
    const tag = await text({
      message: 'Tag pattern',
      initialValue: current.tagPattern,
      validate: (value) => (!value ? 'Tag pattern cannot be empty.' : undefined)
    })
    if (isCancel(tag)) return null
    tagPattern = String(tag)
  }

  const workflowDispatch = await confirm({
    message: 'Enable workflow_dispatch?',
    initialValue: current.workflowDispatch
  })
  if (isCancel(workflowDispatch)) return null

  const buildCommand = await text({
    message: 'Build command (leave empty to skip)',
    initialValue: current.buildCommand ?? ''
  })
  if (isCancel(buildCommand)) return null

  const publishCommand = await text({
    message: 'Publish command',
    initialValue: current.publishCommand,
    validate: (value) => (!value ? 'Publish command cannot be empty.' : undefined)
  })
  if (isCancel(publishCommand)) return null

  return {
    ...current,
    enabled: true,
    fileName: String(fileName),
    nodeVersion: String(nodeVersion),
    packageManager: packageManager as WizardWorkflowOptions['packageManager'],
    trigger: trigger as WizardWorkflowOptions['trigger'],
    tagPattern,
    workflowDispatch: Boolean(workflowDispatch),
    buildCommand: String(buildCommand).trim() ? String(buildCommand) : undefined,
    publishCommand: String(publishCommand)
  }
}

export async function promptWorkflowWriteChoice(): Promise<'write' | 'edit' | 'skip' | null> {
  const choice = await select({
    message: 'Apply workflow template?',
    options: [
      { value: 'write', label: 'Write file' },
      { value: 'edit', label: 'Edit options' },
      { value: 'skip', label: 'Skip' }
    ]
  })
  if (isCancel(choice)) return null
  return choice as 'write' | 'edit' | 'skip'
}

export function showPreview(contents: string, title = 'Preview'): void {
  note(contents, title)
}

export async function promptPackageSelection(
  choices: Array<{ label: string; value: string; hint?: string }>
): Promise<string[] | null> {
  const selections = await multiselect({
    message: 'Select packages to configure',
    options: choices,
    required: true
  })
  if (isCancel(selections)) return null
  return selections as string[]
}

export async function promptTargetInputs(
  initial: WizardTargetInput
): Promise<WizardTargetInput | null> {
  const owner = await text({
    message: `GitHub owner for ${initial.packageName}`,
    initialValue: initial.owner,
    validate: (value) => (!value ? 'Owner is required.' : undefined)
  })
  if (isCancel(owner)) return null
  const repo = await text({
    message: 'GitHub repo',
    initialValue: initial.repo,
    validate: (value) => (!value ? 'Repo is required.' : undefined)
  })
  if (isCancel(repo)) return null
  const workflow = await text({
    message: 'Workflow filename',
    initialValue: initial.workflow,
    validate: (value) => (!value ? 'Workflow is required.' : undefined)
  })
  if (isCancel(workflow)) return null
  const environment = await text({
    message: 'GitHub environment',
    initialValue: initial.environment,
    validate: (value) => (!value ? 'Environment is required.' : undefined)
  })
  if (isCancel(environment)) return null
  const access = await select({
    message: 'Publishing access',
    options: [
      { value: 'disallow-tokens', label: 'Disallow tokens (recommended)' },
      { value: 'allow-bypass-token', label: 'Allow granular tokens' },
      { value: 'skip', label: 'Skip access settings' }
    ],
    initialValue: initial.publishingAccess
  })
  if (isCancel(access)) return null

  return {
    ...initial,
    owner: String(owner),
    repo: String(repo),
    workflow: String(workflow),
    environment: String(environment),
    publishingAccess: access as WizardTargetInput['publishingAccess']
  }
}

export async function promptSummaryAction(summary: string): Promise<'proceed' | 'edit' | 'cancel' | null> {
  const choice = await select({
    message: `All data correct?\n${summary}`,
    options: [
      { value: 'proceed', label: 'Proceed' },
      { value: 'edit', label: 'Edit selections' },
      { value: 'cancel', label: 'Cancel' }
    ]
  })
  if (isCancel(choice)) return null
  return choice as 'proceed' | 'edit' | 'cancel'
}

export async function promptEditTarget(targets: WizardTargetInput[]): Promise<string | null> {
  const choice = await select({
    message: 'Select a package to edit',
    options: targets.map(t => ({ value: t.packageName, label: t.packageName }))
  })
  if (isCancel(choice)) return null
  return String(choice)
}

export async function promptRunCheck(): Promise<boolean | null> {
  const wants = await confirm({
    message: 'Run a check before ensuring?',
    initialValue: true
  })
  if (isCancel(wants)) return null
  return Boolean(wants)
}

export async function promptRunRecheck(): Promise<boolean | null> {
  const wants = await confirm({
    message: 'Recheck after ensure?',
    initialValue: true
  })
  if (isCancel(wants)) return null
  return Boolean(wants)
}

export async function promptProceedEnsure(): Promise<boolean | null> {
  const wants = await confirm({
    message: 'Proceed with ensure?',
    initialValue: true
  })
  if (isCancel(wants)) return null
  return Boolean(wants)
}

export async function promptOverwriteExisting(path: string): Promise<boolean | null> {
  const wants = await confirm({
    message: `Workflow already exists at ${path}. Overwrite?`,
    initialValue: false
  })
  if (isCancel(wants)) return null
  return Boolean(wants)
}

export async function promptApplyToRemaining(count: number): Promise<boolean | null> {
  const wants = await confirm({
    message: `Apply these settings to the remaining ${count} package(s)?`,
    initialValue: true
  })
  if (isCancel(wants)) return null
  return Boolean(wants)
}

export function startSpinner(message: string) {
  const spin = spinner()
  spin.start(message)
  return spin
}
