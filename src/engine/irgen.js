// Intermediate code generation: type-checked AST -> three-address code (see ir.js).
//
// Translation scheme (syntax-directed, Dragon Book §6.4–6.6):
//   * Expressions produce an operand; every operator application gets a fresh temporary
//     unless the expression is the whole right-hand side of an assignment, in which case
//     the result is written to the variable directly (x = a + b, not t1 = a + b; x = t1).
//   * Boolean expressions in conditions use *jumping code*: genCond(e, T, F) jumps to T
//     when e is true and to F when false; either label may be FALL (fall through). This
//     gives short-circuit evaluation of && and || with no temporaries.
//   * Comparisons used as values compute 0/1 with a binary instruction (t = a < b);
//     && / || used as values are materialised with jumping code (t = 1 / t = 0).
//   * if:    genCond(c, FALL, Lelse); then; goto Lend; Lelse: else; Lend:
//   * while: Lbegin: genCond(c, FALL, Lend); body; goto Lbegin; Lend:
//   * A declaration without initializer stores 0 so re-entering a loop body resets it.
//
// Input:  ast (parser.js) + semantic result (semanticAnalyzer.js), which must be error-free.
// Output: { instructions, temps: string[], labels: string[], variables: [{name, type}] }

import { varOp, tempOp, constOp } from './ir.js';

const FALL = null;
const RELOPS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const NEGATE = { '<': '>=', '<=': '>', '>': '<=', '>=': '<', '==': '!=', '!=': '==' };

