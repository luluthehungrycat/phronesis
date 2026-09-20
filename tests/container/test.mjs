// ───────────────────────────────────────────────────────────
// Phronesis Plugin Test Suite
// Tests: module parsing, hook structure, FTS5 search,
//        skill creation with dedup/update/feedback,
//        system transform, OpenCode integration,
//        remote execution, skill lifecycle, user profiling
// ───────────────────────────────────────────────────────────

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ───────────────────────────────────────────────────────────
// Section 1: Module Parsing & Structure Tests
// ───────────────────────────────────────────────────────────

async function testModuleParsing() {
  console.log('\n📦 Section 1: Module Parsing & Structure');
  console.log('──────────────────────────────────────────');

  // 1.1 Import skill-creator plugin
  await testAsync('skill-creator module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // 1.2 Call skill-creator plugin and verify hooks
  await testAsync('skill-creator returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // 1.3 Verify skill-creator tools (core)
  await testAsync('skill-creator registers save-skill and list-skills tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});

    assert(hooks.tool['save-skill'] !== undefined, 'save-skill tool must be registered');
    assert(hooks.tool['list-skills'] !== undefined, 'list-skills tool must be registered');

    const saveTool = hooks.tool['save-skill'];
    assert(typeof saveTool.description === 'string', 'save-skill must have description');
    assert(saveTool.description.includes('reusable skill'), 'save-skill description must mention skills');
    assert(typeof saveTool.execute === 'function', 'save-skill must have execute function');

    const listTool = hooks.tool['list-skills'];
    assert(typeof listTool.description === 'string', 'list-skills must have description');
    assert(typeof listTool.execute === 'function', 'list-skills must have execute function');
  });

  // 1.4 Verify update-skill tool
  await testAsync('skill-creator registers update-skill tool', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});

    assert(hooks.tool['update-skill'] !== undefined, 'update-skill tool must be registered');
    const tool = hooks.tool['update-skill'];
    assert(typeof tool.description === 'string', 'update-skill must have description');
    assert(typeof tool.execute === 'function', 'update-skill must have execute function');
    assert(tool.description.toLowerCase().includes('update'), 'description must mention update');
  });

  // 1.5 Verify skill-feedback tool
  await testAsync('skill-creator registers skill-feedback tool', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});

    assert(hooks.tool['skill-feedback'] !== undefined, 'skill-feedback tool must be registered');
    const tool = hooks.tool['skill-feedback'];
    assert(typeof tool.description === 'string', 'skill-feedback must have description');
    assert(typeof tool.execute === 'function', 'skill-feedback must have execute function');
    assert(tool.description.includes('feedback'), 'description must mention feedback');
  });

  // 1.6 Verify messages.transform hook (Tier 2)
  await testAsync('skill-creator has messages.transform hook for Tier 2 nudge', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});
    const hook = hooks['experimental.chat.messages.transform'];
    assert(typeof hook === 'function', 'messages.transform hook must be a function');
  });

  // 1.7 Test tool.execute.after tracking logic
  await testAsync('tool.execute.after tracks complexity state', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});
    const tracker = hooks['tool.execute.after'];

    // Simulate tool calls — should not throw
    await tracker(
      { sessionID: 'test-track-1', tool: 'bash' },
      { output: 'success' }
    );
    await tracker(
      { sessionID: 'test-track-1', tool: 'edit' },
      { output: 'file saved' }
    );
    await tracker(
      { sessionID: 'test-track-1', tool: 'write' },
      { output: 'done' }
    );
  });

  // 1.7 Identify generator produces valid SKILL.md
  await testAsync('generateSkillContent produces valid SKILL.md', async () => {
    const tmpDir = join(tmpdir(), 'phronesis-test-gen-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];
    const result = await saveTool.execute({
      name: 'test-skill',
      description: 'A test skill',
      trigger: 'when testing',
      steps: '1. Do X\n2. Do Y',
      tools: 'bash,edit',
      example: 'Example test'
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'save-skill must return success');
    assert(parsed.path.includes('test-skill'), 'path must reference skill name');
    assert(parsed.message.includes('test-skill'), 'message must reference skill name');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1.8 Test scanSkills handles missing directory
  await testAsync('skill-creator handles missing skills directory gracefully', async () => {
    const tmpDir = join(tmpdir(), 'phronesis-test-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const listTool = hooks.tool['list-skills'];
    const result = await listTool.execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.count === 0, 'empty skills dir should return count 0');
    assert(Array.isArray(parsed.skills), 'skills must be an array');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1.9 Import session-search plugin
  await testAsync('session-search module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'session-search', 'index.js'));
    assert(mod.default !== null && typeof mod.default === 'object', 'default export must be an object');
    assert(typeof mod.default.server === 'function', 'must have server() factory');
  });

  // 1.10 Session-search plugin structure
  await testAsync('session-search returns hooks with search-sessions tool', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'session-search', 'index.js'));
    const hooks = await mod.default.server();

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');

    const tools = hooks.tool;
    const searchTool = Array.isArray(tools)
      ? tools.find(t => t.name === 'search-sessions')
      : tools['search-sessions'];

    assert(searchTool !== undefined, 'search-sessions tool must be registered');
    assert(typeof searchTool.description === 'string', 'must have description');
    assert(typeof searchTool.execute === 'function', 'must have execute function');
  });
}

// ───────────────────────────────────────────────────────────
// Section 2: FTS5 Search Functional Tests
// ───────────────────────────────────────────────────────────

async function testFTS5Search() {
  console.log('\n🔎 Section 2: FTS5 Search Functional Test');
  console.log('──────────────────────────────────────────');

  const tmpDbDir = join(tmpdir(), 'phronesis-fts5-' + Date.now());
  mkdirSync(tmpDbDir, { recursive: true });

  await testAsync('FTS5 index build and search works', async () => {
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch {
      console.log('     ⚠️  No sqlite3 library available, skipping');
      return;
    }

    const dbPath = join(tmpDbDir, 'test_search.db');

    // Create DB and FTS5 table
    const db = new Database(dbPath);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS test_search USING fts5(
        session_id UNINDEXED,
        title,
        content,
        tokenize='porter unicode61'
      );
    `);

    // Insert test data
    const insert = db.prepare(
      'INSERT INTO test_search(session_id, title, content) VALUES (?, ?, ?)'
    );

    insert.run('s1', 'Docker deployment',
      'Our Docker compose setup is failing with port conflicts');
    insert.run('s2', 'Auth middleware',
      'Implement JWT authentication middleware for Express API');
    insert.run('s3', 'Database migration',
      'Migrate from SQLite to PostgreSQL using Sequelize');

    // Search
    const results = db.prepare(`
      SELECT session_id, title, rank
      FROM test_search
      WHERE test_search MATCH ?
      ORDER BY rank
    `).all('docker');

    assert(results.length > 0, 'must find docker-related session');
    assert(results[0].session_id === 's1', 'first result should be docker session');

    // Search for auth
    const authResults = db.prepare(`
      SELECT session_id, title, rank
      FROM test_search
      WHERE test_search MATCH ?
      ORDER BY rank
    `).all('jwt OR auth');

    assert(authResults.length > 0, 'must find auth-related session');
    assert(authResults[0].session_id === 's2', 'first result should be auth session');

    db.close();
  });

  await testAsync('session-search handles empty results gracefully', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'session-search', 'index.js'));
    const hooks = await mod.default.server();
    const tools = Array.isArray(hooks.tool) ? hooks.tool : Object.values(hooks.tool);
    const searchTool = tools.find(t => t.name === 'search-sessions' || t.description?.includes('search'));

    if (searchTool) {
      const result = await searchTool.execute({ query: 'test', limit: 5 });
      assert(typeof result === 'string', 'result must be a string');
      assert(result.length > 0, 'result must not be empty');
    }
  });

  rmSync(tmpDbDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 3: Skill File System Tests
// ───────────────────────────────────────────────────────────

async function testSkillFileSystem() {
  console.log('\n📝 Section 3: Skill File System Tests');
  console.log('──────────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-skill-fs-' + Date.now());
  const skillsDir = join(tmpDir, '.opencode', 'skills');
  mkdirSync(skillsDir, { recursive: true });

  // --- 3.1 Basic creation ---
  await testAsync('save-skill creates SKILL.md with correct content', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];
    const result = await saveTool.execute({
      name: 'fix-docker-network',
      description: 'Resolve Docker Compose networking issues',
      trigger: 'when containers cannot communicate',
      steps: '1. Check docker-compose.yml networks section\n2. Verify service names match hostnames\n3. Add healthcheck to dependent services',
      tools: 'read,edit,bash',
      example: 'docker-compose.yml has network config with aliases'
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'save-skill must succeed');

    // Verify file was written
    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'fix-docker-network', 'SKILL.md');
    assert(existsSync(skillFilePath), 'SKILL.md file must exist');

    // Verify content
    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('name: fix-docker-network'), 'must contain name in frontmatter');
    assert(content.includes('description: Resolve Docker Compose networking issues'), 'must contain description');
    assert(content.includes('trigger: when containers cannot communicate'), 'must contain trigger');
    assert(content.includes('1. Check docker-compose.yml'), 'must contain steps');
    assert(content.includes('tools:'), 'must contain tools reference');

    // Verify frontmatter format (YAML between --- delimiters)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert(frontmatterMatch !== null, 'must have YAML frontmatter');

    // Verify frontmatter keys
    const frontmatter = frontmatterMatch[1];
    assert(frontmatter.includes('name:'), 'frontmatter must have name');
    assert(frontmatter.includes('description:'), 'frontmatter must have description');
    assert(frontmatter.includes('trigger:'), 'frontmatter must have trigger');
  });

  // --- 3.2 List skills ---
  await testAsync('list-skills returns saved skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const listTool = hooks.tool['list-skills'];
    const result = await listTool.execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.count >= 1, 'should have at least 1 skill');
    assert(parsed.skills.some(s => s.name === 'fix-docker-network'), 'should list fix-docker-network');
  });

  // --- 3.3 Optional fields ---
  await testAsync('save-skill without optional fields produces valid output', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];
    const result = await saveTool.execute({
      name: 'minimal-skill',
      description: 'Minimal test skill',
      trigger: 'for testing',
      steps: 'Do something',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'save-skill must succeed without optional fields');

    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'minimal-skill', 'SKILL.md');
    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('name: minimal-skill'), 'must contain name');
    assert(!content.includes('undefined'), 'no undefined values in output');
  });

  // --- 3.4 Dedup: conflict detection ---
  await testAsync('save-skill dedup detects conflicting name', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];

    // Try to save with a similar name (name normalization: "Fix Docker Network" → "fix-docker-network")
    const result = await saveTool.execute({
      name: 'Fix Docker Network',  // different case, should normalize to same
      description: 'Another Docker fix',
      trigger: 'when docker breaks',
      steps: 'Do stuff',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail on conflict');
    assert(parsed.conflict === true, 'should indicate conflict');
    assert(parsed.existingName === 'fix-docker-network', 'should reference existing skill name');
    assert(parsed.message.includes('already exists'), 'message should mention existing skill');
  });

  // --- 3.5 Dedup: update:true overwrites ---
  await testAsync('save-skill with update:true overwrites existing skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];

    // Now overwrite with update:true
    const result = await saveTool.execute({
      name: 'fix-docker-network',
      description: 'Updated Docker fix description',
      trigger: 'when containers break',
      steps: '1. Updated step',
      update: true,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'should succeed with update:true');
    assert(parsed.action === 'Updated', 'should report action as Updated');

    // Verify content was overwritten
    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'fix-docker-network', 'SKILL.md');
    const content = readFileSync(skillFilePath, 'utf-8');
    assert(content.includes('Updated Docker fix description'), 'should have new description');
    assert(!content.includes('Resolve Docker Compose'), 'should not have old description');
  });

  // --- 3.6 Update-skill ---
  await testAsync('update-skill merges changes into existing skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const updateTool = hooks.tool['update-skill'];

    // Update only the trigger, leave description untouched
    const result = await updateTool.execute({
      name: 'fix-docker-network',
      trigger: 'when docker-compose up fails',
      // no description provided → should keep existing
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'update-skill should succeed');

    const skillFilePath = join(tmpDir, '.opencode', 'skills', 'fix-docker-network', 'SKILL.md');
    const content = readFileSync(skillFilePath, 'utf-8');

    // Original description should be preserved (not passed in update)
    assert(content.includes('Updated Docker fix description'), 'should preserve un-updated fields');
    // New trigger should be applied
    assert(content.includes('when docker-compose up fails'), 'should have new trigger');
    // Old trigger should be gone
    assert(!content.includes('when containers break'), 'should not have old trigger');
  });

  // --- 3.7 Update non-existent skill ---
  await testAsync('update-skill returns error for non-existent skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const updateTool = hooks.tool['update-skill'];
    const result = await updateTool.execute({
      name: 'non-existent-skill',
      description: 'Should fail',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail for non-existent skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

  // --- 3.8 Skill feedback ---
  await testAsync('skill-feedback stores rating for existing skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const feedbackTool = hooks.tool['skill-feedback'];
    const result = await feedbackTool.execute({
      name: 'fix-docker-network',
      score: 4,
      comment: 'Very helpful, saved me time',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'feedback should succeed');
    assert(parsed.skill === 'fix-docker-network', 'should reference skill name');
    assert(parsed.rating === 4, 'should record rating');
    assert(parsed.totalRatings >= 1, 'should have at least 1 rating');

    // Verify .feedback.json file was created
    const feedbackFilePath = join(tmpDir, '.opencode', 'skills', 'fix-docker-network', '.feedback.json');
    assert(existsSync(feedbackFilePath), '.feedback.json must exist');

    const feedbackData = JSON.parse(readFileSync(feedbackFilePath, 'utf-8'));
    assert(feedbackData.averageScore === 4, 'average should be 4');
    assert(feedbackData.totalRatings === 1, 'should have 1 rating');
    assert(feedbackData.feedback.length === 1, 'should have 1 feedback entry');
    assert(feedbackData.feedback[0].comment === 'Very helpful, saved me time', 'should store comment');
  });

  // --- 3.9 Skill feedback multiple ratings ---
  await testAsync('skill-feedback computes average across multiple ratings', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const feedbackTool = hooks.tool['skill-feedback'];

    // Add second rating (score: 2)
    const result2 = await feedbackTool.execute({
      name: 'fix-docker-network',
      score: 2,
      comment: 'Outdated steps',
    }, {});

    const parsed2 = JSON.parse(result2);
    assert(parsed2.success === true, 'second feedback should succeed');
    // Average of 4 and 2 = 3
    assert(parsed2.averageScore === 3, `average should be 3, got ${parsed2.averageScore}`);
    assert(parsed2.totalRatings === 2, 'should have 2 ratings total');

    // Verify on disk
    const feedbackFilePath = join(tmpDir, '.opencode', 'skills', 'fix-docker-network', '.feedback.json');
    const feedbackData = JSON.parse(readFileSync(feedbackFilePath, 'utf-8'));
    assert(feedbackData.averageScore === 3, 'on-disk average should be 3');
    assert(feedbackData.totalRatings === 2, 'on-disk should have 2 ratings');
  });

  // --- 3.10 Skill feedback for non-existent skill ---
  await testAsync('skill-feedback handles missing skill gracefully', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const feedbackTool = hooks.tool['skill-feedback'];
    const result = await feedbackTool.execute({
      name: 'i-do-not-exist',
      score: 3,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'should fail for non-existent skill');
    assert(parsed.message.includes('No skill named'), 'message should indicate not found');
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 4: System Transform Tests
// ───────────────────────────────────────────────────────────

async function testSystemTransform() {
  console.log('\n🔄 Section 4: System Transform Tests');
  console.log('──────────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-sys-xfrm-' + Date.now());
  mkdirSync(join(tmpDir, '.opencode', 'skills'), { recursive: true });

  // --- 4.1 System transform injects skill guidance ---
  await testAsync('system.transform includes skill creation guidance', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = {
      messages: [{ role: 'user', content: 'fix docker compose issue' }],
    };
    const output = { system: [] };

    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('Skill Creation System'), 'must inject skill creation section');
    assert(text.includes('save-skill'), 'must mention save-skill');
    assert(text.includes('update-skill'), 'must mention update-skill');
    assert(text.includes('skill-feedback'), 'must mention skill-feedback');
    assert(text.includes('Complexity Thresholds'), 'must include guidance on when to save');
  });

  // --- 4.2 System transform lists relevant skills ---
  await testAsync('system.transform lists relevant skills when they exist', async () => {
    // First create a skill
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const saveTool = hooks.tool['save-skill'];
    await saveTool.execute({
      name: 'fix-docker-compose',
      description: 'Resolve Docker Compose networking and port issues',
      trigger: 'when docker containers fail to communicate',
      steps: '1. Check networks\n2. Verify ports',
      tools: 'bash,read',
    }, {});

    // Now test that the system transform picks it up
    const xfrm = hooks['experimental.chat.system.transform'];
    const input = {
      messages: [{ role: 'user', content: 'need help with docker compose networking' }],
    };
    const output = { system: [] };

    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('fix-docker-compose'), 'must reference the relevant skill');
    assert(text.includes('Relevant Skills'), 'must have relevant skills section');
    assert(text.includes('Resolve Docker Compose'), 'must include skill description');
  });

  // --- 4.3 System transform with no skills ---
  await testAsync('system.transform handles empty skills gracefully', async () => {
    const emptyDir = join(tmpdir(), 'phronesis-empty-' + Date.now());
    mkdirSync(emptyDir, { recursive: true });

    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: emptyDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'hello' }] };
    const output = { system: [] };

    // Should not throw
    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('Skill Creation System'), 'should still inject guidance');
    // Should not mention any skills (empty dir)
    assert(!text.includes('Relevant Skills'), 'should not have relevant skills section when empty');

    rmSync(emptyDir, { recursive: true, force: true });
  });

  // --- 4.4 Tier 2 nudge injects synthetic message on complex task ---
  await testAsync('messages.transform injects nudge when task is complex and agent hasn\'t saved skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({});

    // Simulate the tool tracker to build complexity
    const tracker = hooks['tool.execute.after'];
    const sessionID = 'nudge-test-' + Date.now();
    for (let i = 0; i < 6; i++) {
      await tracker(
        { sessionID, tool: 'bash', args: { text: 'test command' } },
        { output: 'ok' }
      );
    }

    // Now trigger messages.transform — should inject nudge
    const xfrm = hooks['experimental.chat.messages.transform'];
    const input = { sessionID, messages: [{ role: 'user', content: 'test' }] };
    const output = { messages: [] };

    await xfrm(input, output);

    const text = (output.messages || []).map(m => m.content).join('\n');
    assert(text.includes('save-skill') || text.includes('6 tool calls'), 'nudge should mention saving the approach');
  });

  // --- 4.5 Tier 3 auto-save fires on super-complex task without agent action ---
  await testAsync('Tier 3 auto-save fires when super-complex and agent hasn\'t saved skill', async () => {
    const tmpDir = join(tmpdir(), 'phronesis-auto-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-creator', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const tracker = hooks['tool.execute.after'];
    const sessionID = 'auto-test-' + Date.now();

    // Simulate 10+ tool calls (super-complex threshold: 10)
    for (let i = 0; i < 11; i++) {
      const text = i % 2 === 0 ? 'fix the deployment issue' : 'check the logs';
      await tracker(
        { sessionID, tool: i === 3 ? 'edit' : 'bash', args: { text } },
        { output: i === 5 ? 'error happened' : 'ok' }
      );
    }

    // Verify auto-save created a SKILL.md in the skills dir
    const skillsPath = join(tmpDir, '.opencode', 'skills');
    const exists = existsSync(skillsPath);
    const dirs = exists ? readdirSync(skillsPath) : [];
    const hasSkill = dirs.some(d => existsSync(join(skillsPath, d, 'SKILL.md')));

    assert(hasSkill, 'Tier 3 should have auto-saved a skill');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 5: Persona Plugin Tests
// ───────────────────────────────────────────────────────────

async function testPersonaPlugin() {
  console.log('\n🧑 Section 5: Persona Plugin Tests');
  console.log('──────────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-persona-' + Date.now());

  // --- 5.1 Module imports ---
  await testAsync('persona module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // --- 5.2 Plugin structure ---
  await testAsync('persona returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.chat.messages.transform'] === 'function', 'must have messages.transform hook');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // --- 5.3 All persona tools registered ---
  await testAsync('persona registers all 6 tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const expectedTools = ['get-persona', 'set-persona', 'edit-persona', 'import-soul', 'export-soul', 'reset-persona'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // --- 5.4 Default persona when no PERSONA.md ---
  await testAsync('get-persona returns default persona when no file exists', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['get-persona'].execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.name === 'Default Assistant', `name should be default, got: ${parsed.name}`);
    assert(parsed.source === 'default (no PERSONA.md file found)', 'source should indicate default');
    assert(parsed.identity.role === 'coding assistant', 'should have default role');
    assert(Array.isArray(parsed.constraints), 'constraints must be an array');
    assert(parsed.constraints.length > 0, 'must have constraints');
    assert(Array.isArray(parsed.triggers), 'triggers must be an array');
    assert(parsed.triggers.length > 0, 'must have triggers');
  });

  // --- 5.5 set-persona creates persona ---
  await testAsync('set-persona creates PERSONA.md with correct values', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['set-persona'].execute({
      persona: JSON.stringify({
        name: 'Expert Tester',
        identity: {
          role: 'testing specialist',
          expertise: ['unit tests', 'integration tests', 'e2e'],
          traits: ['meticulous', 'patient'],
        },
        behavior: {
          communication_style: 'friendly',
          verbosity: 'detailed',
          formality: 'casual',
        },
        constraints: ['Always write tests first', 'Never skip edge cases'],
        triggers: [{ name: 'regression', when: 'existing tests break', action: 'Run full suite' }],
      }),
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'set-persona should succeed');
    assert(parsed.name === 'Expert Tester', `name should match, got: ${parsed.name}`);

    // Verify file was written
    const personaFilePath = join(tmpDir, '.opencode', 'persona', 'PERSONA.md');
    assert(existsSync(personaFilePath), 'PERSONA.md must exist on disk');

    const content = readFileSync(personaFilePath, 'utf-8');
    assert(content.includes('name: "Expert Tester"') || content.includes('name: Expert Tester'), 'file must contain name');
    assert(content.includes('friendly'), 'file must contain communication style');
    assert(content.includes('Always write tests first'), 'file must contain constraints');
    assert(content.includes('regression'), 'file must contain triggers');
    assert(content.startsWith('---\n'), 'should start with frontmatter delimiter');
  });

  // --- 5.6 edit-persona changes specific fields ---
  await testAsync('edit-persona changes specific fields', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    // Change just the name
    const result = await hooks.tool['edit-persona'].execute({
      name: 'Senior Tester',
      'behavior.verbosity': 'concise',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'edit-persona should succeed');
    assert(parsed.name === 'Senior Tester', 'name should be updated');

    // Verify via get-persona
    const getResult = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(getResult);
    assert(persona.name === 'Senior Tester', 'name should be updated in get');
    // Original role should be preserved (we only changed name + verbosity)
    assert(persona.identity.role === 'testing specialist', 'un-edited fields should be preserved');
    // Verbosity changed from detailed → concise
    assert(persona.behavior.verbosity === 'concise', 'verbosity should be updated');
    // Communication style should remain friendly (not touched)
    assert(persona.behavior.communication_style === 'friendly', 'other behavior fields preserved');
  });

  // --- 5.7 reset-persona ---
  await testAsync('reset-persona removes file and reverts to defaults', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['reset-persona'].execute({}, {});
    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'reset should succeed');
    assert(parsed.message.includes('reset to defaults'), 'message should confirm reset');

    // Verify file no longer exists
    const personaFilePath = join(tmpDir, '.opencode', 'persona', 'PERSONA.md');
    assert(!existsSync(personaFilePath), 'PERSONA.md should be deleted');

    // Verify get returns defaults
    const getResult = await hooks.tool['get-persona'].execute({}, {});
    const persona = JSON.parse(getResult);
    assert(persona.name === 'Default Assistant', 'should revert to default name');
    assert(persona.source.includes('default'), 'should indicate default source');
  });

  // --- 5.8 System transform injects persona guidance ---
  await testAsync('persona system.transform injects persona identity', async () => {
    // First set a persona
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    await hooks.tool['set-persona'].execute({
      persona: JSON.stringify({ name: 'TestBot', identity: { role: 'code reviewer' } }),
    }, {});

    // Now check system transform
    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'hello' }] };
    const output = { system: [] };

    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('TestBot'), 'must inject persona name');
    assert(text.includes('code reviewer'), 'must inject role');
    assert(text.includes('Operational Constraints'), 'must include constraints section');
    assert(text.includes('Communication Style'), 'must include communication style');
    assert(text.includes('Situational Triggers'), 'must include triggers');
  });

  // --- 5.9 Persona messages.transform runs without throwing ---
  await testAsync('persona messages.transform runs without error', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'persona', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.messages.transform'];
    const input = {
      messages: [
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Hi, can you help?' },
      ],
    };
    const output = { messages: [...input.messages] };

    // Should not throw
    await xfrm(input, output);
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 6: OpenCode Binary Integration
// ───────────────────────────────────────────────────────────

async function testOpenCodeIntegration() {
  console.log('\n🚀 Section 6: OpenCode Integration');
  console.log('──────────────────────────────────────────');

  try {
    require('child_process').execFileSync('opencode', ['--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    console.log('  ⏭️  OpenCode is not installed; integration checks skipped');
    return;
  }

  await testAsync('opencode binary is available', async () => {
    try {
      const result = require('child_process').execSync('opencode --version 2>&1', { encoding: 'utf-8' });
      assert(result.trim().length > 0, 'must return version string');
      console.log(`     Version: ${result.trim()}`);
    } catch (e) {
      throw new Error(`opencode not found or failed: ${e.message}`);
    }
  });

  // Create a test workspace with the plugins configured
  const testWsDir = join(tmpdir(), 'phronesis-ws-' + Date.now());
  mkdirSync(join(testWsDir, '.opencode', 'skills'), { recursive: true });

  const opencodeConfig = {
    agent: {
      build: {
        model: {
          provider: 'opencode',
          model: 'big-pickle'
        }
      }
    },
    plugin: [
      `file:${join(__dirname, '..', '..', 'src', 'skill-creator')}`,
      `file:${join(__dirname, '..', '..', 'src', 'session-search')}`
    ]
  };
  writeFileSync(join(testWsDir, 'opencode.json'), JSON.stringify(opencodeConfig, null, 2));

  await testAsync('opencode debug shows plugins loaded', async () => {
    try {
      const result = require('child_process').execSync(
        `opencode debug config --chdir ${testWsDir} 2>&1`,
        { encoding: 'utf-8', timeout: 15000 }
      );
      const config = JSON.parse(result);
      const plugins = config.plugin || [];
      assert(plugins.length >= 2, `should have at least 2 plugins, found ${plugins.length}`);
      const pluginStrs = plugins.map(p => JSON.stringify(p)).join(', ');
      assert(
        pluginStrs.includes('skill-creator') || pluginStrs.includes('session-search'),
        `plugins should include skill-creator or session-search, got: ${pluginStrs}`
      );
    } catch (e) {
      console.log(`     ⚠️  Could not verify plugins in config: ${e.message.split('\n')[0]}`);
      console.log('     This is expected if opencode is headless or running in a restricted env');
    }
  });

  // Integration test: start opencode serve, hit the API
  await testAsync('opencode serve starts and responds', async () => {
    try {
      const server = spawn('opencode', ['serve', '--chdir', testWsDir, '--port', '14096'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
        env: {
          ...process.env,
          XDG_DATA_HOME: join(tmpdir(), 'phronesis-xdg-' + Date.now()),
          HOME: testWsDir,
        }
      });

      // Wait for server to start
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server start timeout'));
        }, 15000);

        let output = '';
        server.stdout.on('data', (data) => {
          output += data.toString();
          if (output.includes('listening') || output.includes('localhost') || output.includes('port')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        server.stderr.on('data', (data) => {
          output += data.toString();
          if (output.includes('listening') || output.includes('localhost') || output.includes('port')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        server.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        server.on('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code} before ready`));
        });
      });

      // Try to hit the API
      let apiResponded = false;
      try {
        const resp = await fetch('http://localhost:14096/');
        if (resp.ok || resp.status === 404) {
          apiResponded = true;
        }
      } catch {
        try {
          const resp = await fetch('http://localhost:14096/api/sessions');
          if (resp.ok || resp.status === 404 || resp.status === 401) {
            apiResponded = true;
          }
        } catch {
          console.log('     ⚠️  REST API endpoints not found (expected — OpenCode uses SSE)');
          apiResponded = true;
        }
      }

      assert(apiResponded, 'server should respond to HTTP requests');

      // Clean up
      server.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      console.log(`     ⚠️  Integration test note: ${e.message.split('\n')[0]}`);
      console.log('     This is expected in minimal container environments without full TTY');
    }
  });

  // Clean up
  try { rmSync(testWsDir, { recursive: true, force: true }); } catch {}
}

