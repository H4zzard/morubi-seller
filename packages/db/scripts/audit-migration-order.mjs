import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(packageDirectory, 'drizzle');
const metadataDirectory = join(migrationsDirectory, 'meta');
const breakpoint = /--> statement-breakpoint/g;

const errors = [];
const tables = new Map();
const types = new Set();
const indexes = new Map();
const constraints = new Set();
const policies = new Set();
const functions = new Set();
const triggers = new Set();
let foreignKeyCount = 0;
let statementCount = 0;

const location = (file, statement) => `${file} (statement ${statement})`;
const objectKey = (table, name) => `${table}.${name}`;
const columnsKey = (columns) => columns.join('\u0000');

function parseColumns(value) {
  const columns = [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const remainder = value.replace(/"[^"]+"/g, '').replace(/[\s,]/g, '');
  return columns.length > 0 && remainder === '' ? columns : null;
}

function requireTable(tableName, context, action) {
  const table = tables.get(tableName);
  if (!table) errors.push(`${context}: ${action} references missing table ${tableName}`);
  return table;
}

function addConstraint(tableName, constraintName, context) {
  const key = objectKey(tableName, constraintName);
  if (constraints.has(key)) errors.push(`${context}: duplicate constraint ${key}`);
  constraints.add(key);
}

function addUniqueKey(table, columns) {
  table.uniqueKeys.add(columnsKey(columns));
}

function inspectCreateTable(statement, context) {
  const match = /CREATE\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s*\(([\s\S]*)\)\s*;/i.exec(statement);
  if (!match) return;

  const [, tableName, body] = match;
  if (tables.has(tableName)) errors.push(`${context}: duplicate table ${tableName}`);

  const table = { columns: new Set(), uniqueKeys: new Set() };
  tables.set(tableName, table);

  for (const line of body.split(/\r?\n/)) {
    const column = /^\s*"([^"]+)"\s+/.exec(line);
    if (!column) continue;
    table.columns.add(column[1]);
    if (/\bPRIMARY\s+KEY\b/i.test(line)) addUniqueKey(table, [column[1]]);

    const quotedType = /^\s*"[^"]+"\s+(?:"public"\.)?"([^"]+)"/.exec(line);
    if (quotedType && !types.has(quotedType[1])) {
      errors.push(
        `${context}: table ${tableName} uses enum/type ${quotedType[1]} before it is created`
      );
    }
  }

  for (const match of body.matchAll(/CONSTRAINT\s+"([^"]+)"/gi)) {
    addConstraint(tableName, match[1], context);
  }
  for (const match of body.matchAll(/(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]+)\)/gi)) {
    const columns = parseColumns(match[1]);
    if (columns) addUniqueKey(table, columns);
  }
}

