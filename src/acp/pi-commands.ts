import type { AvailableCommand } from '@agentclientprotocol/sdk'

export type PiRpcCommandInfo = {
  name?: unknown
  description?: unknown
  source?: unknown
  location?: unknown
  path?: unknown
}

function rawPiCommands(data: unknown): PiRpcCommandInfo[] {
  const root = data as { commands?: unknown; data?: { commands?: unknown } } | null
  if (Array.isArray(root?.commands)) return root.commands as PiRpcCommandInfo[]
  if (Array.isArray(root?.data?.commands)) return root.data.commands as PiRpcCommandInfo[]
  return []
}

/** True when `message` invokes a slash command provided by a pi extension (not a prompt template). */
export function isPiExtensionCommand(data: unknown, message: string): boolean {
  if (!message.startsWith('/')) return false

  const separator = message.search(/\s/)
  const name = message.slice(1, separator < 0 ? undefined : separator)
  if (!name) return false

  return rawPiCommands(data).some(c => c.name === name && c.source === 'extension')
}

function describeFallback(c: PiRpcCommandInfo): string {
  const source = typeof c.source === 'string' ? c.source : ''
  const location = typeof c.location === 'string' ? c.location : ''

  const parts: string[] = []
  if (source) parts.push(source)
  if (location) parts.push(location)

  return parts.length ? `(${parts.join(':')})` : '(command)'
}

export function toAvailableCommandsFromPiGetCommands(
  data: unknown,
  opts?: { enableSkillCommands?: boolean; includeExtensionCommands?: boolean }
): {
  commands: AvailableCommand[]
  raw: PiRpcCommandInfo[]
} {
  const enableSkillCommands = opts?.enableSkillCommands ?? true
  const includeExtensionCommands = opts?.includeExtensionCommands ?? false

  const commandsRaw = rawPiCommands(data)

  const out: AvailableCommand[] = []

  for (const c of commandsRaw) {
    const name = typeof c?.name === 'string' ? c.name.trim() : ''
    if (!name) continue

    const source = typeof c?.source === 'string' ? c.source : ''
    if (!includeExtensionCommands && source === 'extension') continue

    if (!enableSkillCommands && name.startsWith('skill:')) continue

    const desc = typeof c?.description === 'string' ? c.description.trim() : ''

    out.push({
      name,
      description: desc || describeFallback(c)
    })
  }

  return { commands: out, raw: commandsRaw }
}
