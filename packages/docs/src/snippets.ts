import type { PreparedRequest } from '@postmano/send/browser'

export type Language = 'curl' | 'javascript' | 'python'

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'javascript', label: 'JavaScript (fetch)' },
  { id: 'python', label: 'Python (requests)' }
]

const shell = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`
const literal = (value: string): string => JSON.stringify(value)

const headerObject = (headers: readonly [string, string][]): string =>
  `{${headers.map(([name, value]) => `\n    ${literal(name)}: ${literal(value)}`).join(',')}\n  }`

const curl = (request: PreparedRequest): string => {
  const parts = [`curl --request ${shell(request.method)} ${shell(request.url)}`]
  for (const [name, value] of request.headers) {
    parts.push(`--header ${shell(`${name}: ${value}`)}`)
  }
  if (request.body?.kind === 'text') {
    parts.push(`--data-raw ${shell(request.body.text)}`)
  } else if (request.body?.kind === 'form') {
    parts.push(...request.body.fields.map(([key, value]) => `--form-string ${shell(`${key}=${value}`)}`))
  }
  return parts.join(' \\\n  ')
}

const javascript = (request: PreparedRequest): string => {
  const form = request.body?.kind === 'form' ? request.body.fields : undefined
  const lines = [`method: ${literal(request.method)}`]
  if (request.headers.length > 0) {
    lines.push(`headers: ${headerObject(request.headers)}`)
  }
  if (request.body?.kind === 'text') {
    lines.push(`body: ${literal(request.body.text)}`)
  } else if (form) {
    lines.push('body: form')
  }
  const prelude = form
    ? `const form = new FormData()\n${form.map(([key, value]) => `form.append(${literal(key)}, ${literal(value)})`).join('\n')}\n\n`
    : ''
  return `${prelude}const response = await fetch(${literal(request.url)}, {\n  ${lines.join(',\n  ')}\n})\nconsole.log(response.status, await response.text())`
}

const python = (request: PreparedRequest): string => {
  const args = [literal(request.method), literal(request.url)]
  if (request.headers.length > 0) {
    args.push(`headers=${headerObject(request.headers)}`)
  }
  if (request.body?.kind === 'text') {
    args.push(`data=${literal(request.body.text)}`)
  } else if (request.body?.kind === 'form') {
    args.push(
      `files={${request.body.fields.map(([key, value]) => `${literal(key)}: (None, ${literal(value)})`).join(', ')}}`
    )
  }
  return `import requests\n\nresponse = requests.request(${args.join(', ')})\nprint(response.status_code, response.text)`
}

const GENERATORS: Record<Language, (request: PreparedRequest) => string> = { curl, javascript, python }

/** A ready-to-run example of the request in the given language. */
export const snippet = (language: Language, request: PreparedRequest): string => GENERATORS[language](request)