export function generateIR(ast, semantic) {
  const { symbols, resolutions, types } = semantic;
  const instructions = [];
  const temps = [];
  const labels = [];

  // Temporaries/labels must not collide with user variable names.
  const reserved = new Set(symbols.map((s) => s.uniqueName));
  let tempCounter = 0;
  let labelCounter = 0;
  const newTemp = () => {
    let name;
    do name = `t${++tempCounter}`; while (reserved.has(name));
    temps.push(name);
    return tempOp(name);
  };
  const newLabel = () => {
    let name;
    do name = `L${++labelCounter}`; while (reserved.has(name));
    labels.push(name);
    return name;
  };

  let currentSpan = null;
  const emit = (ins) => instructions.push(currentSpan ? { ...ins, span: currentSpan } : ins);

  const symbolFor = (nodeId) => {
    const id = resolutions.get(nodeId);
    if (id === undefined) throw new Error(`IR generation: unresolved name at node ${nodeId} (run semantic analysis first).`);
    return symbols[id];
  };
  const typeOf = (expr) => types.get(expr.id);

  // ------------------------------------------------------------ expressions
  /** Evaluate `expr`; if `dest` is given the value is written there. Returns an operand. */
  function genExpr(expr, dest = null) {
    switch (expr.kind) {
      case 'IntLiteral':
        return deliver(constOp(expr.value), dest);
      case 'BoolLiteral':
        return deliver(constOp(expr.value ? 1 : 0), dest);
      case 'Identifier':
        return deliver(varOp(symbolFor(expr.id).uniqueName), dest);
      case 'Input': {
        const target = dest ?? newTemp();
        emit({ op: 'input', dest: target });
        return target;
      }
      case 'Unary': {
        const src = genExpr(expr.operand);
        const target = dest ?? newTemp();
        emit({ op: 'unary', operator: expr.operator, dest: target, src });
        return target;
      }
      case 'Binary': {
        if (expr.operator === '&&' || expr.operator === '||') return materialiseBool(expr, dest);
        const left = genExpr(expr.left);
        const right = genExpr(expr.right);
        const target = dest ?? newTemp();
        emit({ op: 'binary', operator: expr.operator, dest: target, left, right });
        return target;
      }
      default:
        throw new Error(`IR generation: unknown expression kind '${expr.kind}'.`);
    }
  }

  function deliver(operand, dest) {
    if (!dest) return operand;
    emit({ op: 'assign', dest, src: operand });
    return dest;
  }

  /** t = 1 if expr else 0, via jumping code. */
  function materialiseBool(expr, dest) {
    const target = dest ?? newTemp();
    const falseLabel = newLabel();
    const endLabel = newLabel();
    genCond(expr, FALL, falseLabel);
    emit({ op: 'assign', dest: target, src: constOp(1) });
    emit({ op: 'goto', target: endLabel });
    emit({ op: 'label', name: falseLabel });
    emit({ op: 'assign', dest: target, src: constOp(0) });
    emit({ op: 'label', name: endLabel });
    return target;
  }

  // ----------------------------------------------------------- jumping code
  function genCond(expr, trueLabel, falseLabel) {
    if (expr.kind === 'BoolLiteral') {
      const target = expr.value ? trueLabel : falseLabel;
      if (target !== FALL) emit({ op: 'goto', target });
      return;
    }
    if (expr.kind === 'Unary' && expr.operator === '!') {
      genCond(expr.operand, falseLabel, trueLabel);
      return;
    }
    if (expr.kind === 'Binary' && expr.operator === '&&') {
      const f = falseLabel === FALL ? newLabel() : falseLabel;
      genCond(expr.left, FALL, f);
      genCond(expr.right, trueLabel, falseLabel);
      if (falseLabel === FALL) emit({ op: 'label', name: f });
      return;
    }
    if (expr.kind === 'Binary' && expr.operator === '||') {
      const t = trueLabel === FALL ? newLabel() : trueLabel;
      genCond(expr.left, t, FALL);
      genCond(expr.right, trueLabel, falseLabel);
      if (trueLabel === FALL) emit({ op: 'label', name: t });
      return;
    }
    if (expr.kind === 'Binary' && RELOPS.has(expr.operator)) {
      const left = genExpr(expr.left);
      const right = genExpr(expr.right);
      emitBranch(expr.operator, left, right, trueLabel, falseLabel);
      return;
    }
    // Any other bool-valued expression (variable, bool equality result, …): test != 0.
    if (typeOf(expr) !== 'bool') throw new Error('IR generation: condition is not boolean.');
    const value = genExpr(expr);
    emitBranch('!=', value, constOp(0), trueLabel, falseLabel);
  }

  function emitBranch(relop, left, right, trueLabel, falseLabel) {
    if (trueLabel !== FALL && falseLabel !== FALL) {
      emit({ op: 'if', operator: relop, left, right, target: trueLabel });
      emit({ op: 'goto', target: falseLabel });
    } else if (trueLabel !== FALL) {
      emit({ op: 'if', operator: relop, left, right, target: trueLabel });
    } else if (falseLabel !== FALL) {
      emit({ op: 'if', operator: NEGATE[relop], left, right, target: falseLabel });
    }
  }

  // ------------------------------------------------------------- statements
  function genStmt(stmt) {
    currentSpan = stmt.span;
    switch (stmt.kind) {
      case 'VarDecl': {
        const dest = varOp(symbolFor(stmt.id).uniqueName);
        if (stmt.init) genExpr(stmt.init, dest);
        else emit({ op: 'assign', dest, src: constOp(0) });
        break;
      }
      case 'Assign':
        genExpr(stmt.value, varOp(symbolFor(stmt.id).uniqueName));
        break;
      case 'Print': {
        const value = genExpr(stmt.value);
        emit({ op: 'print', src: value, valueType: typeOf(stmt.value) });
        break;
      }
      case 'If': {
        const elseLabel = newLabel();
        genCond(stmt.condition, FALL, elseLabel);
        genStmt(stmt.then);
        if (stmt.otherwise) {
          const endLabel = newLabel();
          currentSpan = stmt.span;
          emit({ op: 'goto', target: endLabel });
          emit({ op: 'label', name: elseLabel });
          genStmt(stmt.otherwise);
          currentSpan = stmt.span;
          emit({ op: 'label', name: endLabel });
        } else {
          currentSpan = stmt.span;
          emit({ op: 'label', name: elseLabel });
        }
        break;
      }
      case 'While': {
        const begin = newLabel();
        const end = newLabel();
        emit({ op: 'label', name: begin });
        genCond(stmt.condition, FALL, end);
        genStmt(stmt.body);
        currentSpan = stmt.span;
        emit({ op: 'goto', target: begin });
        emit({ op: 'label', name: end });
        break;
      }
      case 'Block':
        stmt.body.forEach(genStmt);
        break;
      default:
        throw new Error(`IR generation: unknown statement kind '${stmt.kind}'.`);
    }
  }

  if (!ast || ast.kind !== 'Program') throw new Error('generateIR expects a Program AST node.');
  ast.body.forEach(genStmt);

  return {
    instructions,
    temps,
    labels,
    variables: symbols.map((s) => ({ name: s.uniqueName, sourceName: s.name, type: s.type })),
  };
}