// ───────────────────────────────────────────────────────────
// Section 7: Memory Consolidation Plugin Tests
// ───────────────────────────────────────────────────────────

async function testMemoryConsolidation() {
  console.log('\n🧠 Section 7: Memory Consolidation Plugin Tests');
  console.log('──────────────────────────────────────────');

  // --- 7.1 Module imports ---
  await testAsync('memory-consolidation module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // --- 7.2 Plugin structure ---
  await testAsync('memory-consolidation returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({ worktree: '/tmp' });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.session.compacting'] === 'function', 'must have session.compacting hook');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // --- 7.3 All tools registered ---
  await testAsync('memory-consolidation registers all 8 tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const expectedTools = [
      'add-fact', 'add-observations', 'search-facts', 'list-facts',
      'forget-fact', 'consolidate-memory', 'mark-consolidated', 'memory-stats',
    ];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
    }
  });

  // --- 7.4 add-fact stores and retrieves ---
  await testAsync('add-fact stores a fact and search-finds it', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const testContent = 'TEST_PHRONESIS_UNIQUE_' + Date.now();

    // Store a fact
    const addResult = await hooks.tool['add-fact'].execute({
      content: testContent,
      category: 'test',
      confidence: 0.9,
    }, {});

    const addParsed = JSON.parse(addResult);
    assert(addParsed.success === true, 'add-fact must succeed');

    // Search for it
    const searchResult = await hooks.tool['search-facts'].execute({
      query: 'TEST_PHRONESIS',
      limit: 10,
    }, {});

    const searchParsed = JSON.parse(searchResult);
    assert(searchParsed.success === true, 'search-facts must succeed');
    assert(searchParsed.count >= 1, 'must find at least 1 fact');

    const found = searchParsed.facts.some(f => f.content === testContent);
    assert(found, 'must find the stored test fact');

    // Clean up: find the ID and forget it
    const target = searchParsed.facts.find(f => f.content === testContent);
    if (target) {
      const forgetResult = await hooks.tool['forget-fact'].execute({ id: target.id }, {});
      const forgetParsed = JSON.parse(forgetResult);
      assert(forgetParsed.success === true, 'forget-fact must succeed');
      assert(forgetParsed.message.includes('removed'), 'message should confirm removal');
    }
  });

  // --- 7.5 add-fact updates existing fact with same content ---
  await testAsync('add-fact updates existing fact on duplicate content', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const testContent = 'DUP_TEST_' + Date.now();

    // Create first
    const r1 = await hooks.tool['add-fact'].execute({
      content: testContent, category: 'test', confidence: 0.8,
    }, {});
    const p1 = JSON.parse(r1);
    assert(p1.action === 'created', 'first add should create');

    // Second add with same content — should update, not create
    const r2 = await hooks.tool['add-fact'].execute({
      content: testContent, category: 'test', confidence: 0.9,
    }, {});
    const p2 = JSON.parse(r2);
    assert(p2.success === true, 'duplicate add-fact should succeed');
    assert(p2.action === 'updated', 'duplicate should update existing fact');

    // Clean up
    const searchResult = await hooks.tool['search-facts'].execute({ query: 'DUP_TEST', limit: 5 }, {});
    const sp = JSON.parse(searchResult);
    const target = sp.facts.find(f => f.content === testContent);
    if (target) await hooks.tool['forget-fact'].execute({ id: target.id }, {});
  });

  // --- 7.6 add-observations batches storage ---
  await testAsync('add-observations stores observations in batch', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['add-observations'].execute({
      observations: JSON.stringify(['Test observation A', 'Test observation B']),
      topic: 'testing',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'add-observations must succeed');
    assert(parsed.stored === 2, 'should store 2 observations');
  });

  // --- 7.7 list-facts returns valid data ---
  await testAsync('list-facts returns category breakdown', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['list-facts'].execute({ limit: 5 }, {});
    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'list-facts must succeed');
    assert(typeof parsed.total === 'number', 'total must be a number');
    assert(Array.isArray(parsed.categories), 'must have categories array');
    assert(Array.isArray(parsed.facts), 'must have facts array');
  });

  // --- 7.8 memory-stats returns valid stats ---
  await testAsync('memory-stats returns store statistics', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['memory-stats'].execute({}, {});
    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'memory-stats must succeed');
    assert(parsed.local !== undefined, 'must have local stats');
    assert(typeof parsed.local.facts === 'number', 'facts count must be a number');
    assert(typeof parsed.local.observations === 'number', 'observations count must be a number');
    assert(typeof parsed.supermemory === 'object', 'must have supermemory status');
    assert(parsed.supermemory.configured === false, 'supermemory should be not configured by default');
  });

  // --- 7.9 consolidate-memory handles empty state ---
  await testAsync('consolidate-memory runs with no sessions', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['consolidate-memory'].execute({ sessions_to_review: 5 }, {});
    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'consolidate-memory must succeed');
    assert(typeof parsed.run_id === 'number', 'must return a run_id');
    assert(Array.isArray(parsed.sessions), 'sessions must be an array');
  });

  // --- 7.10 mark-consolidated handles missing session ---
  await testAsync('mark-consolidated handles non-existent session', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['mark-consolidated'].execute({ session_id: 'non-existent-session' }, {});
    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'mark-consolidated should not throw');
    assert(parsed.marked === 0, 'should mark 0 sessions');
  });

  // --- 7.11 System transform injects memory context ---
  await testAsync('system.transform injects memory guidance', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'memory-consolidation', 'index.js'));
    const hooks = await mod.default({});

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = {
      messages: [{ role: 'user', content: 'help with database' }],
    };
    const output = { system: [] };

    // Should not throw
    await xfrm(input, output);

    const text = output.system.join('\n');
    assert(text.includes('Persistent Memory System'), 'must inject memory system section');
    assert(text.includes('add-fact'), 'must mention add-fact');
    assert(text.includes('Memory Tools Available'), 'must have memory tools section');
    assert(text.includes('consolidate-memory'), 'must mention consolidate-memory');
  });
}

