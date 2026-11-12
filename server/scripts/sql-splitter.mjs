/**
 * 把 MySQL 脚本切成可逐条执行的语句。
 * 需要正确处理 DELIMITER $$ ... $$（procedures.sql / triggers.sql 里的存储过程与触发器），
 * 同时跳过纯注释行，避免注释里的分号被误判为语句结束。
 */
export function splitStatements(sql) {
  const lines = String(sql).split(/\r?\n/);
  let delimiter = ';';
  let buffer = [];
  const statements = [];

  const flush = (endIndex) => {
    const text = buffer.join('\n');
    const stmt = (endIndex >= 0 ? text.slice(0, endIndex) : text).trim();
    if (stmt) statements.push(stmt);
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const dm = /^DELIMITER\s+(\S+)/i.exec(trimmed);
    if (dm) {
      if (buffer.join('\n').trim()) flush(-1);
      delimiter = dm[1];
      continue;
    }
    if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

    buffer.push(line);
    if (trimmed.endsWith(delimiter)) {
      const joined = buffer.join('\n');
      const idx = joined.lastIndexOf(delimiter);
      flush(idx);
    }
  }
  if (buffer.join('\n').trim()) flush(-1);
  return statements;
}
