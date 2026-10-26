// Display helpers that turn IR and target code into listing lines / CFG view models.
import { formatInstruction } from '../../engine/ir.js';
import { formatTargetInstruction } from '../../engine/virtualCPU.js';

export function irLines(instructions) {
  return instructions.map((ins) => ({ text: ins.op === 'label' ? formatInstruction(ins) : `  ${formatInstruction(ins)}`, kind: ins.op === 'label' ? 'label' : undefined }));
}

export function cfgDisplay(cfg) {
  return {
    blocks: cfg.blocks.map((b) => ({ id: b.id, lines: b.instructions.map((ins) => (ins.op === 'label' ? formatInstruction(ins) : `  ${formatInstruction(ins)}`)) })),
    edges: cfg.edges,
  };
}

export function annotatedTargetLines(code, irInstructions) {
  const lines = [];
  let lastIr = null;
  code.forEach((ins, i) => {
    if (ins.op !== 'LABEL' && ins.irIndex !== null && ins.irIndex !== undefined && ins.irIndex !== lastIr) {
      lastIr = ins.irIndex;
      const src = irInstructions[ins.irIndex];
      if (src && src.op !== 'label') lines.push({ text: `; ${formatInstruction(src)}`, kind: 'comment', key: `c${i}` });
    }
    if (ins.op === 'LABEL') {
      lastIr = null;
      lines.push({ text: formatTargetInstruction(ins), kind: 'label', key: i });
    } else {
      lines.push({ text: `  ${formatTargetInstruction(ins)}`, key: i });
    }
  });
  return lines;
}

