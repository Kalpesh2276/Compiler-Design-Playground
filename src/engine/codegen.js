// Engine for Intermediate Code Generation (3AC, Quadruples), Optimization, Assembly & Virtual CPU Simulator

// -------------------------------------------------------------
// 1. Generate Three-Address Code (3AC) from Expressions & Assignments
// -------------------------------------------------------------
export function generate3AC(sourceCode) {
  if (!sourceCode || sourceCode.trim() === '') {
    return { tac: [], quadruples: [], triples: [], postfix: [] };
  }

  const lines = sourceCode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));

  const tac = [];
  const quadruples = [];
  const triples = [];
  const postfixList = [];
  let tempCounter = 1;

  function newTemp() {
    return `t${tempCounter++}`;
  }

  // Shunting-yard for expressions
  function parseExpression(exprStr) {
    const tokens = exprStr.match(/([a-zA-Z_][a-zA-Z0-9_]*|\d+(\.\d+)?|\+|\-|\*|\/|\(|\))/g) || [];
    const precedence = { '*': 2, '/': 2, '+': 1, '-': 1 };
    const output = [];
    const stack = [];

    for (const tok of tokens) {
      if (/^[a-zA-Z0-9_]+(\.\d+)?$/.test(tok)) {
        output.push(tok);
      } else if (tok === '(') {
        stack.push(tok);
      } else if (tok === ')') {
        while (stack.length > 0 && stack[stack.length - 1] !== '(') {
          output.push(stack.pop());
        }
        stack.pop();
      } else if (precedence[tok]) {
        while (
          stack.length > 0 &&
          stack[stack.length - 1] !== '(' &&
          precedence[stack[stack.length - 1]] >= precedence[tok]
        ) {
          output.push(stack.pop());
        }
        stack.push(tok);
      }
    }
    while (stack.length > 0) output.push(stack.pop());
    return output;
  }

  for (const line of lines) {
    // Handle assignment: e.g. x = a + b * c
    if (line.includes('=')) {
      const parts = line.split('=');
      const targetVar = parts[0].trim().replace(/^(int|float|var)\s+/, '');
      const expr = parts[1].replace(';', '').trim();

      const postfix = parseExpression(expr);
      postfixList.push({ target: targetVar, postfix: postfix.join(' ') });

      const evalStack = [];
      for (const tok of postfix) {
        if (/[\+\-\*\/]/.test(tok)) {
          const arg2 = evalStack.pop();
          const arg1 = evalStack.pop();
          const res = newTemp();

          tac.push(`${res} = ${arg1} ${tok} ${arg2}`);
          quadruples.push({ op: tok, arg1, arg2, result: res });
          triples.push({ index: triples.length, op: tok, arg1, arg2 });
          evalStack.push(res);
        } else {
          evalStack.push(tok);
        }
      }

      const finalVal = evalStack.pop() || expr;
      tac.push(`${targetVar} = ${finalVal}`);
      quadruples.push({ op: '=', arg1: finalVal, arg2: '-', result: targetVar });
      triples.push({ index: triples.length, op: '=', arg1: finalVal, arg2: '-' });
    }
  }

  return { tac, quadruples, triples, postfixList };
}