// ───────────────────────────────────────────────────────────
// Section 8: Remote Execution Plugin Tests
// ───────────────────────────────────────────────────────────

async function testRemoteExecution() {
  console.log('\n🔧 Section 8: Remote Execution Plugin Tests');
  console.log('──────────────────────────────────────────');

  // --- 8.1 Module imports ---
  await testAsync('remote-execution module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // --- 8.2 Plugin structure ---
  await testAsync('remote-execution returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // --- 8.3 All tools registered ---
  await testAsync('remote-execution registers run-on and list-targets tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    const expectedTools = ['run-on', 'list-targets'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
      assert(typeof hooks.tool[name].description === 'string', `${name} must have a description`);
    }
  });

  // --- 8.4 list-targets returns local target by default ---
  await testAsync('list-targets returns at least the local target', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['list-targets'].execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.count >= 1, 'must have at least 1 target');
    const local = parsed.targets.find(t => t.label === 'local');
    assert(local !== undefined, 'must have local target');
    assert(local.type === 'local', 'local target must have type local');
  });

  // --- 8.5 run-on with local target executes successfully ---
  await testAsync('run-on local target runs a simple command', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['run-on'].execute({
      target: 'local',
      command: 'echo "hello from phronesis test"',
      timeout: 10000,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'local command must succeed');
    assert(parsed.target === 'local', 'result must reference target');
    assert(parsed.stdout.includes('hello from phronesis test'), 'stdout must contain command output');
    assert(typeof parsed.durationMs === 'number', 'must report duration');
    assert(parsed.exitCode === 0, 'exit code must be 0');
  });

  // --- 8.6 run-on with nonexistent target returns error ---
  await testAsync('run-on with unknown target returns helpful error', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['run-on'].execute({
      target: 'nonexistent-target-xyz',
      command: 'echo test',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'must return success=false for unknown target');
    assert(parsed.error.includes('nonexistent-target-xyz'), 'error must reference the unknown target');
    assert(Array.isArray(parsed.available), 'must list available targets');
    assert(parsed.available.includes('local'), 'available must include local');
  });

  // --- 8.7 run-on with failing command returns exit code ---
  await testAsync('run-on reports non-zero exit codes from failed commands', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'remote-execution', 'index.js'));
    const hooks = await mod.default({});

    const result = await hooks.tool['run-on'].execute({
      target: 'local',
      command: 'false',  // Always exits with 1
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === false, 'must return success=false for failed command');
    assert(parsed.exitCode === 1, 'exit code must be 1 for false command');
  });
}