function inspectStatement(statement, context) {
  for (const match of statement.matchAll(
    /CREATE\s+TYPE\s+(?:"public"\.)?"([^"]+)"\s+AS\s+ENUM/gi
  )) {
    if (types.has(match[1])) errors.push(`${context}: duplicate enum/type ${match[1]}`);
    types.add(match[1]);
  }

  inspectCreateTable(statement, context);

  for (const match of statement.matchAll(/ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"/gi)) {
    requireTable(match[1], context, 'ALTER TABLE');
  }

  for (const match of statement.matchAll(
    /ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s+DROP\s+CONSTRAINT\s+"([^"]+)"/gi
  )) {
    const key = objectKey(match[1], match[2]);
    if (!constraints.delete(key))
      errors.push(`${context}: DROP CONSTRAINT references missing ${key}`);
  }

  for (const match of statement.matchAll(
    /ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s+ADD\s+COLUMN\s+"([^"]+)"\s+([^;]+)/gi
  )) {
    const [, tableName, columnName, definition] = match;
    const table = tables.get(tableName);
    if (table) {
      if (table.columns.has(columnName))
        errors.push(`${context}: duplicate column ${tableName}.${columnName}`);
      table.columns.add(columnName);
    }
    const quotedType = /^(?:"public"\.)?"([^"]+)"/.exec(definition.trim());
    if (quotedType && !types.has(quotedType[1])) {
      errors.push(
        `${context}: column ${tableName}.${columnName} uses enum/type ${quotedType[1]} before it is created`
      );
    }
  }

  for (const match of statement.matchAll(/DROP\s+INDEX\s+(?:"public"\.)?"([^"]+)"/gi)) {
    if (!indexes.delete(match[1]))
      errors.push(`${context}: DROP INDEX references missing ${match[1]}`);
  }

  for (const match of statement.matchAll(
    /CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"(?:\s+USING\s+\w+)?\s*\(([^;]+?)\)(\s+WHERE\s+[\s\S]+?)?;/gi
  )) {
    const [, unique, indexName, tableName, columnList, where] = match;
    const table = requireTable(tableName, context, `index ${indexName}`);
    if (indexes.has(indexName)) errors.push(`${context}: duplicate index ${indexName}`);
    indexes.set(indexName, tableName);
    const columns = parseColumns(columnList);
    if (unique && !where && columns && table) addUniqueKey(table, columns);
  }

  for (const match of statement.matchAll(
    /ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"/gi
  )) {
    addConstraint(match[1], match[2], context);
  }

  for (const match of statement.matchAll(
    /ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:"public"\.)?"([^"]+)"\s*\(([^)]+)\)/gi
  )) {
    const [, sourceName, constraintName, sourceList, targetName, targetList] = match;
    foreignKeyCount += 1;
    const source = requireTable(sourceName, context, `foreign key ${constraintName}`);
    const target = requireTable(targetName, context, `foreign key ${constraintName}`);
    const sourceColumns = parseColumns(sourceList);
    const targetColumns = parseColumns(targetList);

    if (!sourceColumns || !targetColumns) {
      errors.push(`${context}: could not parse columns for foreign key ${constraintName}`);
      continue;
    }
    for (const column of sourceColumns) {
      if (source && !source.columns.has(column))
        errors.push(
          `${context}: foreign key ${constraintName} uses missing source column ${sourceName}.${column}`
        );
    }
    for (const column of targetColumns) {
      if (target && !target.columns.has(column))
        errors.push(
          `${context}: foreign key ${constraintName} uses missing target column ${targetName}.${column}`
        );
    }
    if (target && !target.uniqueKeys.has(columnsKey(targetColumns))) {
      errors.push(
        `${context}: foreign key ${constraintName} targets ${targetName}(${targetColumns.join(', ')}) before a matching primary/unique key exists`
      );
    }
  }

  for (const match of statement.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"public"\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi
  )) {
    functions.add(match[1]);
  }

  for (const match of statement.matchAll(
    /CREATE\s+TRIGGER\s+"([^"]+)"[\s\S]*?\s+ON\s+(?:"public"\.)?"([^"]+)"[\s\S]*?EXECUTE\s+FUNCTION\s+(?:"public"\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi
  )) {
    const [, triggerName, tableName, functionName] = match;
    const key = objectKey(tableName, triggerName);
    requireTable(tableName, context, `trigger ${triggerName}`);
    if (!functions.has(functionName))
      errors.push(`${context}: trigger ${triggerName} uses missing function ${functionName}`);
    if (triggers.has(key)) errors.push(`${context}: duplicate trigger ${key}`);
    triggers.add(key);
  }

  for (const match of statement.matchAll(
    /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"/gi
  )) {
    const [, policyName, tableName] = match;
    const key = objectKey(tableName, policyName);
    requireTable(tableName, context, `policy ${policyName}`);
    if (policies.has(key)) errors.push(`${context}: duplicate policy ${key}`);
    policies.add(key);
  }

  for (const match of statement.matchAll(/GRANT\s+[\s\S]+?\s+ON\s+TABLE\s+([\s\S]+?)\s+TO\s+/gi)) {
    for (const tableMatch of match[1].matchAll(/"([^"]+)"/g)) {
      requireTable(tableMatch[1], context, 'GRANT');
    }
  }
}