// -------------------------------------------------------------
// 2. Code Optimization Engine
// -------------------------------------------------------------
export function optimizeCode(tacList) {
  const stepLogs = [];
  let optimizedTac = [...tacList];

  stepLogs.push(`Starting Code Optimization Pipeline...`);
  stepLogs.push(`Initial instructions count: ${optimizedTac.length}`);

  // Pass 1: Constant Folding (e.g., t1 = 4 + 5 -> t1 = 9)
  let foldCount = 0;
  optimizedTac = optimizedTac.map((line) => {
    const match = line.match(/^(t\d+|[a-zA-Z_]\w*)\s*=\s*(\d+)\s*([\+\-\*\/])\s*(\d+)$/);
    if (match) {
      const res = match[1];
      const n1 = parseFloat(match[2]);
      const op = match[3];
      const n2 = parseFloat(match[4]);
      let val = 0;
      if (op === '+') val = n1 + n2;
      else if (op === '-') val = n1 - n2;
      else if (op === '*') val = n1 * n2;
      else if (op === '/') val = n2 !== 0 ? n1 / n2 : 0;

      foldCount++;
      stepLogs.push(`Constant Folding: "${line}" -> "${res} = ${val}"`);
      return `${res} = ${val}`;
    }
    return line;
  });

  // Pass 2: Constant Propagation
  const constMap = new Map();
  optimizedTac = optimizedTac.map((line) => {
    // Check if simple const assignment: x = 5
    const constAssign = line.match(/^([a-zA-Z_]\w*)\s*=\s*(\d+)$/);
    if (constAssign) {
      constMap.set(constAssign[1], constAssign[2]);
      return line;
    }

    // Substitute known constants into expressions
    let newLine = line;
    for (const [varName, val] of constMap.entries()) {
      const regex = new RegExp(`\\b${varName}\\b`, 'g');
      if (newLine.includes('=') && newLine.indexOf('=') < newLine.indexOf(varName)) {
        newLine = newLine.replace(regex, val);
      }
    }

    if (newLine !== line) {
      stepLogs.push(`Constant Propagation: "${line}" -> "${newLine}"`);
    }

    // Re-fold if created new constants
    const reFold = newLine.match(/^(t\d+|[a-zA-Z_]\w*)\s*=\s*(\d+)\s*([\+\-\*\/])\s*(\d+)$/);
    if (reFold) {
      const res = reFold[1];
      const n1 = parseFloat(reFold[2]);
      const op = reFold[3];
      const n2 = parseFloat(reFold[4]);
      let val = 0;
      if (op === '+') val = n1 + n2;
      else if (op === '-') val = n1 - n2;
      else if (op === '*') val = n1 * n2;
      else if (op === '/') val = n2 !== 0 ? n1 / n2 : 0;
      return `${res} = ${val}`;
    }

    return newLine;
  });

  // Pass 3: Dead Code Elimination (Remove unused temporaries)
  const usedVars = new Set();
  for (const line of optimizedTac) {
    const parts = line.split('=');
    if (parts.length === 2) {
      const rhs = parts[1];
      const tokens = rhs.match(/\b[a-zA-Z_]\w*\b/g) || [];
      tokens.forEach((t) => usedVars.add(t));
    }
  }

  const initialLen = optimizedTac.length;
  optimizedTac = optimizedTac.filter((line) => {
    const parts = line.split('=');
    if (parts.length === 2) {
      const lhs = parts[0].trim();
      // Keep user variables, drop unused t_ variables
      if (lhs.startsWith('t') && !usedVars.has(lhs)) {
        stepLogs.push(`Dead Code Elimination: Removed unused temporary variable assignment "${line}"`);
        return false;
      }
    }
    return true;
  });

  stepLogs.push(`Optimization complete. Final instructions count: ${optimizedTac.length}`);

  return {
    optimizedTac,
    stepLogs,
  };
}

