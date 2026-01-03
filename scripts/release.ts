import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildGitCommitArgs, buildGitTagArgs, runCommand, validateVersionBump } from './release-utils.js'

interface PackageTarget {
	name: string;
	dir: string;
	bump?: boolean;
}

const packageTargets: PackageTarget[] = [{ name: 'npm-trustme', dir: '.', bump: true }]

function ensureCleanWorkingTree() {
	const status = execFileSync('git', ['status', '--porcelain'], { cwd: '.' })
		.toString()
		.trim();
	if (status.length > 0) {
		throw new Error(
			"Working tree has uncommitted changes. Please commit or stash them before running the release script.",
		);
	}
}

/**
 * Bump version in package.json
 * @param pkgPath Path to the package directory
 * @param type Version bump type: 'major', 'minor', 'patch', or specific version
 * @returns The new version
 */
function bumpVersion(
	pkgPath: string,
	type: "major" | "minor" | "patch" | string,
): string {
	const pkgJsonPath = path.join(pkgPath, "package.json");
	const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
	const currentVersion = pkgJson.version;
	let newVersion: string;

	if (type === 'major' || type === 'minor' || type === 'patch') {
		// Parse current version
		const [major, minor, patch] = currentVersion.split(".").map(Number);

		// Bump version according to type
		if (type === 'major') {
			newVersion = `${major + 1}.0.0`;
		} else if (type === 'minor') {
			newVersion = `${major}.${minor + 1}.0`;
		} else {
			// patch
			newVersion = `${major}.${minor}.${patch + 1}`;
		}
	} else {
		// Use the provided version string directly
		newVersion = type;
	}

	// Update package.json
	pkgJson.version = newVersion;
	fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);

	console.log(
		`Bumped version from ${currentVersion} to ${newVersion} in ${pkgJsonPath}`,
	);
	return newVersion;
}

/**
 * Bump version in all package.json files
 * @param versionBump Version bump type or specific version
 * @returns The new version
 */
function bumpAllVersions(
	versionBump: "major" | "minor" | "patch" | string = "patch",
): string {
	const target = packageTargets[0];
	const pkgPath = path.resolve(target.dir);
	return bumpVersion(pkgPath, versionBump);
}

/**
 * Create a git commit and tag for the release
 * @param version The version to tag
 */
function createGitCommitAndTag(version: string) {
	console.log("Creating git commit and tag...");

	try {
		// Stage all changes
		runCommand('git', ['add', '.'], { cwd: '.' })

		// Create commit with version message
		runCommand('git', buildGitCommitArgs(version), { cwd: '.' })

		// Create tag
		runCommand('git', buildGitTagArgs(version), { cwd: '.' })

		// Push commit and tag to remote
		console.log("Pushing commit and tag to remote...");
		runCommand('git', ['push'], { cwd: '.' })
		runCommand('git', ['push', '--tags'], { cwd: '.' })

		console.log(`Successfully created and pushed git tag v${version}`);
	} catch (error) {
		console.error("Failed to create git commit and tag:", error);
		throw error;
	}
}

async function releasePackages(
	versionBump: "major" | "minor" | "patch" | string = "patch",
) {
	ensureCleanWorkingTree();

	const newVersion = bumpAllVersions(versionBump);
	runCommand('pnpm', ['build'], { cwd: '.' })
	console.log("Release tag created; npm publish will run via GitHub Actions (Trusted Publishing).");

	createGitCommitAndTag(newVersion);

	// After tagging, create or update a GitHub Release with notes from CHANGELOG
	try {
		createGithubRelease(newVersion);
	} catch (e) {
		console.warn("Skipping GitHub Release creation:", e);
	}
}

function shouldRunDirectly() {
	if (!process.argv[1]) return false
	try {
		const argvUrl = pathToFileURL(process.argv[1]).href
		return argvUrl === import.meta.url
	} catch {
		return false
	}
}

async function main() {
	const args = process.argv.slice(2)
	const versionArg = validateVersionBump(args[0] || 'patch')
	await releasePackages(versionArg)
}

if (shouldRunDirectly()) {
	main().catch(console.error)
}

// -------------- helpers: GitHub Release --------------

function hasGhCLI(): boolean {
	try {
		execFileSync('gh', ['--version'], { stdio: 'ignore' })
		return true;
	} catch {
		return false;
	}
}

function changelogSection(versionLike: string): string | null {
	const file = path.resolve("CHANGELOG.md");
	if (!fs.existsSync(file)) return null;
	const text = fs.readFileSync(file, "utf8");
	const re = new RegExp(
		`^## \\\\[${versionLike.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\\\]` + "[\\s\\S]*?(?=^## \\\\[(?:.|\\n)*?\\\\]|\n\n?$)",
		"m",
	);
	const m = text.match(re);
	return m ? m[0].trim() + "\n" : null;
}

function ghReleaseExists(tag: string): boolean {
	try {
		execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore' })
		return true;
	} catch {
		return false;
	}
}

function createGithubRelease(version: string) {
	if (!hasGhCLI()) return;
	const tag = `v${version}`;
	const title = `npm-trustme ${tag}`;
	let notes = changelogSection(version);

	// fallback: if no section for this semver, try mapping to GH_NOTES_REF (default: Unreleased)
	if (!notes) {
		const alt = process.env.GH_NOTES_REF || "Unreleased";
		notes = changelogSection(alt) || undefined;
	}

	const tmp = path.join(os.tmpdir(), `release-notes-${version}.md`);
	if (notes) fs.writeFileSync(tmp, notes);

	const exists = ghReleaseExists(tag);
	const args = exists ? ['release', 'edit', tag, '--title', title] : ['release', 'create', tag, '--title', title]
	if (notes) {
		args.push('--notes-file', tmp)
	} else {
		args.push('--generate-notes')
	}

	console.log(`${exists ? "Updating" : "Creating"} GitHub Release ${tag}...`);
	runCommand('gh', args)
}
