/** The page path and query must identify the same document after a refresh. */
export function editorDocumentUrl(documentId: string, currentHref: string): URL {
  const url = new URL(currentHref)
  url.search = ''
  url.hash = ''
  if (/^tutorial:[a-z0-9][a-z0-9_-]{0,63}$/u.test(documentId)) {
    const slug = documentId.slice('tutorial:'.length)
    url.pathname = slug === 'usage-guide' ? '/admin/usage-guide/edit' : `/admin/software-tutorials/${slug}/edit`
  } else if (documentId.startsWith('blog:')) {
    url.pathname = `/blogs/${documentId.slice(5)}/edit`
  } else if (/^announcement:[1-9][0-9]*$/u.test(documentId)) {
    url.pathname = `/admin/announcements/${documentId.slice('announcement:'.length)}/edit`
  } else {
    url.pathname = '/blogs/new'
    url.searchParams.set('document', documentId)
  }
  return url
}

export function announcementSettingsUrl(documentId: string, currentHref: string): URL {
  if (!/^announcement:[1-9][0-9]*$/u.test(documentId)) throw new Error('Invalid announcement document identity.')
  const url = new URL(currentHref)
  url.pathname = `/admin/announcements/${documentId.slice('announcement:'.length)}/settings`
  url.search = ''
  url.hash = ''
  return url
}

export async function saveBeforeAnnouncementSettings(
  documentId: string,
  currentHref: string,
  save: () => Promise<void>,
  navigate: (target: URL) => void = target => window.location.assign(target.href),
): Promise<void> {
  const target = announcementSettingsUrl(documentId, currentHref)
  await save()
  navigate(target)
}
