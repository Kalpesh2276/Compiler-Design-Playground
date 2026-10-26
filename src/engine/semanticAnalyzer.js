// MiniC semantic analysis: name resolution with nested scopes + type checking.
//
// Input:  AST from parser.js (not modified).
// Output: {
//   symbols:     Symbol[]                 every declared variable, in declaration order
//   scopes:      Scope[]                  scope tree (id, parentId, depth, kind, symbolIds)
//   types:       Map<nodeId, 'int'|'bool'|'error'>   type of every expression node
//   resolutions: Map<identifierNodeId | declNodeId | assignNodeId, symbolId>
//   diagnostics: Diagnostic[]
// }
// Symbol = { id, name, uniqueName, type, scopeId, depth, declaredAt: span, declNodeId,
//            references, assignments, initialized }
//
// `uniqueName` is the name used by later phases. It equals the source name unless the
// declaration shadows another variable, in which case it becomes `name.N` – the dot
// cannot appear in identifiers, so unique names never collide with user names.
//
// Type 'error' marks an expression whose type could not be determined; it is accepted
// silently by enclosing checks so one mistake does not produce a cascade of errors.

import { error, warning } from '../pipeline/diagnostics.js';

const ARITH = new Set(['+', '-', '*', '/', '%']);
const RELATIONAL = new Set(['<', '<=', '>', '>=']);
const EQUALITY = new Set(['==', '!=']);
const LOGICAL = new Set(['&&', '||']);

