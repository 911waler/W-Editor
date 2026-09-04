import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function writeFixture(relativePath, content) {
  const target = resolve(relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

writeFixture(
  'e2e/fixtures/files/sample-image.png',
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
)
writeFixture('e2e/fixtures/files/sample-audio.wav', Buffer.from('524946462400000057415645666d74201000000001000100401f0000803e0000010008006461746100000000', 'hex'))
writeFixture('e2e/fixtures/files/sample-video.mp4', Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'))
writeFixture('e2e/fixtures/files/sample.pdf', '%PDF-1.4\n% W-Editor deterministic upload fixture\n%%EOF\n')
writeFixture('e2e/fixtures/files/sample.docx', 'W-Editor deterministic Word upload fixture\n')
writeFixture('e2e/fixtures/files/sample.txt', 'W-Editor deterministic arbitrary-file upload fixture\n')

const representativeParts = ['# Representative long W-Editor document\n']
for (let index = 1; index <= 800; index += 1) {
  representativeParts.push(
    `\n## Section ${index}\n\n`,
    `Paragraph ${index} keeps **bold**, *italic*, [links](https://example.test/${index}), 中文输入, and exact  spacing.\n\n`,
    `- item ${index}.1\n- [${index % 2 === 0 ? 'x' : ' '}] task ${index}.2\n\n`,
    `| key | value |\n| :--- | ---: |\n| section | ${index} |\n`,
  )
  if (index % 25 === 0) {
    representativeParts.push(`\n\`\`\`javascript\nconst section = ${index}\n\`\`\`\n`)
  }
  if (index % 40 === 0) {
    representativeParts.push(`\n::: info Section ${index}\nContainer body ${index}.\n:::\n`)
  }
}
writeFixture('e2e/fixtures/documents/representative-long.md', representativeParts.join(''))

const diagnosticParts = ['# Approximately one megabyte diagnostic document\n']
const targetBytes = 1_049_000
let index = 0
while (Buffer.byteLength(diagnosticParts.join(''), 'utf8') < targetBytes) {
  index += 1
  diagnosticParts.push(
    `\n## Diagnostic ${index}\nParagraph ${index}: alpha beta gamma 中文 delta epsilon.\n`,
    `- item ${index}\n- [ ] task ${index}\n\n| n | square |\n| ---: | ---: |\n| ${index} | ${index * index} |\n`,
  )
}
writeFixture('e2e/fixtures/documents/approximately-1mb.md', diagnosticParts.join(''))

console.log('Deterministic W-Editor fixtures generated.')
