// Presentation helpers that turn the parser's AST into display structures.
// Pure functions: the AST itself is never modified.
import { astChildren } from '../../engine/parser.js';

export function nodeLabel(n) {
  switch (n.kind) {
    case 'Program':
      return 'program';
    case 'VarDecl':
      return `${n.varType} ${n.name}`;
    case 'Assign':
      return `${n.name} =`;
    case 'Print':
      return 'print';
    case 'If':
      return n.otherwise ? 'if-else' : 'if';
    case 'While':
      return 'while';
    case 'Block':
      return '{ }';
    case 'Binary':
      return n.operator;
    case 'Unary':
      return n.operator === '-' ? 'neg' : '!';
    case 'IntLiteral':
      return String(n.value);
    case 'BoolLiteral':
      return String(n.value);
    case 'Identifier':
      return n.name;
    case 'Input':
      return 'input()';
    default:
      return n.kind;
  }
}

/** Convert to the { id, label, sublabel, children } shape used by ParseTreeVisualizer. */
export function toDisplayTree(ast, types = null) {
  const convert = (n) => ({
    id: n.id,
    label: nodeLabel(n),
    sublabel: types && types.has(n.id) ? `: ${types.get(n.id)}` : undefined,
    children: astChildren(n).map(convert),
  });
  return convert(ast);
}

export function countNodes(ast) {
  let count = 0;
  const visit = (n) => {
    count++;
    astChildren(n).forEach(visit);
  };
  visit(ast);
  return count;
}