function auditSnapshot(snapshot, snapshotFile) {
  const snapshotTables = snapshot.tables ?? {};
  for (const [qualifiedName, table] of Object.entries(snapshotTables)) {
    const tableName = table.name ?? qualifiedName.replace(/^public\./, '');
    const uniqueKeys = new Set();
    for (const [columnName, column] of Object.entries(table.columns ?? {})) {
      if (column.primaryKey) uniqueKeys.add(columnsKey([columnName]));
    }
    for (const value of Object.values(table.compositePrimaryKeys ?? {})) {
      uniqueKeys.add(columnsKey(value.columns ?? []));
    }
    for (const value of Object.values(table.uniqueConstraints ?? {})) {
      uniqueKeys.add(columnsKey(value.columns ?? []));
    }
    for (const value of Object.values(table.indexes ?? {})) {
      if (!value.isUnique || value.where) continue;
      const columns = (value.columns ?? []).map((column) => column.expression ?? column);
      if (columns.every((column) => typeof column === 'string'))
        uniqueKeys.add(columnsKey(columns));
    }

    for (const foreignKey of Object.values(table.foreignKeys ?? {})) {
      const targetName = foreignKey.tableTo;
      const target = Object.values(snapshotTables).find(
        (candidate) => candidate.name === targetName
      );
      if (!target) {
        errors.push(
          `${snapshotFile}: foreign key ${foreignKey.name} targets missing table ${targetName}`
        );
        continue;
      }
      const targetUniqueKeys = new Set();
      for (const [columnName, column] of Object.entries(target.columns ?? {})) {
        if (column.primaryKey) targetUniqueKeys.add(columnsKey([columnName]));
      }
      for (const value of Object.values(target.compositePrimaryKeys ?? {}))
        targetUniqueKeys.add(columnsKey(value.columns ?? []));
      for (const value of Object.values(target.uniqueConstraints ?? {}))
        targetUniqueKeys.add(columnsKey(value.columns ?? []));
      for (const value of Object.values(target.indexes ?? {})) {
        if (!value.isUnique || value.where) continue;
        const columns = (value.columns ?? []).map((column) => column.expression ?? column);
        if (columns.every((column) => typeof column === 'string'))
          targetUniqueKeys.add(columnsKey(columns));
      }
      if (!targetUniqueKeys.has(columnsKey(foreignKey.columnsTo ?? []))) {
        errors.push(
          `${snapshotFile}: foreign key ${tableName}.${foreignKey.name} has no matching unique target key`
        );
      }
    }
  }
}

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

for (const file of migrationFiles) {
  const sql = await readFile(join(migrationsDirectory, file), 'utf8');
  const statements = sql
    .split(breakpoint)
    .map((statement) => statement.trim())
    .filter(Boolean);
  statements.forEach((statement, index) => {
    statementCount += 1;
    inspectStatement(statement, location(file, index + 1));
  });
}

const journal = JSON.parse(await readFile(join(metadataDirectory, '_journal.json'), 'utf8'));
const journalTags = (journal.entries ?? []).map((entry) => `${entry.tag}.sql`);
if (JSON.stringify(journalTags) !== JSON.stringify(migrationFiles)) {
  errors.push(
    `drizzle/meta/_journal.json does not match migration files: ${journalTags.join(', ')}`
  );
}

const snapshotFiles = (await readdir(metadataDirectory))
  .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
  .sort();
const latestSnapshotFile = snapshotFiles.at(-1);
if (!latestSnapshotFile) throw new Error('No Drizzle schema snapshot was found.');
const latestSnapshot = JSON.parse(
  await readFile(join(metadataDirectory, latestSnapshotFile), 'utf8')
);
auditSnapshot(latestSnapshot, latestSnapshotFile);

if (errors.length > 0) {
  console.error(`Migration audit failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Migration audit passed: ${migrationFiles.length} files, ${statementCount} statements, ${foreignKeyCount} foreign keys.`
  );
  console.log(`Latest snapshot checked: ${latestSnapshotFile}.`);
}
