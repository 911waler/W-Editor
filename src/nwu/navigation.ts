/** The page path and query must identify the same document after a refresh. */
export function editorDocumentUrl(documentId: string, currentHref: string): URL {
  const url = new URL(currentHref)
  url.search = ''
  url.hash = ''
  if (documentId.startsWith('blog:')) {
    url.pathname = `/blogs/${documentId.slice(5)}/edit`
  } else {
    url.pathname = '/blogs/new'
    url.searchParams.set('document', documentId)
  }
  return url
}
