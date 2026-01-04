import type { PackageManager, WorkflowTrigger } from '../workflow/npmRelease.js'
import type { PublishingAccess } from '../npm/trustedPublisher.js'

export interface WizardWorkflowOptions {
  enabled: boolean
  fileName: string
  packageManager: PackageManager
  nodeVersion: string
  trigger: WorkflowTrigger
  tagPattern: string
  workflowDispatch: boolean
  buildCommand?: string
  publishCommand: string
}

export interface WizardPackageSelection {
  packagePath: string
  packageName: string
}

export interface WizardTargetInput {
  packageName: string
  packagePath: string
  owner: string
  repo: string
  workflow: string
  environment: string
  maintainer?: string
  publishingAccess: PublishingAccess
}

export interface WizardResult {
  workflow?: WizardWorkflowOptions
  targets: WizardTargetInput[]
}
