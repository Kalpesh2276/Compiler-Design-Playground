// Integer semantics shared by the constant folder, the IR interpreter and the virtual CPU.
// Keeping one implementation guarantees that compile-time folding and run-time execution
// can never disagree (bug B7 in the legacy optimizer came from exactly such a mismatch).
//
// MiniC ints are 32-bit two's complement:
//   + - *   wrap around on overflow
//   /       truncates toward zero (C semantics); INT_MIN / -1 wraps to INT_MIN
//   %       result has the sign of the dividend (C semantics)
//   / or % by zero throws ArithmeticError
//   comparisons and '!' produce 1 (true) or 0 (false)

export class ArithmeticError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArithmeticError';
  }
}

export const toInt32 = (n) => n | 0;

export const BINARY_OPERATORS = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!='];
export const RELATIONAL_OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
export const UNARY_OPERATORS = ['-', '!'];

export function evalBinary(op, a, b) {
  switch (op) {
    case '+':
      return (a + b) | 0;
    case '-':
      return (a - b) | 0;
    case '*':
      return Math.imul(a, b);
    case '/':
      if (b === 0) throw new ArithmeticError('Division by zero.');
      return Math.trunc(a / b) | 0;
    case '%':
      if (b === 0) throw new ArithmeticError('Modulo by zero.');
      return (a % b) | 0;
    case '<':
      return a < b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '==':
      return a === b ? 1 : 0;
    case '!=':
      return a !== b ? 1 : 0;
    default:
      throw new Error(`Unknown binary operator '${op}'.`);
  }
}

export function evalUnary(op, a) {
  switch (op) {
    case '-':
      return -a | 0;
    case '!':
      return a === 0 ? 1 : 0;
    default:
      throw new Error(`Unknown unary operator '${op}'.`);
  }
}

/** Relational operator whose truth value is the negation of `op`. */
export function negateRelop(op) {
  return { '<': '>=', '<=': '>', '>': '<=', '>=': '<', '==': '!=', '!=': '==' }[op];
}

/** Operator `op'` such that `a op b` ⇔ `b op' a`. */
export function swapRelop(op) {
  return { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' }[op];
}

/** True if evaluating `op` with these (possibly unknown) operands can raise an error. */
export function mayTrap(op, rightConst) {
  return (op === '/' || op === '%') && (rightConst === undefined || rightConst === 0);
}
