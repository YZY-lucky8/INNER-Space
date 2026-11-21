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

test('合并后的 init.sql 能解析出预期数量的对象', async () => {
  const dir = path.resolve(here, '../../database');
  const sql = await fs.readFile(path.join(dir, 'init.sql'), 'utf8');
  const parts = splitStatements(sql);
  const count = (re) => parts.filter((x) => re.test(x)).length;
  assert.equal(count(/^CREATE TABLE/i), 19, `CREATE TABLE 数量异常，共 ${parts.length} 条`);
  assert.equal(count(/^CREATE VIEW/i), 6);
  assert.equal(count(/^CREATE PROCEDURE/i), 8);
  assert.equal(count(/^CREATE TRIGGER/i), 7);
});
