// Safe math expressions for board plots: a tokenizer and a recursive-descent parser that
// build closures. No eval, so it works under the app's Content Security Policy and can be
// shared by the server (validation) and the browser (sampling).

const MAX_LENGTH = 120;

const functions = new Map([
  ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan],
  ['asin', Math.asin], ['acos', Math.acos], ['atan', Math.atan],
  ['sqrt', Math.sqrt], ['abs', Math.abs], ['exp', Math.exp],
  ['ln', Math.log], ['log', Math.log10]
]);
const constants = new Map([['pi', Math.PI], ['e', Math.E]]);

function tokenize(source) {
  const tokens = [];
  const pattern = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-z]+)|([-+*/^()])/y;
  let index = 0;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError('Unexpected character "' + source[index] + '"');
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'name', value: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: match[3] });
  }
  return tokens;
}

function parse(tokens) {
  let position = 0;
  let previous = null;
  const peek = () => tokens[position];
  const take = () => (previous = tokens[position++]);
  const expect = (type) => {
    if (peek()?.type !== type) throw new SyntaxError('Expected "' + type + '"');
    take();
  };

  function expression() {
    let left = term();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = take().type;
      const right = term();
      const l = left;
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  }

  function startsImplicitFactor() {
    const next = peek();
    if (!next || !previous) return false;
    const afterValue = previous.type === 'number' || previous.type === ')';
    return afterValue && (next.type === 'name' || next.type === '(');
  }

  function term() {
    let left = unary();
    for (;;) {
      const next = peek()?.type;
      let op;
      if (next === '*' || next === '/') op = take().type;
      else if (startsImplicitFactor()) op = '*';
      else return left;
      const right = unary();
      const l = left;
      left = op === '*' ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
    }
  }

  function unary() {
    if (peek()?.type === '-') {
      take();
      const operand = unary();
      return (x) => -operand(x);
    }
    if (peek()?.type === '+') {
      take();
      return unary();
    }
    return power();
  }

  function power() {
    const base = primary();
    if (peek()?.type !== '^') return base;
    take();
    const exponent = unary();
    return (x) => base(x) ** exponent(x);
  }

  function primary() {
    const token = peek();
    if (!token) throw new SyntaxError('Unexpected end of expression');
    if (token.type === 'number') {
      take();
      const value = token.value;
      return () => value;
    }
    if (token.type === '(') {
      take();
      const inner = expression();
      expect(')');
      return inner;
    }
    if (token.type === 'name') {
      take();
      if (token.value === 'x') return (x) => x;
      if (constants.has(token.value)) {
        const value = constants.get(token.value);
        return () => value;
      }
      if (functions.has(token.value)) {
        const fn = functions.get(token.value);
        expect('(');
        const argument = expression();
        expect(')');
        return (x) => fn(argument(x));
      }
      throw new SyntaxError('Unknown name "' + token.value + '"');
    }
    throw new SyntaxError('Unexpected "' + token.type + '"');
  }

  const result = expression();
  if (position !== tokens.length) throw new SyntaxError('Unexpected "' + tokens[position].type + '"');
  return result;
}

export function parseExpression(source) {
  if (typeof source !== 'string') return { ok: false, error: 'Expression must be text.' };
  const text = source.trim();
  if (!text) return { ok: false, error: 'Expression is empty.' };
  if (source.length > MAX_LENGTH) return { ok: false, error: 'Expression is too long.' };
  try {
    return { ok: true, evaluate: parse(tokenize(text)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Samples a function into polyline segments in data coordinates. A segment ends at an
// undefined value or where the curve jumps from above the range to below it (or back),
// which is how asymptotes show up. Values are clamped to keep coordinates sane.
export function sampleFunction(evaluate, [a, b], [yMin, yMax], samples = 200) {
  const span = yMax - yMin;
  const low = yMin - 2 * span;
  const high = yMax + 2 * span;
  const segments = [];
  let current = [];
  let previousY = null;
  const close = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
    previousY = null;
  };
  for (let i = 0; i <= samples; i += 1) {
    const x = a + ((b - a) * i) / samples;
    const y = evaluate(x);
    if (!Number.isFinite(y)) {
      close();
      continue;
    }
    if (previousY !== null && ((previousY > yMax && y < yMin) || (previousY < yMin && y > yMax))) close();
    current.push([x, Math.min(high, Math.max(low, y))]);
    previousY = y;
  }
  close();
  return segments;
}