export function analyzeProgram(ast) {
  const diagnostics = [];
  const symbols = [];
  const scopes = [];
  const types = new Map();
  const resolutions = new Map();
  const nameCounts = new Map(); // source name -> number of declarations so far

  let current = null;

  function openScope(kind, span) {
    const scope = {
      id: scopes.length,
      parentId: current ? current.id : null,
      depth: current ? current.depth + 1 : 0,
      kind,
      span,
      names: new Map(),
      symbolIds: [],
    };
    scopes.push(scope);
    current = scope;
  }

  function closeScope() {
    current = current.parentId === null ? null : scopes[current.parentId];
  }

  function lookup(name) {
    for (let s = current; s; s = s.parentId === null ? null : scopes[s.parentId]) {
      if (s.names.has(name)) return symbols[s.names.get(name)];
    }
    return null;
  }

  function declare(decl) {
    const existing = current.names.get(decl.name);
    if (existing !== undefined) {
      const prev = symbols[existing];
      diagnostics.push(error('semantic', 'duplicate-declaration',
        `'${decl.name}' is already declared in this scope (line ${prev.declaredAt.line}).`, decl.nameSpan));
      return null;
    }
    const outer = lookup(decl.name);
    if (outer) {
      diagnostics.push(warning('semantic', 'shadowing',
        `Declaration of '${decl.name}' shadows the variable declared at line ${outer.declaredAt.line}.`, decl.nameSpan));
    }
    const count = (nameCounts.get(decl.name) || 0) + 1;
    nameCounts.set(decl.name, count);
    const symbol = {
      id: symbols.length,
      name: decl.name,
      uniqueName: count === 1 ? decl.name : `${decl.name}.${count}`,
      type: decl.varType,
      scopeId: current.id,
      depth: current.depth,
      declaredAt: decl.nameSpan,
      declNodeId: decl.id,
      references: 0,
      assignments: decl.init ? 1 : 0,
      initialized: true, // explicit initializer or default zero value
    };
    symbols.push(symbol);
    current.names.set(decl.name, symbol.id);
    current.symbolIds.push(symbol.id);
    resolutions.set(decl.id, symbol.id);
    return symbol;
  }

  function expectType(expr, expected, context) {
    const actual = checkExpr(expr);
    if (actual !== 'error' && actual !== expected) {
      diagnostics.push(error('semantic', 'type-mismatch',
        `${context} must be ${expected} but has type ${actual}.`, expr.span));
    }
    return actual;
  }

  // ------------------------------------------------------------ statements
  function checkStmt(stmt) {
    switch (stmt.kind) {
      case 'VarDecl': {
        // The initializer is checked before the name enters scope.
        if (stmt.init) {
          const t = checkExpr(stmt.init);
          if (t !== 'error' && t !== stmt.varType) {
            diagnostics.push(error('semantic', 'type-mismatch',
              `Cannot initialise ${stmt.varType} variable '${stmt.name}' with a value of type ${t}.`, stmt.init.span));
          }
        }
        declare(stmt);
        break;
      }
      case 'Assign': {
        const sym = lookup(stmt.name);
        const t = checkExpr(stmt.value);
        if (!sym) {
          diagnostics.push(error('semantic', 'undeclared-variable',
            `Assignment to undeclared variable '${stmt.name}'.`, stmt.nameSpan));
          break;
        }
        sym.assignments++;
        resolutions.set(stmt.id, sym.id);
        if (t !== 'error' && t !== sym.type) {
          diagnostics.push(error('semantic', 'type-mismatch',
            `Cannot assign a value of type ${t} to ${sym.type} variable '${stmt.name}'.`, stmt.value.span));
        }
        break;
      }
      case 'Print':
        checkExpr(stmt.value);
        break;
      case 'If':
        expectType(stmt.condition, 'bool', "The 'if' condition");
        checkStmt(stmt.then);
        if (stmt.otherwise) checkStmt(stmt.otherwise);
        break;
      case 'While':
        expectType(stmt.condition, 'bool', "The 'while' condition");
        checkStmt(stmt.body);
        break;
      case 'Block':
        openScope('block', stmt.span);
        stmt.body.forEach(checkStmt);
        closeScope();
        break;
      default:
        throw new Error(`Semantic analyzer: unknown statement kind '${stmt.kind}'.`);
    }
  }

  // ----------------------------------------------------------- expressions
  function checkExpr(expr) {
    const t = typeOf(expr);
    types.set(expr.id, t);
    return t;
  }

  function typeOf(expr) {
    switch (expr.kind) {
      case 'IntLiteral':
        return 'int';
      case 'BoolLiteral':
        return 'bool';
      case 'Input':
        return 'int';
      case 'Identifier': {
        const sym = lookup(expr.name);
        if (!sym) {
          diagnostics.push(error('semantic', 'undeclared-variable',
            `Use of undeclared variable '${expr.name}'.`, expr.span));
          return 'error';
        }
        sym.references++;
        resolutions.set(expr.id, sym.id);
        return sym.type;
      }
      case 'Unary': {
        const operandType = checkExpr(expr.operand);
        const want = expr.operator === '-' ? 'int' : 'bool';
        if (operandType === 'error') return 'error';
        if (operandType !== want) {
          diagnostics.push(error('semantic', 'type-mismatch',
            `Unary '${expr.operator}' needs a ${want} operand but got ${operandType}.`, expr.span));
          return 'error';
        }
        return want;
      }
      case 'Binary': {
        const l = checkExpr(expr.left);
        const r = checkExpr(expr.right);
        const op = expr.operator;
        if (l === 'error' || r === 'error') {
          return ARITH.has(op) ? 'int' : 'bool';
        }
        if (ARITH.has(op) || RELATIONAL.has(op)) {
          if (l !== 'int' || r !== 'int') {
            diagnostics.push(error('semantic', 'type-mismatch',
              `Operator '${op}' needs int operands but got ${l} and ${r}.`, expr.span));
            return 'error';
          }
          return ARITH.has(op) ? 'int' : 'bool';
        }
        if (EQUALITY.has(op)) {
          if (l !== r) {
            diagnostics.push(error('semantic', 'type-mismatch',
              `Operator '${op}' compares values of different types (${l} and ${r}).`, expr.span));
            return 'error';
          }
          return 'bool';
        }
        if (LOGICAL.has(op)) {
          if (l !== 'bool' || r !== 'bool') {
            diagnostics.push(error('semantic', 'type-mismatch',
              `Operator '${op}' needs bool operands but got ${l} and ${r}.`, expr.span));
            return 'error';
          }
          return 'bool';
        }
        throw new Error(`Semantic analyzer: unknown operator '${op}'.`);
      }
      default:
        throw new Error(`Semantic analyzer: unknown expression kind '${expr.kind}'.`);
    }
  }

  // ------------------------------------------------------------------ entry
  if (!ast || ast.kind !== 'Program') throw new Error('analyzeProgram expects a Program AST node.');
  openScope('global', ast.span);
  ast.body.forEach(checkStmt);
  closeScope();

  for (const sym of symbols) {
    if (sym.references === 0) {
      diagnostics.push(warning('semantic', 'unused-variable',
        `Variable '${sym.name}' is never read.`, sym.declaredAt));
    }
  }

  return {
    symbols,
    scopes: scopes.map((s) => ({
      id: s.id,
      parentId: s.parentId,
      depth: s.depth,
      kind: s.kind,
      span: s.span,
      symbolIds: s.symbolIds,
    })),
    types,
    resolutions,
    diagnostics,
  };
}