// -------------------------------------------------------------
// 3. Target Assembly Code Generator (Pseudo-MIPS / x86)
// -------------------------------------------------------------
export function generateAssembly(tacList) {
  const assembly = [];
  const registers = ['R0', 'R1', 'R2', 'R3'];
  let regIdx = 0;

  assembly.push('; --- Target Assembly Code Generation ---');
  assembly.push('.DATA');
  assembly.push('.CODE');

  for (const line of tacList) {
    const matchBinary = line.match(/^([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\s*([\+\-\*\/])\s*([a-zA-Z0-9_]+)$/);
    const matchAssign = line.match(/^([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)$/);

    if (matchBinary) {
      const [, res, arg1, op, arg2] = matchBinary;
      const r1 = registers[regIdx % 4];
      const r2 = registers[(regIdx + 1) % 4];

      assembly.push(`LOAD ${r1}, ${arg1}`);
      assembly.push(`LOAD ${r2}, ${arg2}`);

      if (op === '+') assembly.push(`ADD ${r1}, ${r2}`);
      else if (op === '-') assembly.push(`SUB ${r1}, ${r2}`);
      else if (op === '*') assembly.push(`MUL ${r1}, ${r2}`);
      else if (op === '/') assembly.push(`DIV ${r1}, ${r2}`);

      assembly.push(`STORE ${res}, ${r1}`);
      regIdx += 2;
    } else if (matchAssign) {
      const [, res, val] = matchAssign;
      const r1 = registers[regIdx % 4];
      assembly.push(`MOV ${r1}, ${val}`);
      assembly.push(`STORE ${res}, ${r1}`);
      regIdx++;
    }
  }

  assembly.push('HALT');
  return assembly;
}

// -------------------------------------------------------------
// 4. Virtual CPU Register & Execution Simulator
// -------------------------------------------------------------
export function simulateCPU(assemblyLines) {
  const registers = { R0: 0, R1: 0, R2: 0, R3: 0 };
  const memory = {};
  let pc = 0;
  const executionSteps = [];
  const executableInstructions = assemblyLines.filter((l) => !l.startsWith(';') && !l.startsWith('.'));

  executionSteps.push({
    step: 0,
    pc: 0,
    instruction: 'INITIALIZATION',
    registers: { ...registers },
    memory: { ...memory },
    action: 'CPU Reset and Ready',
  });

  let stepCount = 1;

  while (pc < executableInstructions.length) {
    const inst = executableInstructions[pc].trim();
    if (inst === 'HALT') {
      executionSteps.push({
        step: stepCount++,
        pc,
        instruction: inst,
        registers: { ...registers },
        memory: { ...memory },
        action: 'Execution Halted Successfully',
      });
      break;
    }

    const parts = inst.split(/[\s,]+/);
    const op = parts[0];

    if (op === 'LOAD') {
      const reg = parts[1];
      const src = parts[2];
      const val = !isNaN(Number(src)) ? Number(src) : memory[src] !== undefined ? memory[src] : 0;
      registers[reg] = val;
      executionSteps.push({
        step: stepCount++,
        pc,
        instruction: inst,
        registers: { ...registers },
        memory: { ...memory },
        action: `Loaded value ${val} into ${reg}`,
      });
    } else if (op === 'MOV') {
      const reg = parts[1];
      const src = parts[2];
      const val = !isNaN(Number(src)) ? Number(src) : memory[src] !== undefined ? memory[src] : 0;
      registers[reg] = val;
      executionSteps.push({
        step: stepCount++,
        pc,
        instruction: inst,
        registers: { ...registers },
        memory: { ...memory },
        action: `Moved value ${val} into ${reg}`,
      });
    } else if (op === 'STORE') {
      const memKey = parts[1];
      const reg = parts[2];
      memory[memKey] = registers[reg] !== undefined ? registers[reg] : 0;
      executionSteps.push({
        step: stepCount++,
        pc,
        instruction: inst,
        registers: { ...registers },
        memory: { ...memory },
        action: `Stored ${reg} (${registers[reg]}) into memory variable '${memKey}'`,
      });
    } else if (['ADD', 'SUB', 'MUL', 'DIV'].includes(op)) {
      const reg1 = parts[1];
      const reg2 = parts[2];
      const v1 = registers[reg1] || 0;
      const v2 = registers[reg2] || 0;
      let res = 0;

      if (op === 'ADD') res = v1 + v2;
      else if (op === 'SUB') res = v1 - v2;
      else if (op === 'MUL') res = v1 * v2;
      else if (op === 'DIV') res = v2 !== 0 ? Math.floor(v1 / v2) : 0;

      registers[reg1] = res;
      executionSteps.push({
        step: stepCount++,
        pc,
        instruction: inst,
        registers: { ...registers },
        memory: { ...memory },
        action: `Executed ${op}: ${reg1} = ${res}`,
      });
    }

    pc++;
  }

  return {
    executionSteps,
    finalRegisters: registers,
    finalMemory: memory,
  };
}
