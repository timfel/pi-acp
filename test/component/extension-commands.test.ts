import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession } from '../../src/acp/session.js'
import { isPiExtensionCommand, toAvailableCommandsFromPiGetCommands } from '../../src/acp/pi-commands.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

const EXTENSION_COMMANDS = {
  commands: [
    { name: 'wt', description: 'Create a worktree', source: 'extension' },
    { name: 'session', description: 'Session info', source: 'builtin' }
  ]
}

test('isPiExtensionCommand: matches name and source only', () => {
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, '/wt create feature'), true)
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, '/wt'), true)
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, '/session'), false)
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, '/missing'), false)
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, 'plain text'), false)
  assert.equal(isPiExtensionCommand(EXTENSION_COMMANDS, '/'), false)
  assert.equal(isPiExtensionCommand(undefined, '/wt'), false)
})

test('advertising: extension commands are included in available commands', () => {
  const { commands } = toAvailableCommandsFromPiGetCommands(EXTENSION_COMMANDS, {
    includeExtensionCommands: true
  })
  assert.deepEqual(
    commands.map(c => c.name),
    ['wt', 'session']
  )
})

test('PiAcpSession: command-only extension turn settles on RPC resolve', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.commands = EXTENSION_COMMANDS

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const reason = await session.prompt('/wt create feature-name')

  assert.equal(reason, 'end_turn')
  assert.deepEqual(proc.prompts, [{ message: '/wt create feature-name', attachments: [] }])
  assert.equal(proc.getSessionStatsCount > 0, true, 'usage published on settle')
})

test('PiAcpSession: extension command that starts an agent run still waits for agent_settled', async () => {
  class AgentStartingProcess extends FakePiRpcProcess {
    override async getCommands(): Promise<unknown> {
      return { commands: [{ name: 'handoff', source: 'extension' }] }
    }
    override async prompt(message: string, attachments: unknown[] = []): Promise<void> {
      this.prompts.push({ message, attachments })
      this.emit({ type: 'agent_start' })
    }
  }

  const conn = new FakeAgentSideConnection()
  const proc = new AgentStartingProcess()

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  let settled = false
  const reason = session.prompt('/handoff agent-2').then(r => {
    settled = true
    return r
  })

  await new Promise(r => setTimeout(r, 0))
  assert.equal(settled, false, 'must not settle before agent_settled')

  proc.emit({ type: 'agent_settled' })
  assert.equal(await reason, 'end_turn')
})

test('PiAcpSession: forwards visible custom extension messages', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  proc.emit({
    type: 'message_end',
    message: { role: 'custom', customType: 'workflow', content: 'Step 2 done', display: true }
  })
  // Hidden and non-custom messages stay invisible; assistant messages stream via message_update.
  proc.emit({ type: 'message_end', message: { role: 'custom', content: 'secret', display: false } })
  proc.emit({ type: 'message_end', message: { role: 'assistant', content: 'already streamed' } })
  proc.emit({ type: 'message_end', message: { role: 'custom', content: '' } })

  await new Promise(r => setTimeout(r, 0))

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Step 2 done' },
    _meta: { piAcp: { customType: 'workflow' } }
  })
})

test('PiAcpSession: prompts starting with "/" still work when command discovery fails', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.commandsError = new Error('unknown command get_commands')

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const pending = session.prompt('/not-a-real-command')
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_settled' })

  assert.equal(await pending, 'end_turn')
  assert.deepEqual(proc.prompts, [{ message: '/not-a-real-command', attachments: [] }])
})