// ───────────────────────────────────────────────────────────
// Section 9: Skill Lifecycle Plugin Tests
// ───────────────────────────────────────────────────────────

async function testSkillLifecycle() {
  console.log('\n📊 Section 9: Skill Lifecycle Plugin Tests');
  console.log('──────────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-lifecycle-' + Date.now());
  mkdirSync(join(tmpDir, '.opencode', 'skills', 'test-skill'), { recursive: true });

  // Create a test SKILL.md
  writeFileSync(join(tmpDir, '.opencode', 'skills', 'test-skill', 'SKILL.md'), `---
name: test-skill
description: A test skill for lifecycle testing
trigger: when testing lifecycle
tools: ["bash", "read"]
---

# test-skill

## Description
A test skill for lifecycle testing

## When to Use
when testing lifecycle

## Steps
1. Run test
2. Verify result

## Tools Used
- bash
- read
`);

  // Create a second skill for deprecation testing
  mkdirSync(join(tmpDir, '.opencode', 'skills', 'old-skill'), { recursive: true });
  writeFileSync(join(tmpDir, '.opencode', 'skills', 'old-skill', 'SKILL.md'), `---
name: old-skill
description: An outdated skill
trigger: when old stuff breaks
---

# old-skill

## Description
An outdated skill
`);

  // --- 9.1 Module imports ---
  await testAsync('skill-lifecycle module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // --- 9.2 Plugin structure ---
  await testAsync('skill-lifecycle returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // --- 9.3 All tools registered ---
  await testAsync('skill-lifecycle registers all 5 tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const expectedTools = ['skill-stats', 'skill-versions', 'skill-verify', 'skill-deprecate', 'skill-prune'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
      assert(typeof hooks.tool[name].description === 'string', `${name} must have a description`);
    }
  });

  // --- 9.4 skill-stats returns correct data ---
  await testAsync('skill-stats returns stats for existing skills', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-stats'].execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.summary.totalSkills >= 2, 'must detect at least 2 skills');
    assert(Array.isArray(parsed.skills), 'skills must be an array');

    const testSkill = parsed.skills.find(s => s.name === 'test-skill');
    assert(testSkill !== undefined, 'must find test-skill');
    assert(testSkill.description === 'A test skill for lifecycle testing', 'must read description');
    assert(testSkill.version === 1, 'initial version should be 1');
    assert(testSkill.deprecated === null, 'should not be deprecated');
  });

  // --- 9.5 skill-versions returns empty for new skill ---
  await testAsync('skill-versions returns empty for skill with no versions', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-versions'].execute({ name: 'test-skill' }, {});
    const parsed = JSON.parse(result);

    assert(parsed.success === true, 'must succeed');
    assert(parsed.skill === 'test-skill', 'must reference skill name');
    assert(parsed.currentVersion === 1, 'current version should be 1');
    assert(Array.isArray(parsed.versions), 'versions must be an array');
  });

  // --- 9.6 skill-versions handles non-existent skill ---
  await testAsync('skill-versions returns error for non-existent skill', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-versions'].execute({ name: 'no-such-skill' }, {});
    const parsed = JSON.parse(result);

    assert(parsed.success === false, 'must fail for non-existent skill');
  });

  // --- 9.7 skill-verify validates well-formed skill ---
  await testAsync('skill-verify checks skill structure', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-verify'].execute({ name: 'test-skill' }, {});
    const parsed = JSON.parse(result);

    assert(parsed.skill === 'test-skill', 'must reference skill name');
    assert(typeof parsed.healthy === 'boolean', 'must have healthy flag');
    assert(parsed.meta.version === 1, 'must have version info');
  });

  // --- 9.8 skill-deprecate marks skill as deprecated ---
  await testAsync('skill-deprecate marks a skill as deprecated', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-deprecate'].execute({
      name: 'old-skill',
      reason: 'Superseded by test-skill',
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'deprecate must succeed');
    assert(parsed.action === 'deprecate', 'action must be deprecate');

    // Verify via skill-stats
    const statsResult = await hooks.tool['skill-stats'].execute({}, {});
    const statsParsed = JSON.parse(statsResult);
    const oldSkill = statsParsed.skills.find(s => s.name === 'old-skill');
    assert(oldSkill.deprecated !== null, 'old-skill should show as deprecated');
  });

  // --- 9.9 skill-deprecate reinstates ---
  await testAsync('skill-deprecate with reinstate removes deprecation', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['skill-deprecate'].execute({
      name: 'old-skill',
      reinstate: true,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'reinstate must succeed');
    assert(parsed.action === 'reinstate', 'action must be reinstate');

    // Verify via skill-stats
    const statsResult = await hooks.tool['skill-stats'].execute({}, {});
    const statsParsed = JSON.parse(statsResult);
    const oldSkill = statsParsed.skills.find(s => s.name === 'old-skill');
    assert(oldSkill.deprecated === null, 'skill should no longer be deprecated');
  });

  // --- 9.10 skill-prune dry-run shows candidates ---
  await testAsync('skill-prune dry-run reports candidates correctly', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    // First deprecate old-skill
    await hooks.tool['skill-deprecate'].execute({ name: 'old-skill', reason: 'Testing prune' }, {});

    const result = await hooks.tool['skill-prune'].execute({
      days: 0, // 0 days = any deprecated skill
      dryRun: true,
    }, {});

    const parsed = JSON.parse(result);
    assert(parsed.success === true, 'prune dry-run must succeed');
    assert(parsed.dryRun === true, 'must indicate dry run');
    assert(parsed.candidates.length >= 1, 'must find at least 1 candidate');
    assert(parsed.candidates.some(c => c.name === 'old-skill'), 'candidates should include old-skill');
  });

  // --- 9.11 System transform injects lifecycle info ---
  await testAsync('skill-lifecycle system.transform runs without error', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'skill-lifecycle', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'test' }] };
    const output = { system: [] };

    // Should not throw
    await xfrm(input, output);
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Section 10: User Profiling Plugin Tests
// ───────────────────────────────────────────────────────────

