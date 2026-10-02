declare module 'citeproc' {
  interface System {
    retrieveLocale(language: string): string
    retrieveItem(id: string): Record<string, unknown>
  }
  interface Processor {
    setOutputFormat(format: 'text'): void
    updateItems(ids: string[]): void
    makeBibliography(): [Record<string, unknown>, string[]] | false
  }
  const CSL: { Engine: { new(system: System, style: string, language?: string): Processor; prototype: Processor } }
  export default CSL
}
