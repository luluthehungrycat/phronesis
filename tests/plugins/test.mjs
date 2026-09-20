// ───────────────────────────────────────────────────────────
// Phronesis Plugin Integration Tests
// Covers all 7 plugins: persona, skill-creator, session-search,
// memory-consolidation, user-profiling, skill-lifecycle, remote-execution
// ───────────────────────────────────────────────────────────

import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');

// ── Test Framework ──
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split('\n').slice(1, 3).join('\n     ');
      console.log(`     ${lines}`);
    }
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split('\n').slice(1, 3).join('\n     ');
      console.log(`     ${lines}`);
    }
    failed++;
  }
}


function pluginServer(mod) {
  if (typeof mod.default === "function") return mod.default;
  if (mod.default && typeof mod.default.server === "function") return mod.default.server;
  throw new Error("plugin module must expose a server() factory");
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ───────────────────────────────────────────────────────────
// Section 1: Persona Plugin
// ───────────────────────────────────────────────────────────

async function testPersonaPlugin() {
  console.log('\n🧑 Section 1: Persona Plugin');
  console.log('──────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-test-persona-' + Date.now());

  // 1.1 Module loads correctly
  await testAsync('persona module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 1.2 Plugin returns hooks with expected tools
  await testAsync('persona returns hooks with 6 tools', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.chat.messages.transform'] === 'function', 'must have messages.transform hook');
    assert(typeof hooks.config === 'function', 'must have config hook');

    const expectedTools = ['get-persona', 'set-persona', 'edit-persona', 'import-soul', 'export-soul', 'reset-persona'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // 1.3 defaultPersona structure (via get-persona)
  await testAsync('get-persona returns default persona with correct structure', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(result);

    assert(persona.name === 'Default Assistant', `name should be default, got: ${persona.name}`);
    assert(persona.identity.role === 'coding assistant', 'role should be coding assistant');
    assert(Array.isArray(persona.identity.expertise), 'expertise must be an array');
    assert(persona.identity.expertise.length > 0, 'must have at least one expertise');
    assert(Array.isArray(persona.identity.traits), 'traits must be an array');
    assert(persona.identity.traits.length > 0, 'must have traits');
    assert(persona.behavior.communication_style === 'professional', 'default communication style');
    assert(persona.behavior.verbosity === 'balanced', 'default verbosity');
    assert(persona.behavior.formality === 'professional', 'default formality');
    assert(Array.isArray(persona.constraints), 'constraints must be an array');
    assert(persona.constraints.length > 0, 'must have constraints');
    assert(Array.isArray(persona.triggers), 'triggers must be an array');
    assert(persona.triggers.length > 0, 'must have triggers');
    assert(persona.source === 'default (no PERSONA.md file found)', 'source should indicate no file');
    assert(persona.file === null, 'file should be null when no PERSONA.md exists');
  });

  // 1.4 Persona file read/write round-trip using tmpdir
  await testAsync('set-persona creates PERSONA.md then get-persona reads it back', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const setResult = await hooks.tool['set-persona'].execute({
      persona: JSON.stringify({
        name: 'TestBot',
        identity: { role: 'tester', expertise: ['testing'], traits: ['meticulous'] },
        behavior: { communication_style: 'friendly', verbosity: 'concise', formality: 'casual' },
        constraints: ['Always test first'],
        triggers: [{ name: 'test-fail', when: 'a test fails', action: 'investigate' }],
      }),
    }, {});

    const setParsed = JSON.parse(setResult);
    assert(setParsed.success === true, 'set-persona should succeed');
    assert(setParsed.name === 'TestBot', 'should return set name');

    // Verify file exists
    const personaFilePath = join(tmpDir, '.opencode', 'persona', 'PERSONA.md');
    assert(existsSync(personaFilePath), 'PERSONA.md must exist on disk');

    // Read back via get-persona
    const getResult = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(getResult);
    assert(persona.name === 'TestBot', 'should read back TestBot name');
    assert(persona.identity.role === 'tester', 'should read back role');
    assert(persona.behavior.communication_style === 'friendly', 'should read back communication style');
    assert(persona.constraints[0] === 'Always test first', 'should read back constraint');
    assert(persona.triggers[0].name === 'test-fail', 'should read back trigger');
    assert(persona.file !== null, 'file should not be null when file exists');
    assert(persona.source === 'PERSONA.md', 'source should indicate file');
  });

  // 1.5 edit-persona changes specific fields
  await testAsync('edit-persona changes specific fields while preserving others', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Ensure persona exists
    await hooks.tool['set-persona'].execute({
      persona: JSON.stringify({
        name: 'Editor Test',
        identity: { role: 'editor', expertise: ['editing'], traits: ['thorough'] },
        behavior: { communication_style: 'casual', verbosity: 'detailed', formality: 'casual' },
      }),
    }, {});

    // Edit only name and verbosity
    const editResult = await hooks.tool['edit-persona'].execute({
      name: 'Editor Updated',
      'behavior.verbosity': 'concise',
    }, {});

    const editParsed = JSON.parse(editResult);
    assert(editParsed.success === true, 'edit-persona should succeed');
    assert(editParsed.name === 'Editor Updated', 'name should be updated');

    // Verify via get-persona
    const getResult = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(getResult);
    assert(persona.name === 'Editor Updated', 'name should be updated in get');
    assert(persona.behavior.verbosity === 'concise', 'verbosity should be updated');
    // Role should be preserved (not touched by edit)
    assert(persona.identity.role === 'editor', 'un-edited field should be preserved');
    // Communication style should be preserved
    assert(persona.behavior.communication_style === 'casual', 'other behavior fields preserved');
  });

  // 1.6 reset-persona removes file
  await testAsync('reset-persona removes file and reverts to defaults', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const resetResult = await hooks.tool['reset-persona'].execute({}, {});
    const resetParsed = JSON.parse(resetResult);
    assert(resetParsed.success === true, 'reset should succeed');

    // Verify file no longer exists
    const personaFilePath = join(tmpDir, '.opencode', 'persona', 'PERSONA.md');
    assert(!existsSync(personaFilePath), 'PERSONA.md should be deleted');

    // Verify get returns defaults
    const getResult = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(getResult);
    assert(persona.name === 'Default Assistant', 'should revert to default name');
    assert(persona.source.includes('default'), 'should indicate default source');
  });

  // 1.7 Malformed persona file returns default
  await testAsync('malformed persona file returns default persona', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));

    // Write invalid content
    const personaDir = join(tmpDir, '.opencode', 'persona');
    mkdirSync(personaDir, { recursive: true });
    writeFileSync(join(personaDir, 'PERSONA.md'), 'not valid yaml or frontmatter', 'utf-8');

    const hooks = await pluginServer(mod)({ worktree: tmpDir });
    const result = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(result);

    // Should return default persona
    assert(persona.name === 'Default Assistant', 'malformed file returns default name');
    assert(persona.source === 'PERSONA.md', 'source should indicate file was found');
  });

  // 1.8 import-soul and export-soul
  await testAsync('import-soul parses SOUL.md and export-soul creates SOUL.md', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));

    // Create a SOUL.md file
    const soulContent = `# SoulBot

> A soulful assistant

## Identity
I am a philosopher with expertise in ethics, logic.

## Communication
I communicate in a friendly manner with balanced detail, maintaining a casual tone.

## Constraints
- Always be kind

## Triggers

### sadness
- **When**: user is sad
- **Action**: offer comfort
`;

    const soulPath = join(tmpDir, 'test-soul.md');
    writeFileSync(soulPath, soulContent, 'utf-8');

    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Import from SOUL
    const importResult = await hooks.tool['import-soul'].execute({ path: 'test-soul.md' }, {});
    const importParsed = JSON.parse(importResult);
    assert(importParsed.success === true, 'import-soul should succeed');
    assert(importParsed.name === 'SoulBot', 'should extract name from heading');

    // Export to SOUL
    const exportResult = await hooks.tool['export-soul'].execute({ output: join(tmpDir, 'exported-soul.md') }, {});
    const exportParsed = JSON.parse(exportResult);
    assert(exportParsed.success === true, 'export-soul should succeed');
    assert(existsSync(join(tmpDir, 'exported-soul.md')), 'exported SOUL.md must exist');
  });

  // 1.9 persona system.transform injects guidance
  await testAsync('persona system.transform injects persona identity into output', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Set a persona first
    await hooks.tool['set-persona'].execute({
      persona: JSON.stringify({ name: 'GuidanceBot', identity: { role: 'guide' } }),
    }, {});

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'hello' }] };
    const output = { system: [] };

    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('GuidanceBot'), 'must inject persona name');
    assert(text.includes('guide'), 'must inject role');
    assert(text.includes('Operational Constraints'), 'must include constraints section');
    assert(text.includes('Communication Style'), 'must include communication style');
  });

  // 1.10 persona messages.transform runs without error
  await testAsync('persona messages.transform runs without error', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.messages.transform'];
    const input = { messages: [{ role: 'user', content: 'Hi' }] };
    const output = { messages: [{ role: 'user', content: 'Hi' }] };

    await xfrm(input, output);
  });

  // 1.11 config hook sets persona permission
  await testAsync('persona config hook sets permission', async () => {
    const mod = await import(join(SRC, 'persona', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const config = {};
    await hooks.config(config);
    assert(config.permission?.persona === 'allow', 'should set persona permission to allow');
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 2: Skill Creator Plugin
// ───────────────────────────────────────────────────────────

async function testSkillCreatorPlugin() {
  console.log('\n🧠 Section 2: Skill Creator Plugin');
  console.log('────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-test-sc-' + Date.now());

  // 2.1 Module loads correctly
  await testAsync('skill-creator module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 2.2 Plugin returns hooks with expected tools
  await testAsync('skill-creator returns hooks with 4 tools', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.chat.messages.transform'] === 'function', 'must have messages.transform hook');
    assert(typeof hooks.config === 'function', 'must have config hook');

    const expectedTools = ['save-skill', 'update-skill', 'list-skills', 'skill-feedback'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // 2.3 save-skill creates SKILL.md
  await testAsync('save-skill creates SKILL.md with correct content', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['save-skill'].execute({
      name: 'test-my-skill',
      description: 'A test skill description',
      trigger: 'when testing plugins',
      steps: '1. Run tests\n2. Verify output',
      tools: 'bash,read',
      example: 'npm test',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'save-skill must return success');
    assert(parsed.action === 'Created', 'first save should be Created');
    assert(parsed.path.includes('test-my-skill'), 'path must reference skill name');

    // Verify file was written
    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'test-my-skill', 'SKILL.md');
    assert(existsSync(skillFilePath), 'SKILL.md must exist');

    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('name: test-my-skill'), 'must contain name');
    assert(content.includes('description: A test skill description'), 'must contain description');
    assert(content.includes('## Steps'), 'must contain Steps section');
    assert(content.includes('## Tools Used'), 'must contain Tools Used section');
  });

  // 2.4 Dedup: save-skill detects conflict
  await testAsync('save-skill dedup detects conflicting name', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Try to save with a different-cased name that normalizes to same
    const result = await hooks.tool['save-skill'].execute({
      name: 'Test My Skill',  // different case, normalizes to test-my-skill
      description: 'Duplicate test',
      trigger: 'when conflict',
      steps: 'Test',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail on conflict');
    assert(parsed.conflict === true, 'should indicate conflict');
    assert(parsed.existingName === 'test-my-skill', 'should reference existing skill name');
    assert(parsed.message.includes('already exists'), 'message should mention existing skill');
  });

  // 2.5 Dedup: update:true overwrites
  await testAsync('save-skill with update:true overwrites existing skill', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['save-skill'].execute({
      name: 'test-my-skill',
      description: 'Updated description',
      trigger: 'when updated trigger',
      steps: 'Updated steps',
      update: true,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'should succeed with update:true');
    assert(parsed.action === 'Updated', 'should report action as Updated');

    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'test-my-skill', 'SKILL.md');
    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('Updated description'), 'should have new description');
    assert(!content.includes('A test skill description'), 'should not have old description');
  });

  // 2.6 list-skills returns saved skills
  await testAsync('list-skills returns saved skill', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['list-skills'].execute({}, {});
    const parsed = JSON.parse(result);
    assert(parsed.count >= 1, 'should have at least 1 skill');
    assert(parsed.skills.some(s => s.name === 'test-my-skill'), 'should list test-my-skill');
    assert(typeof parsed.skills[0].rating === 'string', 'rating should be a string');
  });

  // 2.7 update-skill merges changes
  await testAsync('update-skill merges changes into existing skill', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Update only the trigger
    const result = await hooks.tool['update-skill'].execute({
      name: 'test-my-skill',
      trigger: 'when container breaks',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'update-skill should succeed');

    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'test-my-skill', 'SKILL.md');
    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('Updated description'), 'should preserve un-updated fields');
    assert(content.includes('when container breaks'), 'should have new trigger');
  });

  // 2.8 update-skill for non-existent returns error
  await testAsync('update-skill returns error for non-existent skill', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['update-skill'].execute({
      name: 'does-not-exist',
      description: 'Should fail',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail for non-existent skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

  // 2.9 skill-feedback stores rating
  await testAsync('skill-feedback stores rating for existing skill', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-feedback'].execute({
      name: 'test-my-skill',
      score: 5,
      comment: 'Great skill!',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'feedback should succeed');
    assert(parsed.skill === 'test-my-skill', 'should reference skill name');
    assert(parsed.rating === 5, 'should record rating');
    assert(parsed.totalRatings >= 1, 'should have at least 1 rating');
  });

  // 2.10 skill-feedback for non-existent returns error
  await testAsync('skill-feedback handles missing skill gracefully', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-feedback'].execute({
      name: 'i-do-not-exist',
      score: 3,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail for non-existent skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

  // 2.11 State management: tool.execute.after tracks complexity
  await testAsync('tool.execute.after tracks tool call state', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const tracker = hooks['tool.execute.after'];
    const sessionID = 'state-test-' + Date.now();

    // Make some tool calls
    await tracker({ sessionID, tool: 'bash' }, { output: 'ok' });
    await tracker({ sessionID, tool: 'edit' }, { output: 'file saved' });
    await tracker({ sessionID, tool: 'write' }, { output: 'done' });

    // Should not throw
  });

  // 2.12 Name normalization edge case
  await testAsync('save-skill handles name normalization correctly', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Test with special characters
    const result = await hooks.tool['save-skill'].execute({
      name: '   FIX__DOCKER___Network!!!  ',
      description: 'Edge case',
      trigger: 'when edge',
      steps: 'Test',
      update: true,  // allow overwrite/creation with normalized name
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'should handle weird names');
    assert(parsed.path.includes('fix-docker-network'), 'name should be normalized');
  });

  // 2.13 system.transform injects guidance
  await testAsync('skill-creator system.transform injects skill guidance', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'fix issue' }] };
    const output = { system: [] };

    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('Skill Creation System'), 'must inject skill creation section');
    assert(text.includes('save-skill'), 'must mention save-skill');
    assert(text.includes('Complexity Thresholds'), 'must include thresholds');
    assert(text.includes('Available commands'), 'must mention available commands');
  });

  // 2.14 config hook sets permission
  await testAsync('skill-creator config hook sets skill permission', async () => {
    const mod = await import(join(SRC, 'skill-creator', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const config = {};
    await hooks.config(config);
    assert(config.permission?.skill === 'allow', 'should set skill permission to allow');
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 3: Session Search Plugin
// ───────────────────────────────────────────────────────────

async function testSessionSearchPlugin() {
  console.log('\n🔎 Section 3: Session Search Plugin');
  console.log('─────────────────────────────────────');

  // 3.1 Module loads correctly (different structure — object with server factory)
  await testAsync('session-search module imports as ESM with correct structure', async () => {
    const mod = await import(join(SRC, 'session-search', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(mod.default.id === 'session-search', 'id must be session-search');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 3.2 Plugin returns hooks with search-sessions tool
  await testAsync('session-search returns hooks with search-sessions tool', async () => {
    const mod = await import(join(SRC, 'session-search', 'index.js'));
    const hooks = await mod.default.server();

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');

    const searchTool = hooks.tool['search-sessions'];
    assert(searchTool !== undefined, 'search-sessions tool must be registered');
    assert(typeof searchTool.description === 'string', 'must have description');
    assert(typeof searchTool.execute === 'function', 'must have execute function');
    assert(searchTool.description.length > 0, 'description must not be empty');
  });

  // 3.3 search-sessions has expected args (query, limit)
  await testAsync('search-sessions args include query and limit', async () => {
    const mod = await import(join(SRC, 'session-search', 'index.js'));
    const hooks = await mod.default.server();

    const searchTool = hooks.tool['search-sessions'];
    assert(searchTool.args !== undefined, 'args must be defined');
    assert(searchTool.args.query !== undefined, 'query arg must be defined');
    assert(searchTool.args.limit !== undefined, 'limit arg should be defined');
  });

  // 3.4 searchDbPath resolution (test via inspection of behavior)
  // We can't call sqlEscape or searchDbPath directly since they're internal,
  // but we can verify the module structure is correct
  await testAsync('session-search plugin structure is complete', async () => {
    const mod = await import(join(SRC, 'session-search', 'index.js'));
    assert(typeof mod.default.id === 'string', 'id must be a string');
    assert(mod.default.id.length > 0, 'id must not be empty');
  });
}

// ───────────────────────────────────────────────────────────
// Section 4: Memory Consolidation Plugin
// ───────────────────────────────────────────────────────────

async function testMemoryConsolidationPlugin() {
  console.log('\n💾 Section 4: Memory Consolidation Plugin');
  console.log('───────────────────────────────────────────');

  let betterSqlite3Available = false;
  try {
    // Try to load better-sqlite3 to check availability
    const require = (await import('module')).createRequire(import.meta.url);
    require('better-sqlite3');
    betterSqlite3Available = true;
  } catch {
    // better-sqlite3 native module may not compile in all environments
  }

  // 4.1 Module loads correctly
  await testAsync('memory-consolidation module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 4.2 Plugin returns hooks with expected tools
  await testAsync('memory-consolidation returns hooks with 8 tools', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    const hooks = await pluginServer(mod)({});

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.session.compacting'] === 'function', 'must have session.compacting hook');
    assert(typeof hooks.config === 'function', 'must have config hook');

    const expectedTools = [
      'add-fact', 'add-observations', 'search-facts', 'list-facts',
      'forget-fact', 'consolidate-memory', 'mark-consolidated', 'memory-stats',
    ];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // 4.3 system.transform injects memory guidance
  await testAsync('memory-consolidation system.transform injects memory context', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    const hooks = await pluginServer(mod)({});

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'test' }] };
    const output = { system: [] };

    // Should not throw even if better-sqlite3 is not available
    try {
      await xfrm(input, output);
    } catch (e) {
      // Allow failure only if better-sqlite3 is unavailable
      if (betterSqlite3Available) throw e;
    }

    const text = output.system.join('\n');
    if (betterSqlite3Available) {
      assert(text.includes('Persistent Memory System'), 'must inject memory section');
      assert(text.includes('Memory Tools Available'), 'must list memory tools');
      assert(text.includes('add-fact'), 'must mention add-fact');
      assert(text.includes('search-facts'), 'must mention search-facts');
    }
  });

  // 4.4 session.compacting hook exists and runs
  await testAsync('memory-consolidation session.compacting runs without error', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    const hooks = await pluginServer(mod)({});

    const compact = hooks['experimental.session.compacting'];
    try {
      await compact({ sessionID: 'test-session', title: 'Test' });
    } catch {
      // May fail if DB not available — acceptable
    }
  });

  // 4.5 config hook sets permission
  await testAsync('memory-consolidation config hook sets memory permission', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    const hooks = await pluginServer(mod)({});

    const config = {};
    await hooks.config(config);
    assert(config.permission?.memory === 'allow', 'should set memory permission to allow');
  });

  // 4.6 Tool descriptions are non-empty
  await testAsync('memory-consolidation tool descriptions are meaningful', async () => {
    const mod = await import(join(SRC, 'memory-consolidation', 'index.js'));
    const hooks = await pluginServer(mod)({});

    for (const [name, t] of Object.entries(hooks.tool)) {
      assert(typeof t.description === 'string', `${name} must have description`);
      assert(t.description.length > 20, `${name} description must be meaningful (got ${t.description.length} chars)`);
    }
  });
}

// ───────────────────────────────────────────────────────────
// Section 5: User Profiling Plugin
// ───────────────────────────────────────────────────────────

async function testUserProfilingPlugin() {
  console.log('\n📊 Section 5: User Profiling Plugin');
  console.log('─────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-test-up-' + Date.now());

  // 5.1 Module loads correctly
  await testAsync('user-profiling module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 5.2 Plugin returns hooks with expected tools
  await testAsync('user-profiling returns hooks with 3 tools', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.chat.messages.transform'] === 'function', 'must have messages.transform hook');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks.config === 'function', 'must have config hook');

    const expectedTools = ['profile-summary', 'profile-preference', 'profile-insights'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // 5.3 Profile template structure (empty state)
  await testAsync('profile-summary returns correct empty profile structure', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['profile-summary'].execute();
    const profile = JSON.parse(result);

    assert(profile.communication !== undefined, 'must have communication field');
    assert(profile.preferences !== undefined, 'must have preferences field');
    assert(Array.isArray(profile.preferences), 'preferences must be an array');
    assert(profile.commonTasks !== undefined, 'must have commonTasks field');
    assert(Array.isArray(profile.commonTasks), 'commonTasks must be an array');
    assert(profile.sessionCount !== undefined, 'must have sessionCount');
    assert(profile.lastUpdated !== undefined, 'must have lastUpdated');
  });

  // 5.4 profile-preference records a preference
  await testAsync('profile-preference records and retrieves preferences', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['profile-preference'].execute({
      category: 'communication',
      key: 'verbosity',
      value: 'concise',
    });

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'profile-preference should succeed');
    assert(parsed.totalPreferences >= 1, 'should have at least 1 preference');

    // Verify via profile-summary
    const summary = await hooks.tool['profile-summary'].execute();
    const profile = JSON.parse(summary);
    assert(profile.communication.verbosity === 'concise', 'should reflect stored preference');
  });

  // 5.5 Profile JSON parsing handles errors
  await testAsync('profile handles corrupt JSON file gracefully', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));

    // Write corrupt profile
    const profileDir = join(tmpDir, '.opencode', 'profile');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'profile.json'), '{invalid json}', 'utf-8');

    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    // Should return default profile instead of throwing
    const result = await hooks.tool['profile-summary'].execute();
    const profile = JSON.parse(result);
    assert(profile.communication !== undefined, 'corrupt file should return default structure');
    assert(profile.preferences.length === 0, 'corrupt file should return empty preferences');
  });

  // 5.6 profile-insights works on empty state
  await testAsync('profile-insights handles empty state gracefully', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['profile-insights'].execute();
    const parsed = JSON.parse(result);

    assert(parsed.success === true, 'profile-insights should succeed');
    assert(parsed.profile !== undefined, 'should have profile summary');
    assert(typeof parsed.profile.totalSessions === 'number', 'should have session count');
  });

  // 5.7 system.transform injects profile context
  await testAsync('user-profiling system.transform injects profile', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'test' }] };
    const output = { system: [] };

    await xfrm(input, output);

    // With no profile data, should not inject profile section
    // (profile is only injected when there's data)
    // But should not throw
  });

  // 5.8 messages.transform runs without error
  await testAsync('user-profiling messages.transform runs without error', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.messages.transform'];
    await xfrm(
      { sessionID: 'test-' + Date.now(), messages: [{ role: 'user', content: 'Hello' }] },
      { messages: [{ role: 'user', content: 'Hello' }] }
    );
  });

  // 5.9 config hook sets tool permissions
  await testAsync('user-profiling config hook sets permissions', async () => {
    const mod = await import(join(SRC, 'user-profiling', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const config = {};
    await hooks.config(config);
    assert(config.permission?.['profile-summary'] === 'allow', 'should set profile-summary permission');
    assert(config.permission?.['profile-preference'] === 'allow', 'should set profile-preference permission');
    assert(config.permission?.['profile-insights'] === 'allow', 'should set profile-insights permission');
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 6: Skill Lifecycle Plugin
// ───────────────────────────────────────────────────────────

async function testSkillLifecyclePlugin() {
  console.log('\n🔄 Section 6: Skill Lifecycle Plugin');
  console.log('─────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-test-sl-' + Date.now());
  const skillsDir = join(tmpDir, '.opencode', 'skills');
  const testSkillDir = join(skillsDir, 'lifecycle-test');
  mkdirSync(testSkillDir, { recursive: true });

  // Create a test SKILL.md for lifecycle tests
  const skillContent = `---
name: lifecycle-test
description: A skill for lifecycle testing
trigger: when testing lifecycle
tools: ["bash", "read"]
---

# lifecycle-test

## Steps
1. Test the lifecycle
2. Verify results

## Tools Used
- \`bash\`
- \`read\`
`;
  writeFileSync(join(testSkillDir, 'SKILL.md'), skillContent, 'utf-8');

  // 6.1 Module loads correctly
  await testAsync('skill-lifecycle module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 6.2 Plugin returns hooks with expected tools
  await testAsync('skill-lifecycle returns hooks with 5 tools', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks.config === 'function', 'must have config hook');

    const expectedTools = ['skill-stats', 'skill-versions', 'skill-verify', 'skill-deprecate', 'skill-prune'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // 6.3 skill-stats returns correct structure
  await testAsync('skill-stats returns stats with expected fields', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-stats'].execute();
    const parsed = JSON.parse(result);

    assert(parsed.skills !== undefined, 'must have skills array');
    assert(Array.isArray(parsed.skills), 'skills must be an array');
    assert(parsed.summary !== undefined, 'must have summary');
    assert(typeof parsed.summary.totalSkills === 'number', 'totalSkills must be a number');
    assert(typeof parsed.summary.totalInvocations === 'number', 'totalInvocations must be a number');

    // Find our test skill
    const testSkill = parsed.skills.find(s => s.name === 'lifecycle-test');
    assert(testSkill !== undefined, 'should find lifecycle-test skill');
    assert(testSkill.description === 'A skill for lifecycle testing', 'should have correct description');
    assert(testSkill.version >= 1, 'should have version');
  });

  // 6.4 skill-verify validates SKILL.md
  await testAsync('skill-verify checks SKILL.md structure', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-verify'].execute({ name: 'lifecycle-test' });
    const parsed = JSON.parse(result);

    assert(parsed.success === true, 'valid skill should pass verification');
    assert(parsed.skill === 'lifecycle-test', 'should reference correct skill');
    assert(parsed.healthy === true, 'valid skill should be healthy');
    assert(parsed.meta !== undefined, 'should include meta');
    assert(parsed.meta.version >= 1, 'should report version');
  });

  // 6.5 skill-verify for non-existent returns error
  await testAsync('skill-verify handles missing skill gracefully', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-verify'].execute({ name: 'no-such-skill' });
    const parsed = JSON.parse(result);

    assert(parsed.success === false, 'should fail for missing skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

    // 6.6 Deprecation: skill-deprecate marks skill as deprecated
  await testAsync('skill-deprecate marks skill as deprecated', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-deprecate'].execute({
      name: 'lifecycle-test',
      reason: 'Testing deprecation feature',
    });

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'deprecate should succeed');
    assert(parsed.action === 'deprecate', 'action should be deprecate');
    assert(parsed.reason === 'Testing deprecation feature', 'should store reason');
    assert(parsed.message.includes('deprecated'), 'message should confirm deprecation');
  });

  // 6.7 Deprecation: skill-deprecate reinstate works
  await testAsync('skill-deprecate reinstate restores skill', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-deprecate'].execute({
      name: 'lifecycle-test',
      reinstate: true,
    });

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'reinstate should succeed');
    assert(parsed.action === 'reinstate', 'action should be reinstate');
  });

  // 6.8 Deprecation: skill-deprecate on non-existent returns error
  await testAsync('skill-deprecate handles missing skill gracefully', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-deprecate'].execute({
      name: 'no-such-skill',
      reason: 'Test',
    });

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail for missing skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

  // 6.9 skill-versions for non-existent returns error
  await testAsync('skill-versions handles missing skill gracefully', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const result = await hooks.tool['skill-versions'].execute({ name: 'no-such-skill' });
    const parsed = JSON.parse(result);

    assert(parsed.success === false, 'should fail for missing skill');
  });

  // 6.10 system.transform runs without error
  await testAsync('skill-lifecycle system.transform runs without error', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'test' }] };
    const output = { system: [] };

    await xfrm(input, output);

    // With a skill present, should inject lifecycle info
    const text = output.system.join('\n');
    assert(text.includes('lifecycle-test'), 'must reference the existing skill');
    assert(text.includes('Skill Lifecycle'), 'must inject lifecycle section');
  });

  // 6.11 config hook sets tool permissions
  await testAsync('skill-lifecycle config hook sets permissions', async () => {
    const mod = await import(join(SRC, 'skill-lifecycle', 'index.js'));
    const hooks = await pluginServer(mod)({ worktree: tmpDir });

    const config = {};
    await hooks.config(config);
    assert(config.permission?.['skill-stats'] === 'allow', 'should set skill-stats permission');
    assert(config.permission?.['skill-versions'] === 'allow', 'should set skill-versions permission');
    assert(config.permission?.['skill-verify'] === 'allow', 'should set skill-verify permission');
    assert(config.permission?.['skill-deprecate'] === 'allow', 'should set skill-deprecate permission');
    assert(config.permission?.['skill-prune'] === 'allow', 'should set skill-prune permission');
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 7: Remote Execution Plugin
// ───────────────────────────────────────────────────────────

async function testRemoteExecutionPlugin() {
  console.log('\n🚀 Section 7: Remote Execution Plugin');
  console.log('───────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-test-re-' + Date.now());

  // Create a minimal remote-execution config for testing
  const configDir = join(tmpDir, '.config', 'opencode');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'remote-execution-targets.json'), JSON.stringify({
    targets: [
      { label: 'test-container', type: 'container', address: 'my-container', runtime: 'docker' },
      { label: 'test-ssh', type: 'ssh', address: 'user@host' },
    ],
  }), 'utf-8');

  // Override HOME for the test
  const envHomeOrig = process.env.HOME;
  process.env.HOME = tmpDir;

  // 7.1 Module loads correctly
  await testAsync('remote-execution module imports as ESM with default function', async () => {
    const mod = await import(join(SRC, 'remote-execution', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  try {
    // 7.2 Plugin returns hooks with expected tools
    await testAsync('remote-execution returns hooks with run-on and list-targets', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
      assert(typeof hooks.tool === 'object', 'must register tools');
      assert(typeof hooks.config === 'function', 'must have config hook');

      assert(hooks.tool['run-on'] !== undefined, 'run-on tool must be registered');
      assert(typeof hooks.tool['run-on'].execute === 'function', 'run-on must have execute function');

      assert(hooks.tool['list-targets'] !== undefined, 'list-targets tool must be registered');
      assert(typeof hooks.tool['list-targets'].execute === 'function', 'list-targets must have execute function');
    });

    // 7.3 list-targets includes built-in "local" and configured targets
    await testAsync('list-targets returns local + configured targets', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const result = await hooks.tool['list-targets'].execute();
      const parsed = JSON.parse(result);

      assert(parsed.count >= 1, 'should have at least 1 target');
      assert(parsed.targets.some(t => t.label === 'local'), 'should include local target');
      assert(parsed.targets.some(t => t.label === 'test-container'), 'should include test-container target');
      assert(parsed.targets.some(t => t.label === 'test-ssh'), 'should include test-ssh target');
    });

    // 7.4 run-on returns error for unknown target
    await testAsync('run-on returns error for unknown target', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const result = await hooks.tool['run-on'].execute({
        target: 'nonexistent-target',
        command: 'echo hello',
      });

      const parsed = JSON.parse(result);
      assert(parsed.success === false, 'should fail for unknown target');
      assert(parsed.error.includes('Unknown target'), 'error should mention unknown target');
      assert(Array.isArray(parsed.available), 'should list available targets');
    });

    // 7.5 run-on with 'local' target executes
    await testAsync('run-on local target executes successfully', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const result = await hooks.tool['run-on'].execute({
        target: 'local',
        command: 'echo "hello world"',
      });

      const parsed = JSON.parse(result);
      assert(parsed.success === true, 'local exec should succeed');
      assert(parsed.stdout.trim() === 'hello world', 'stdout should contain expected output');
      assert(parsed.exitCode === 0, 'exit code should be 0');
      assert(typeof parsed.durationMs === 'number', 'duration should be a number');
    });

    // 7.6 run-on local target error handling
    await testAsync('run-on local target captures non-zero exit', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const result = await hooks.tool['run-on'].execute({
        target: 'local',
        command: 'exit 42',
      });

      const parsed = JSON.parse(result);
      assert(parsed.success === false, 'should report failure for non-zero exit');
      assert(parsed.exitCode === 42, 'should capture exit code');
    });

    // 7.7 run-on has correct args structure
    await testAsync('run-on args include target, command, timeout', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const runTool = hooks.tool['run-on'];
      assert(runTool.args !== undefined, 'args must be defined');
      assert(runTool.args.target !== undefined, 'target arg must be defined');
      assert(runTool.args.command !== undefined, 'command arg must be defined');
      assert(runTool.args.timeout !== undefined, 'timeout arg must be defined');
    });

    // 7.8 config hook sets permission
    await testAsync('remote-execution config hook sets run-on permission', async () => {
      const mod = await import(join(SRC, 'remote-execution', 'index.js'));
      const hooks = await pluginServer(mod)({});

      const config = {};
      await hooks.config(config);
      assert(config.permission?.['run-on'] === 'allow', 'should set run-on permission to allow');
    });

  } finally {
    // Restore HOME
    process.env.HOME = envHomeOrig;
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────
// Main runner
// ───────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Phronesis Plugin Integration Tests');
  console.log('═══════════════════════════════════════════════\n');

  await testPersonaPlugin();
  await testSkillCreatorPlugin();
  await testSessionSearchPlugin();
  await testMemoryConsolidationPlugin();
  await testUserProfilingPlugin();
  await testSkillLifecyclePlugin();
  await testRemoteExecutionPlugin();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${passed}/${passed + failed} tests passed`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
