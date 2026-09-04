import { readFileSync } from 'node:fs'

const checklist = readFileSync(new URL('../docs/acceptance-checklist.md', import.meta.url), 'utf8')
const featureManifest = JSON.parse(
  readFileSync(new URL('../tests/fixtures/manifests/feature-manifest.json', import.meta.url), 'utf8'),
)
const requirementTitles = featureManifest.acceptanceRequirements.items.map(({ title }) => title)
const commandIds = [...featureManifest.commands.ids]
const missingRequirements = requirementTitles.filter((title) => !checklist.includes(`| ${title} |`))
const missingCommands = commandIds.filter((id) => !checklist.includes(`| \`${id}\` |`))
const duplicateAcceptanceIds = [...checklist.matchAll(/^\| `(EWS|MCP|SVE|CTS|LDL|ECI|RV|CMD)-\d+` \|/gm)]
  .map((match) => match[0])
  .filter((id, index, all) => all.indexOf(id) !== index)

if (
  requirementTitles.length !== featureManifest.acceptanceRequirements.count
  || commandIds.length !== featureManifest.commands.count
  || requirementTitles.length !== 74
  || commandIds.length !== 80
) {
  throw new Error(`Unexpected source inventory: ${requirementTitles.length} requirements, ${commandIds.length} commands`)
}
if (missingRequirements.length || missingCommands.length || duplicateAcceptanceIds.length) {
  throw new Error(JSON.stringify({ missingRequirements, missingCommands, duplicateAcceptanceIds }))
}
if (!/must not be archived, merged, or committed as accepted/.test(checklist) || !/Task 18\.9 stays open/.test(checklist)) {
  throw new Error('Acceptance/no-archive policy is incomplete')
}

console.log(`Acceptance checklist valid: ${requirementTitles.length} requirements and ${commandIds.length} commands mapped.`)
