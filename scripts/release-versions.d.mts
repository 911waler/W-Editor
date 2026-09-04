export interface ReleaseVersions {
  readonly productVersion: string
  readonly webApiVersion: string
  readonly webSchemaVersion: string
  readonly hostContractsVersion: string
  readonly minimumHostAdapterVersion: string
  readonly markdownDialectVersion: string
  readonly databaseSchemaVersion: number
  readonly dataRootSchemaVersion: number
  readonly settingsSchemaVersion: number
  readonly manifestVersion: string
}

export const RELEASE_VERSIONS_PATH: string
export const EDITOR_WEB_RELEASE_VERSION_SOURCE_PATH: string
export function readReleaseVersions(repositoryRoot?: string): ReleaseVersions
export function renderEditorWebReleaseVersionSource(versions: ReleaseVersions): string
export function desktopArtifactFileNames(versions: ReleaseVersions): Readonly<{ nsis: string; msi: string }>
export function desktopArtifactPaths(targetRoot: string, versions: ReleaseVersions): Readonly<{ nsis: string; msi: string }>
