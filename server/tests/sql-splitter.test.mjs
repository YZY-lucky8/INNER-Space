import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../scripts/sql-splitter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('普通分号语句被正确切分，纯注释不产生语句', () => {
  const parts = splitStatements('-- comment ; with semicolon\nSET NAMES utf8mb4;\nCREATE TABLE a (id INT);\n');
  assert.equal(parts.length, 2);
  assert.equal(parts[0], 'SET NAMES utf8mb4');
  assert.match(parts[1], /^CREATE TABLE a/);
});

test('DELIMITER $$ 内的过程体不会被内部的分号切开', () => {
  const sql = [
    'DELIMITER $$',
    'CREATE PROCEDURE p()',
    'BEGIN',
    '  SELECT 1;',
    '  SELECT 2;',
    'END$$',
    'DELIMITER ;',
    'SELECT 3;',
  ].join('\n');
  const parts = splitStatements(sql);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes('SELECT 1;') && parts[0].includes('SELECT 2;'));
  assert.equal(parts[1], 'SELECT 3');
});

test('项目四个 SQL 脚本都能解析出预期数量的语句', async () => {
  const dir = path.resolve(here, '../../database');
  const expected = {
    'schema.sql': (s) => s.filter((x) => /^CREATE TABLE/i.test(x)).length === 23,
    'views.sql': (s) => s.filter((x) => /^CREATE VIEW/i.test(x)).length === 6,
    'procedures.sql': (s) => s.filter((x) => /^CREATE PROCEDURE/i.test(x)).length === 8,
    'triggers.sql': (s) => s.filter((x) => /^CREATE TRIGGER/i.test(x)).length === 7,
  };
  for (const [file, check] of Object.entries(expected)) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const parts = splitStatements(sql);
    assert.ok(check(parts), `${file} 解析异常，共 ${parts.length} 条`);
  }
});
