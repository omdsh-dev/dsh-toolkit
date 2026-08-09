/**
 * CSV 查询 / 统计 / JSON 映射 —— 零依赖，纯函数。
 *
 * - queryRows：按列名或 1-based 索引精确匹配过滤（严格 ===，非子串）；
 *   结果包含表头行（如果存在），保证可被 parse 回读。
 * - statsGrid：行数 / 列数 / 列名 / 空行数 / 警告（字段数不一致、重复列名）。
 * - toJsonRows：网格 → JSON（header=true 时每行一个对象：缺失字段补 null、
 *   多余字段并入最后一个字段；header=false 时每行一个数组）。
 */
const DEFAULT_LIMIT = 100;
/** 单遍循环求最大列宽（不用 spread——十万行级 grid 会触发 RangeError）。 */
function gridWidth(grid) {
    let width = 0;
    for (const row of grid) {
        if (row.length > width)
            width = row.length;
    }
    return width;
}
/** 单遍循环求最小列宽。 */
function gridMinWidth(grid) {
    let min = Number.POSITIVE_INFINITY;
    for (const row of grid) {
        if (row.length < min)
            min = row.length;
    }
    return min;
}
/** 规范化 limit：非法值（undefined/null/非有限/负数/0/小数）回退到默认 100。 */
export function normalizeLimit(limit) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
        return DEFAULT_LIMIT;
    }
    return Math.floor(limit);
}
/** 严格 1-based 正整数索引校验（"01"/"1.5"/"0"/"-1"/"abc" 全部拒绝）。 */
function parseIndex(column) {
    if (!/^[1-9]\d*$/.test(column))
        return null;
    const n = Number(column);
    return Number.isSafeInteger(n) ? n : null;
}
/** 解析列引用 → 0-based 列下标；解析失败抛 csv: 错误。 */
function resolveColumn(grid, column, header) {
    if (grid.length === 0) {
        throw new Error('csv: empty CSV has no columns');
    }
    if (header) {
        const headerRow = grid[0];
        const byName = headerRow.indexOf(column);
        if (byName !== -1)
            return byName;
        const byIndex = parseIndex(column);
        if (byIndex !== null) {
            if (byIndex > headerRow.length) {
                throw new Error(`csv: column index ${byIndex} out of bounds (${headerRow.length} columns)`);
            }
            return byIndex - 1;
        }
        throw new Error(`csv: column "${column}" not found in header and not a valid 1-based index`);
    }
    // header=false：只接受 1-based 索引
    const byIndex = parseIndex(column);
    if (byIndex === null) {
        throw new Error(`csv: header=false requires a 1-based numeric column, got "${column}"`);
    }
    const width = gridWidth(grid);
    if (byIndex > width) {
        throw new Error(`csv: column index ${byIndex} out of bounds (${width} columns)`);
    }
    return byIndex - 1;
}
/** 按列精确匹配过滤；返回 [结果行, 列名数组]。 */
export function queryRows(grid, options) {
    const index = resolveColumn(grid, options.column, options.header);
    const limit = normalizeLimit(options.limit);
    const dataRows = options.header && grid.length > 0 ? grid.slice(1) : grid;
    const matched = [];
    for (const row of dataRows) {
        const field = row[index];
        if (field !== undefined && field === options.value) {
            matched.push(row);
            if (matched.length >= limit)
                break;
        }
    }
    const columns = [];
    if (options.header && grid.length > 0) {
        columns.push(...grid[0]);
    }
    else {
        const width = gridWidth(grid);
        for (let i = 1; i <= width; i++)
            columns.push(String(i));
    }
    const rows = options.header && grid.length > 0 ? [grid[0], ...matched] : matched;
    return { rows, columns };
}
/** 统计：行数 / 列数 / 列名 / 空行数 / 聚合警告。 */
export function statsGrid(grid, header, emptyRows) {
    const warnings = [];
    if (grid.length === 0) {
        return { rows: 0, columns: 0, columnNames: header ? [] : null, emptyRows, warnings };
    }
    const width = gridWidth(grid);
    if (header) {
        const headerRow = grid[0];
        // 重复列名：后出现的列覆盖先出现的（与多数 CSV 库一致），并报告
        const seen = new Set();
        const duplicates = new Set();
        for (const name of headerRow) {
            if (seen.has(name))
                duplicates.add(name);
            seen.add(name);
        }
        if (duplicates.size > 0) {
            warnings.push(`duplicate column names: ${[...duplicates].join(', ')} (later ones win)`);
        }
        let fewer = 0;
        let more = 0;
        for (const row of grid.slice(1)) {
            if (row.length < headerRow.length)
                fewer++;
            else if (row.length > headerRow.length)
                more++;
        }
        if (fewer > 0) {
            warnings.push(`${fewer} data row(s) have fewer fields than the header (missing fields filled with null)`);
        }
        if (more > 0) {
            warnings.push(`${more} data row(s) have more fields than the header (extra fields merged into the last column)`);
        }
        return {
            rows: grid.length - 1,
            columns: width,
            columnNames: [...headerRow],
            emptyRows,
            warnings,
        };
    }
    // header=false：字段数不一致行数
    const first = grid[0].length;
    let inconsistent = 0;
    for (const row of grid) {
        if (row.length !== first)
            inconsistent++;
    }
    if (inconsistent > 0) {
        warnings.push(`${inconsistent} row(s) have inconsistent field counts (min ${gridMinWidth(grid)}, max ${width})`);
    }
    return { rows: grid.length, columns: width, columnNames: null, emptyRows, warnings };
}
/** 网格 → JSON 值（header=true 时对象数组；header=false 时数组数组）。 */
export function toJsonRows(grid, header, delimiter, limit) {
    const cap = normalizeLimit(limit);
    if (grid.length === 0)
        return [];
    if (!header) {
        return grid.slice(0, cap).map(row => [...row]);
    }
    const headerRow = grid[0];
    const out = [];
    for (const row of grid.slice(1, cap + 1)) {
        // 多余字段并入最后一个字段（用分隔符连接）
        const effective = row.length > headerRow.length
            ? [...row.slice(0, headerRow.length - 1), row.slice(headerRow.length - 1).join(delimiter)]
            : row;
        // null-prototype 对象：__proto__/constructor/prototype 等表头作为普通字段写入，
        // 不会被原型 setter 吞掉（JSON.stringify 对 null-prototype 对象输出不变）
        const obj = Object.create(null);
        for (let i = 0; i < headerRow.length; i++) {
            obj[headerRow[i]] = i < effective.length ? effective[i] : null;
        }
        out.push(obj);
    }
    return out;
}
