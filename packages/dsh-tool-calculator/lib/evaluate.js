/**
 * 零依赖、无 eval / new Function 的数学表达式求值器。
 *
 * 安全模型：词法层只识别数字、白名单标识符、运算符；
 * 语法层按优先级递归下降求值；标识符按名查白名单表，查不到即抛错。
 * 任何形式的代码注入（constructor.constructor 链、process 全局、
 * 引号注入、分号语句等）均被词法/语法层拒绝。
 *
 * 白名单边界（审查 CALC-01）：FUNCTIONS/CONSTANTS 用 Object.hasOwn 判断，
 * 不落入 Object.prototype 继承属性（constructor/toString/__proto__ 等）。
 */
const FUNCTIONS = {
    abs: { fn: Math.abs, minArgs: 1, maxArgs: 1 },
    ceil: { fn: Math.ceil, minArgs: 1, maxArgs: 1 },
    floor: { fn: Math.floor, minArgs: 1, maxArgs: 1 },
    round: { fn: Math.round, minArgs: 1, maxArgs: 1 },
    sqrt: { fn: Math.sqrt, minArgs: 1, maxArgs: 1 },
    pow: { fn: Math.pow, minArgs: 2, maxArgs: 2 },
    log: { fn: Math.log, minArgs: 1, maxArgs: 1 },
    log2: { fn: Math.log2, minArgs: 1, maxArgs: 1 },
    log10: { fn: Math.log10, minArgs: 1, maxArgs: 1 },
    exp: { fn: Math.exp, minArgs: 1, maxArgs: 1 },
    sin: { fn: Math.sin, minArgs: 1, maxArgs: 1 },
    cos: { fn: Math.cos, minArgs: 1, maxArgs: 1 },
    tan: { fn: Math.tan, minArgs: 1, maxArgs: 1 },
    max: { fn: Math.max, minArgs: 1, maxArgs: Infinity },
    min: { fn: Math.min, minArgs: 1, maxArgs: Infinity },
};
const CONSTANTS = {
    PI: Math.PI, E: Math.E,
};
const MAX_EXPRESSION_LENGTH = 500;
/** 词法分析：将输入字符串拆分为 token 数组 */
function tokenize(input) {
    const tokens = [];
    for (let i = 0; i < input.length;) {
        const ch = input.charAt(i);
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < input.length && /[0-9]/.test(input.charAt(i + 1)))) {
            const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(input.slice(i));
            if (!m)
                throw new Error(`Invalid number at position ${i}`);
            // CALC-06：数字后紧跟 e/E 是科学计数法形态（含 1e、1e+、1e-5），专门报错
            if (/[eE]/.test(input.charAt(i + m[0].length))) {
                throw new Error('Scientific notation is not supported');
            }
            tokens.push(m[0]);
            i += m[0].length;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            const m = /^[A-Za-z_]\w*/.exec(input.slice(i));
            if (!m)
                throw new Error(`Invalid identifier at position ${i}`);
            tokens.push(m[0]);
            i += m[0].length;
            continue;
        }
        if (ch === '*' && input.charAt(i + 1) === '*') {
            tokens.push('**');
            i += 2;
            continue;
        }
        if ('+-*/%(),'.includes(ch)) {
            tokens.push(ch);
            i++;
            continue;
        }
        throw new Error(`Invalid character "${ch}" at position ${i}`);
    }
    return tokens;
}
/** 语法分析 + 求值（递归下降，按运算符优先级） */
function parse(input) {
    const tokens = tokenize(input);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++];
    // 加减（最低优先级）
    const parseAdd = () => {
        let left = parseMul();
        while (peek() === '+' || peek() === '-') {
            const op = take();
            const right = parseMul();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    };
    // 乘除取模
    const parseMul = () => {
        let left = parseUnary();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = take();
            const right = parseUnary();
            left = op === '*' ? left * right : op === '/' ? left / right : left % right;
        }
        return left;
    };
    // 一元正负
    const parseUnary = () => {
        if (peek() === '-' || peek() === '+') {
            const op = take();
            return op === '-' ? -parseUnary() : parseUnary();
        }
        return parsePower();
    };
    // 幂（右结合）
    const parsePower = () => {
        const base = parsePrimary();
        if (peek() === '**') {
            take();
            return base ** parseUnary();
        }
        return base;
    };
    // 原子：数字 / 常量 / 函数调用 / 括号
    const parsePrimary = () => {
        const t = take();
        if (t === undefined)
            throw new Error('Unexpected end of expression');
        if (t === '(') {
            const value = parseAdd();
            if (take() !== ')')
                throw new Error('Missing closing parenthesis');
            return value;
        }
        if (t === ')')
            throw new Error('Unexpected ")"');
        if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t))
            return Number(t);
        if (/^[A-Za-z_]\w*$/.test(t)) {
            // CALC-01：own-property 白名单（Object.hasOwn 不落入原型链）
            if (Object.hasOwn(CONSTANTS, t)) {
                if (peek() === '(')
                    throw new Error(`"${t}" is a constant, not a function`);
                return CONSTANTS[t];
            }
            if (Object.hasOwn(FUNCTIONS, t)) {
                if (take() !== '(')
                    throw new Error(`Missing "(" after function "${t}"`);
                const args = [];
                if (peek() !== ')') {
                    args.push(parseAdd());
                    while (peek() === ',') {
                        take();
                        args.push(parseAdd());
                    }
                }
                if (take() !== ')')
                    throw new Error(`Missing ")" after arguments of "${t}"`);
                // CALC-02：参数个数契约校验
                const spec = FUNCTIONS[t];
                if (args.length < spec.minArgs || args.length > spec.maxArgs) {
                    const expected = spec.minArgs === spec.maxArgs
                        ? String(spec.minArgs)
                        : `at least ${spec.minArgs}`;
                    throw new Error(`Invalid argument count for "${t}": expected ${expected}, got ${args.length}`);
                }
                return spec.fn(...args);
            }
            throw new Error(`Unknown identifier "${t}"`);
        }
        throw new Error(`Unexpected token "${t}"`);
    };
    const value = parseAdd();
    if (pos < tokens.length)
        throw new Error(`Unexpected token "${tokens[pos]}"`);
    return value;
}
/**
 * 公开接口：求值表达式，返回有限数字；NaN/Infinity 或其他错误均抛错。
 * CALC-05：入口独立校验类型（不依赖上游 schema 校验）。
 */
export function evaluate(expression) {
    if (typeof expression !== 'string') {
        throw new Error('calculator: expression must be a string');
    }
    if (expression.length > MAX_EXPRESSION_LENGTH) {
        throw new Error(`Expression too long (${expression.length} > ${MAX_EXPRESSION_LENGTH})`);
    }
    const result = parse(expression);
    if (typeof result !== 'number' || !Number.isFinite(result)) {
        throw new Error('Expression did not evaluate to a finite number');
    }
    return result;
}