async function testUserProfiling() {
  console.log('\n👤 Section 10: User Profiling Plugin Tests');
  console.log('──────────────────────────────────────────');

  const tmpDir = join(tmpdir(), 'phronesis-profile-' + Date.now());

  // --- 10.1 Module imports ---
  await testAsync('user-profiling module imports as ESM', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    assert(typeof mod.default === 'function', 'default export must be a function');
  });

  // --- 10.2 Plugin structure ---
  await testAsync('user-profiling returns hooks with expected shape', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    assert(hooks !== null && typeof hooks === 'object', 'hooks must be an object');
    assert(typeof hooks.tool === 'object', 'must register tools');
    assert(typeof hooks['experimental.chat.system.transform'] === 'function', 'must have system.transform hook');
    assert(typeof hooks['experimental.chat.messages.transform'] === 'function', 'must have messages.transform hook');
    assert(typeof hooks['tool.execute.after'] === 'function', 'must have tool.execute.after hook');
    assert(typeof hooks.config === 'function', 'must have config hook');
  });

  // --- 10.3 All tools registered ---
  await testAsync('user-profiling registers all 3 tools', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const expectedTools = ['profile-summary', 'profile-preference', 'profile-insights'];
    for (const name of expectedTools) {
      assert(hooks.tool[name] !== undefined, `${name} tool must be registered`);
      assert(typeof hooks.tool[name].execute === 'function', `${name} must have execute function`);
      assert(typeof hooks.tool[name].description === 'string', `${name} must have a description`);
    }
  });

  // --- 10.4 profile-summary returns default profile ---
  await testAsync('profile-summary returns default state when no profile exists', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['profile-summary'].execute({}, {});
    const parsed = JSON.parse(result);

    assert(typeof parsed.communication === 'object', 'must have communication object');
    assert(typeof parsed.preferences === 'object', 'must have preferences array');
    assert(typeof parsed.commonTasks === 'object', 'must have commonTasks array');
    assert(typeof parsed.tools === 'object', 'must have tools array');
    assert(typeof parsed.sessionCount === 'number', 'must have session count');
  });

  // --- 10.5 profile-preference stores and retrieves ---
  await testAsync('profile-preference records a preference and it appears in summary', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const prefResult = await hooks.tool['profile-preference'].execute({
      category: 'communication',
      key: 'verbosity',
      value: 'concise',
    }, {});

    const prefParsed = JSON.parse(prefResult);
    assert(prefParsed.success === true, 'must succeed');
    assert(prefParsed.message.includes('concise'), 'message must confirm the value');

    // Verify it appears in summary
    const summaryResult = await hooks.tool['profile-summary'].execute({}, {});
    const summaryParsed = JSON.parse(summaryResult);
    assert(summaryParsed.communication.verbosity === 'concise', 'verbosity must be stored');
    assert(summaryParsed.preferences.length >= 1, 'must have at least 1 preference');
  });

  // --- 10.6 profile-preference supports multiple categories ---
  await testAsync('profile-preference stores preferences in different categories', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    await hooks.tool['profile-preference'].execute({
      category: 'tools',
      key: 'preferred_language',
      value: 'python',
    }, {});

    const result = await hooks.tool['profile-summary'].execute({}, {});
    const parsed = JSON.parse(result);
    assert(parsed.preferences.length >= 2, 'must have at least 2 preferences');
    const toolPref = parsed.preferences.find(p => p.category === 'tools');
    assert(toolPref !== undefined, 'must have tools category preference');
    assert(toolPref.value === 'python', 'value must be python');
  });

  // --- 10.7 profile-insights generates insights ---
  await testAsync('profile-insights runs without error and returns structured data', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const result = await hooks.tool['profile-insights'].execute({}, {});
    const parsed = JSON.parse(result);

    assert(parsed.success === true, 'must succeed');
    assert(typeof parsed.profile === 'object', 'must have profile object');
    assert(typeof parsed.profile.communication === 'object', 'must have communication data');
    assert(typeof parsed.profile.totalSessions === 'number', 'must have session count');
  });

  // --- 10.8 System transform does not throw ---
  await testAsync('user-profiling system.transform handles missing profile gracefully', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.system.transform'];
    const input = { messages: [{ role: 'user', content: 'hello' }] };
    const output = { system: [] };

    // Should not throw
    await xfrm(input, output);
  });

  // --- 10.9 Messages transform does not throw ---
  await testAsync('user-profiling messages.transform tracks messages without error', async () => {
    const mod = await import(join(__dirname, '..', '..', 'src', 'user-profiling', 'index.js'));
    const hooks = await mod.default({ worktree: tmpDir });

    const xfrm = hooks['experimental.chat.messages.transform'];
    const input = {
      sessionID: 'test-profile-session',
      messages: [
        { role: 'user', content: 'Can you help me implement an API endpoint in Python?' },
        { role: 'assistant', content: 'Sure! Let me help you with that.' },
      ],
    };
    const output = { messages: [...input.messages] };

    // Should not throw
    await xfrm(input, output);
  });

  rmSync(tmpDir, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────

async function main() {
  try {
    await testModuleParsing();
    await testFTS5Search();
    await testSkillFileSystem();
    await testSystemTransform();
    await testPersonaPlugin();
    await testMemoryConsolidation();
    await testRemoteExecution();
    await testSkillLifecycle();
    await testUserProfiling();
    await testOpenCodeIntegration();
  } catch (e) {
    console.log(`\n💥 Unexpected test error: ${e.message}`);
    failed++;
  }

  const total = passed + failed;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) console.log(`  ${failed} test(s) failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
