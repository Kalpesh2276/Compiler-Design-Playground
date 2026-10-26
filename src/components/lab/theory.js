// Theory notes for the Algorithm Lab, keyed by lab topic id.
//
// Section = { id, title, blocks, complexity?, reference? }
// Block   = 'paragraph text'
//         | { steps: string[] }              numbered algorithm
//         | { formula: string }              monospace block (equations, rules)
//         | { table: { head: [], rows: [[]] } }
//         | { example: string, label? }      worked example (monospace)
//         | { note: string }                 pitfall / remark callout
// Inline markup in text: `code` and **bold**.
//
// References: "Dragon Book" = Aho, Lam, Sethi, Ullman, Compilers: Principles, Techniques,
// and Tools, 2nd ed. (2006).

export const THEORY = {
  // ======================================================================= 1
  automata: [
    {
      id: 'regex',
      title: 'Regular expressions',
      blocks: [
        'A **regular expression** describes a set of strings (a regular language) over an alphabet Σ. Lexical analysers use them to specify token patterns such as identifiers and numbers.',
        {
          table: {
            head: ['Expression', 'Language', 'Meaning'],
            rows: [
              ['`ε`', '{ε}', 'the empty string'],
              ['`a`', '{a}', 'one symbol'],
              ['`r|s`', 'L(r) ∪ L(s)', 'union (alternation)'],
              ['`rs`', 'L(r)·L(s)', 'concatenation'],
              ['`r*`', 'L(r)⁰ ∪ L(r)¹ ∪ …', 'Kleene star: zero or more'],
              ['`r+`', 'L(r)·L(r)*', 'one or more'],
              ['`r?`', 'L(r) ∪ {ε}', 'optional'],
            ],
          },
        },
        'Precedence from highest to lowest: `* + ?` (postfix), concatenation, `|`. The tool first inserts an explicit concatenation operator `.` and converts the expression to **postfix** with the shunting-yard algorithm, e.g. `(a|b)*abb` → `ab|*a.b.b.`.',
      ],
      reference: 'Dragon Book §3.3',
    },
    {
      id: 'thompson',
      title: "Thompson's construction (regex → NFA)",
      blocks: [
        'Thompson builds an ε-NFA by structural induction over the regex. Every fragment has exactly **one start state and one accepting state**, and no transitions leave the accepting state – which makes fragments easy to glue together.',
        {
          steps: [
            'Symbol `a`: new states i, f with i —a→ f.',
            'Concatenation `st`: ε-edge from the accept state of N(s) to the start of N(t).',
            'Union `s|t`: new start i with ε-edges to both starts; ε-edges from both accept states to a new accept f.',
            'Star `s*`: new i and f; ε-edges i→start(s), i→f, accept(s)→start(s) (loop) and accept(s)→f.',
            'Process the postfix expression with a stack of fragments; the single fragment left at the end is the NFA.',
          ],
        },
        'Properties: at most 2·|r| states, each state has at most two outgoing ε-edges or one symbol edge.',
      ],
      complexity: 'O(|r|) states and transitions; linear time.',
      reference: 'Dragon Book §3.7.4 (Algorithm 3.23)',
    },
    {
      id: 'subset',
      title: 'ε-closure and subset construction (NFA → DFA)',
      blocks: [
        'An NFA can be in a **set** of states at once. The subset construction makes each DFA state stand for one such set.',
        {
          formula: 'ε-closure(T) = T ∪ every state reachable from T using only ε-edges\nmove(T, a)    = { t | some s ∈ T has s —a→ t }\nDtran[T, a]   = ε-closure(move(T, a))',
        },
        {
          steps: [
            'D0 = ε-closure({start}); mark it unprocessed.',
            'While an unprocessed DFA state T exists: for each symbol a compute U = ε-closure(move(T, a)).',
            'If U is non-empty and new, add it as a DFA state. Record the transition T —a→ U.',
            'A DFA state is accepting if it contains an NFA accepting state.',
          ],
        },
        { example: '(a|b)*abb  →  5 DFA states; the textbook minimal DFA has 4.', label: 'Example' },
        { note: 'In the worst case the DFA has 2ⁿ states (n = NFA states), e.g. for (a|b)*a(a|b)ⁿ⁻¹. In practice lexer DFAs stay small. Missing transitions in this tool mean "go to an implicit dead state".' },
      ],
      complexity: 'O(2ⁿ · |Σ|) states in the worst case; typically close to n.',
      reference: 'Dragon Book §3.7.1 (Algorithm 3.20)',
    },
    {
      id: 'minimize',
      title: 'DFA minimisation (partition refinement)',
      blocks: [
        'Two states are **equivalent** if, for every input string, both lead to acceptance or both to rejection. Merging equivalent states gives the unique minimal DFA (up to renaming).',
        {
          steps: [
            'Remove states unreachable from the start state.',
            'Start with two groups: accepting and non-accepting states.',
            'Split a group if two of its states go, on some symbol, to states in different groups.',
            'Repeat until no group splits. Each final group becomes one state.',
          ],
        },
        'This tool uses the simple (Moore-style) refinement shown above, which re-examines every group each round. Hopcroft’s algorithm reaches the same result in O(n log n) by always processing the smaller half of a split.',
      ],
      complexity: 'Moore: O(n² · |Σ|) worst case. Hopcroft: O(n · |Σ| · log n).',
      reference: 'Dragon Book §3.9.6 (Algorithm 3.39)',
    },
    {
      id: 'simulate',
      title: 'Simulating automata on a string',
      blocks: [
        'A DFA reads one symbol per step and follows exactly one transition; the string is accepted if it ends in an accepting state. An NFA is simulated by tracking the **set** of current states (applying ε-closure after every move) – this is the subset construction done lazily, one input at a time.',
        { formula: 'S := ε-closure({s0})\nfor each input c:  S := ε-closure(move(S, c))\naccept  ⇔  S ∩ F ≠ ∅' },
      ],
      complexity: 'DFA: O(|x|). NFA: O(|x| · (n + m)) for n states and m transitions.',
      reference: 'Dragon Book §3.7.2–3.7.3',
    },
  ],

  // ======================================================================= 2
  'direct-dfa': [
    {
      id: 'direct',
      title: 'Regex → DFA directly (followpos method)',
      blocks: [
        'This method skips the NFA. Augment the regex with an end marker: `(r)#`. Build its syntax tree; number every symbol leaf with a **position**. A DFA state is a set of positions that could match the next input symbol.',
        {
          table: {
            head: ['Node n', 'nullable(n)', 'firstpos(n)', 'lastpos(n)'],
            rows: [
              ['ε leaf', 'true', '∅', '∅'],
              ['leaf at position i', 'false', '{i}', '{i}'],
              ['c1 | c2', 'nullable(c1) ∨ nullable(c2)', 'firstpos(c1) ∪ firstpos(c2)', 'lastpos(c1) ∪ lastpos(c2)'],
              ['c1 · c2', 'nullable(c1) ∧ nullable(c2)', 'if nullable(c1): first(c1) ∪ first(c2) else first(c1)', 'if nullable(c2): last(c1) ∪ last(c2) else last(c2)'],
              ['c1*', 'true', 'firstpos(c1)', 'lastpos(c1)'],
            ],
          },
        },
        {
          formula: 'followpos rules:\n  cat node c1·c2 : for every i in lastpos(c1):  followpos(i) ⊇ firstpos(c2)\n  star node n    : for every i in lastpos(n):   followpos(i) ⊇ firstpos(n)',
        },
        {
          steps: [
            'Start state = firstpos(root).',
            'For a state S and symbol a: U = ∪ followpos(p) over positions p ∈ S labelled a.',
            'Add U as a new state if it is new; S —a→ U.',
            'A state is accepting if it contains the position of #.',
          ],
        },
        { example: '(a|b)*abb#   positions a1 b2 a3 b4 b5 #6\nfollowpos: 1→{1,2,3} 2→{1,2,3} 3→{4} 4→{5} 5→{6}\nstart = {1,2,3}', label: 'Dragon Book example' },
        { note: 'r+ is handled like a star for followpos but is nullable only if r is; r? is nullable and adds no followpos edges.' },
      ],
      complexity: 'O(n²) to compute followpos for n positions; the resulting DFA is often already minimal or close to it.',
      reference: 'Dragon Book §3.9.1–3.9.5 (Algorithm 3.36)',
    },
    {
      id: 'scanner',
      title: 'Lexical analysis and tokens',
      blocks: [
        'The **scanner** groups characters into **lexemes** and emits **tokens** ⟨type, value, position⟩ for the parser, discarding whitespace and comments. Positions (line, column, offset) let later phases point at the source in error messages.',
        'Two conflict-resolution rules are common: **longest match** (prefer the longest lexeme, so `<=` beats `<`) and **rule priority** (when lengths tie, the earlier rule wins, so the keyword `if` beats the identifier rule). This tool tries the patterns in order and takes the first that matches, so specifications list comments and multi-character operators before shorter patterns, and keywords before identifiers with a word-boundary check.',
        { note: 'Ordering matters: in the original version the `/` operator was listed before comments, so `// x` was scanned as two division operators. The MiniC specification also includes error patterns (`9abc`, unterminated comments) so a malformed lexeme yields one clear error instead of one per character.' },
      ],
      reference: 'Dragon Book §3.1–3.4',
    },
    {
      id: 'lex',
      title: 'Lex / Flex specifications',
      blocks: [
        'A Lex file has three parts separated by `%%`: declarations, **rules** (`pattern { action }`), and user code. Lex combines all patterns into a single NFA (one alternative per rule), converts it to a DFA and minimises it, producing a table-driven scanner `lex.yy.c`. When several patterns match, Lex uses longest match, then the earliest rule.',
        { example: '%%\n[0-9]+        { return NUMBER; }\n[a-zA-Z_]\\w*  { return IDENT; }\n[ \\t\\n]+      ;   /* skip */\n%%', label: 'Rules section' },
      ],
      reference: 'Dragon Book §3.5, §3.8',
    },
  ],

  // ======================================================================= 3
  grammar: [
    {
      id: 'cfg',
      title: 'Context-free grammars',
      blocks: [
        'A grammar G = (N, T, P, S) has non-terminals N, terminals T, productions P of the form `A → α`, and a start symbol S. A **derivation** replaces non-terminals step by step; a **parse tree** records it. A grammar is **ambiguous** if some string has two parse trees (e.g. `E → E + E | E * E | id`).',
        'Ambiguity is removed by encoding precedence and associativity in the grammar: one non-terminal per precedence level, left recursion for left-associative operators: `E → E + T | T,  T → T * F | F,  F → ( E ) | id`.',
      ],
      reference: 'Dragon Book §4.2–4.3',
    },
    {
      id: 'first-follow',
      title: 'FIRST and FOLLOW sets',
      blocks: [
        '**FIRST(α)** is the set of terminals that can begin a string derived from α (plus ε if α can derive ε). **FOLLOW(A)** is the set of terminals that can appear immediately after A in some sentential form ($ marks the end of input).',
        {
          formula: 'FIRST\n  terminal a:          FIRST(a) = {a}\n  A → Y1 Y2 … Yk:     add FIRST(Y1)−{ε}; if ε ∈ FIRST(Y1) add FIRST(Y2)−{ε}; …\n                       if every Yi can derive ε, add ε\nFOLLOW\n  $ ∈ FOLLOW(S)\n  A → α B β:          FOLLOW(B) ⊇ FIRST(β) − {ε}\n  A → α B, or A → α B β with ε ∈ FIRST(β):   FOLLOW(B) ⊇ FOLLOW(A)',
        },
        'Both are computed as a **fixed point**: apply the rules repeatedly until no set grows (the logs show each pass).',
        { example: "E → T E'   E' → + T E' | ε   T → F T'   T' → * F T' | ε   F → ( E ) | id\nFIRST(E) = { (, id }      FOLLOW(E) = FOLLOW(E') = { ), $ }\nFIRST(E') = { +, ε }      FOLLOW(T) = FOLLOW(T') = { +, ), $ }\n                          FOLLOW(F) = { *, +, ), $ }", label: 'Example' },
      ],
      reference: 'Dragon Book §4.4.2',
    },
    {
      id: 'left-recursion',
      title: 'Eliminating left recursion',
      blocks: [
        'A top-down parser loops forever on a production like `A → A α` (it would call A without consuming input). Immediate left recursion is rewritten into right recursion:',
        { formula: "A → A α1 | … | A αm | β1 | … | βn\n⇒   A  → β1 A' | … | βn A'\n    A' → α1 A' | … | αm A' | ε" },
        'For indirect recursion (`A → B a`, `B → A b`) the general algorithm orders the non-terminals A1…An and, for each Ai, first substitutes the productions of every earlier Aj that appears at the start of an Ai-production, then removes immediate left recursion.',
        { note: 'The general algorithm assumes the grammar has no cycles (A ⇒⁺ A) and no ε-productions that create hidden left recursion. The resulting grammar generates the same language but different parse trees – left-associativity must then be restored by the semantic actions.' },
      ],
      reference: 'Dragon Book §4.3.3 (Algorithm 4.19)',
    },
    {
      id: 'left-factoring',
      title: 'Left factoring',
      blocks: [
        'When two alternatives start with the same symbols, a predictive parser cannot choose between them with one lookahead token. Factor out the common prefix and defer the decision:',
        { formula: "A → α β1 | α β2 | γ\n⇒   A  → α A' | γ\n    A' → β1 | β2" },
        'Repeat until no two alternatives of any non-terminal share a prefix (new non-terminals may need factoring too). The dangling-else grammar becomes `S → i E t S S\' | a,  S\' → e S | ε` – which is still **not** LL(1): `e` is in both FIRST(e S) and FOLLOW(S\'). Real parsers resolve it by always choosing `S\' → e S` (else binds to the nearest if).',
      ],
      reference: 'Dragon Book §4.3.4 (Algorithm 4.21)',
    },
    {
      id: 'll1',
      title: 'LL(1) parsing table and predictive parsing',
      blocks: [
        'LL(1): scan **L**eft to right, produce a **L**eftmost derivation, using **1** token of lookahead. The table M[A, a] says which production to expand A with when the next token is a.',
        {
          steps: [
            'For each production A → α and each terminal a ∈ FIRST(α): M[A, a] = A → α.',
            'If ε ∈ FIRST(α): for each b ∈ FOLLOW(A) (including $): M[A, b] = A → α.',
            'Empty entries are syntax errors. A cell with two productions is a conflict: the grammar is not LL(1).',
          ],
        },
        { formula: 'Driver: stack = [$, S]\nloop: X = top, a = next token\n  X = a = $          → accept\n  X terminal = a     → pop X, advance\n  X non-terminal     → M[X, a] = X → Y1…Yk ? pop X, push Yk … Y1 : error\n  otherwise          → error' },
        'A grammar is LL(1) iff for every pair of alternatives A → α | β: FIRST(α) ∩ FIRST(β) = ∅, at most one can derive ε, and if β ⇒* ε then FIRST(α) ∩ FOLLOW(A) = ∅. Left-recursive and ambiguous grammars are never LL(1).',
      ],
      complexity: 'Table construction O(|P| · |T|); parsing is linear in the input length.',
      reference: 'Dragon Book §4.4.3–4.4.4 (Algorithms 4.31, 4.34)',
    },
  ],

  // ======================================================================= 4
  parsing: [
    {
      id: 'rd',
      title: 'Recursive-descent parsing',
      blocks: [
        'A recursive-descent parser has **one procedure per non-terminal**. Each procedure looks at the next token to choose an alternative, calls the procedures for non-terminals and matches terminals. With an LL(1) grammar no backtracking is needed (a *predictive* parser). The call stack plays the role of the LL parser’s explicit stack.',
        { example: "E()  { T(); E'(); }\nE'() { if (next == '+') { match('+'); T(); E'(); }   /* else ε */ }\nT()  { F(); T'(); }\nT'() { if (next == '*') { match('*'); F(); T'(); } }\nF()  { if (next == 'id') match('id');\n       else { match('('); E(); match(')'); } }", label: 'Procedures for the LL(1) expression grammar' },
        'The MiniC parser in the Compiler Studio is a recursive-descent parser too, but it writes each precedence level as a **loop** (`E → T { + T }`), which is equivalent to the ε-productions above and directly builds left-associative trees.',
        { note: 'A parser must stop at the first mismatch and must check that the whole input was consumed – otherwise `( id` or `id id` would be accepted.' },
      ],
      complexity: 'Linear time for LL(1) grammars.',
      reference: 'Dragon Book §4.4.1',
    },
    {
      id: 'op-prec',
      title: 'Operator-precedence parsing',
      blocks: [
        'A bottom-up method for **operator grammars** (no ε-productions, no two adjacent non-terminals). Three relations between terminals guide shift/reduce decisions:',
        {
          table: {
            head: ['Relation', 'Meaning', 'Action'],
            rows: [
              ['a ⋖ b', 'b starts a handle inside a’s scope (b binds tighter)', 'shift'],
              ['a ≐ b', 'a and b belong to the same handle, e.g. ( and )', 'shift'],
              ['a ⋗ b', 'a ends a handle (a binds tighter)', 'reduce'],
            ],
          },
        },
        { formula: 'loop: a = topmost TERMINAL on the stack (skip non-terminals), b = next input\n  a = b = $           → accept\n  a ⋖ b or a ≐ b      → shift b\n  a ⋗ b               → pop until the terminal on top ⋖ the most recently popped terminal;\n                        replace the popped handle by E\n  no relation         → error' },
        'Precedence and associativity become relations: `*` ⋗ `+` and `+` ⋖ `*` (higher precedence); `+` ⋗ `+` (left associative). Parentheses: `(` ⋖ everything, `(` ≐ `)`.',
        { note: 'The relation must be looked up with the topmost terminal; using a non-terminal on top of the stack is a classic bug. The method cannot handle unary minus easily and accepts some invalid strings unless handles are checked against the grammar (this tool checks them).' },
      ],
      reference: 'Dragon Book (1st ed.) §4.6',
    },
    {
      id: 'compare',
      title: 'Top-down vs bottom-up',
      blocks: [
        {
          table: {
            head: ['', 'Top-down (LL)', 'Bottom-up (LR)'],
            rows: [
              ['Builds the tree', 'root first, preorder', 'leaves first, postorder'],
              ['Derivation', 'leftmost', 'rightmost, in reverse'],
              ['Decides', 'which production to use, before seeing its body', 'when a handle is complete, after seeing it'],
              ['Grammars', 'no left recursion, left-factored', 'a much larger class, incl. left recursion'],
              ['Typical tools', 'hand-written recursive descent, ANTLR', 'yacc/bison (LALR(1))'],
            ],
          },
        },
      ],
    },
  ],

  // ======================================================================= 5
  lr: [
    {
      id: 'items',
      title: 'LR(0) items, CLOSURE and GOTO',
      blocks: [
        'An **LR(0) item** is a production with a dot marking how much of it has been seen: `A → X • Y Z`. A state of an LR parser is a set of items. The grammar is **augmented** with a fresh start symbol `S\' → S` so acceptance is a single reduction.',
        { formula: "CLOSURE(I): repeat — for every item A → α • B β in I and every production B → γ,\n            add B → • γ — until nothing changes\nGOTO(I, X) = CLOSURE({ A → α X • β  |  A → α • X β ∈ I })" },
        {
          steps: [
            "I0 = CLOSURE({ S' → • S }).",
            'For every state I and grammar symbol X with GOTO(I, X) non-empty, add GOTO(I, X) as a state if new.',
            'Repeat until no new states appear: this is the canonical collection of LR(0) item sets (the DFA of viable prefixes).',
          ],
        },
        { note: "An ε-production A → ε gives the item A → • which is complete immediately and therefore produces a reduce action. (The original tool never reduced ε-productions.)" },
      ],
      reference: 'Dragon Book §4.6.2',
    },
    {
      id: 'slr',
      title: 'SLR(1) parsing table',
      blocks: [
        {
          steps: [
            'If A → α • a β is in Ii (a terminal) and GOTO(Ii, a) = Ij: ACTION[i, a] = shift j.',
            'If A → α • is in Ii (A ≠ S\'): ACTION[i, b] = reduce A → α for every b ∈ FOLLOW(A).',
            "If S' → S • is in Ii: ACTION[i, $] = accept.",
            'GOTO[i, A] = j for non-terminals A with GOTO(Ii, A) = Ij.',
          ],
        },
        'Two actions in one cell are a **conflict**: shift/reduce (e.g. `E → E + E` without precedence) or reduce/reduce. If none exist the grammar is SLR(1).',
        { example: 'E → E + T | T,  T → T * F | F,  F → ( E ) | id\n12 states, no conflicts – the expression grammar is SLR(1).', label: 'Example' },
      ],
      complexity: 'The number of states can be exponential in the grammar size in theory; for programming-language grammars it is a few hundred to a few thousand.',
      reference: 'Dragon Book §4.6.4 (Algorithm 4.46)',
    },
    {
      id: 'lr-driver',
      title: 'The shift-reduce driver',
      blocks: [
        { formula: 'stack = [0]\nloop: s = top state, a = next token\n  ACTION[s, a] = shift t        → push t, advance\n  ACTION[s, a] = reduce A → β   → pop |β| states; t = top; push GOTO[t, A]\n  ACTION[s, a] = accept         → done\n  empty                         → syntax error' },
        'Reductions happen in the reverse order of a rightmost derivation; each reduction is the natural place for a semantic action (this is why S-attributed definitions fit LR parsers).',
      ],
      reference: 'Dragon Book §4.6.3 (Algorithm 4.44)',
    },
    {
      id: 'lr-family',
      title: 'SLR vs canonical LR(1) vs LALR(1)',
      blocks: [
        'SLR uses FOLLOW(A) as the lookahead for every reduction of A, which is sometimes too coarse. **Canonical LR(1)** items carry their own lookahead `[A → α • β, a]`, giving the most powerful deterministic method but many more states. **LALR(1)** merges LR(1) states with the same core, keeping the LR(0) state count while retaining most of LR(1)’s power; yacc and bison generate LALR(1) parsers.',
        { formula: 'Grammar classes:  LR(0) ⊂ SLR(1) ⊂ LALR(1) ⊂ LR(1)' },
        { note: 'This lab implements LR(0) items and SLR(1) only; canonical LR(1) and LALR(1) are described here but not implemented.' },
      ],
      reference: 'Dragon Book §4.7',
    },
  ],

  // ======================================================================= 6
  sdt: [
    {
      id: 'sdd',
      title: 'Syntax-directed definitions',
      blocks: [
        'A **syntax-directed definition** (SDD) attaches attributes to grammar symbols and semantic rules to productions. Evaluating the rules over a parse tree computes the translation – a value, a type, code.',
        {
          table: {
            head: ['Attribute kind', 'Computed from', 'Example'],
            rows: [
              ['Synthesized', 'the node’s children (and itself)', '`E.val = E1.val + T.val`'],
              ['Inherited', 'the parent and left siblings', "`E'.inh = T.val`"],
            ],
          },
        },
        'The rules induce a **dependency graph** between attribute instances; any topological order of it is a valid evaluation order. A cycle means the definition cannot be evaluated.',
      ],
      reference: 'Dragon Book §5.1–5.2',
    },
    {
      id: 's-attributed',
      title: 'S-attributed definitions (bottom-up)',
      blocks: [
        'An SDD is **S-attributed** if every attribute is synthesized. Then one post-order traversal evaluates everything – and an LR parser can do it during parsing, computing the attribute of A when it reduces by A → β, with the children’s values on its stack.',
        { example: '3 + 5 * 2\nF → num  F.val = 3   …   T → T1 * F  T.val = 5 × 2 = 10\nE → E1 + T  E.val = 3 + 10 = 13', label: 'Evaluation order = order of reductions' },
        { note: 'Precedence comes from the parse tree, not from the evaluator. An evaluator that simply adds up all the numbers (as the original version did) gets 10 instead of 13.' },
      ],
      reference: 'Dragon Book §5.2.3, §5.4.2',
    },
    {
      id: 'l-attributed',
      title: 'L-attributed definitions (top-down)',
      blocks: [
        'An SDD is **L-attributed** if every inherited attribute of Xi in A → X1…Xn depends only on A’s inherited attributes and on attributes of X1…Xi−1 (things to the **left**). Such definitions can be evaluated in one depth-first, left-to-right pass – exactly the order of a recursive-descent parser, where inherited attributes become **parameters** and synthesized attributes become **return values**.',
        { formula: "E  → T { E'.inh = T.val } E' { E.val = E'.syn }\nE' → + T { E'1.inh = E'.inh + T.val } E'1 { E'.syn = E'1.syn }\nE' → ε { E'.syn = E'.inh }" },
        'This is how left associativity survives left-recursion elimination: the running total is passed down to the right as `inh` and returned as `syn`.',
      ],
      reference: 'Dragon Book §5.2.4, §5.5',
    },
    {
      id: 'semantic-analysis',
      title: 'Semantic analysis: scopes and type checking',
      blocks: [
        'Semantic analysis checks rules a context-free grammar cannot express. MiniC’s analyser:',
        {
          steps: [
            'Keeps a **stack of scopes** (a symbol table per block). A declaration enters the innermost scope; a name is looked up from the innermost scope outwards.',
            'Reports undeclared names and duplicate declarations in the same scope; warns about shadowing and unused variables.',
            'Computes a type for every expression (a synthesized attribute) and checks each operator, assignment and condition against the typing rules.',
            'Gives shadowed variables unique internal names (`x`, `x.2`) so later phases can treat all variables as globals.',
          ],
        },
        { note: 'Error recovery: an expression with an error gets the type `error`, which every check accepts silently, so one mistake produces one message instead of a cascade.' },
      ],
      reference: 'Dragon Book §2.7, §6.5',
    },
  ],

  // ======================================================================= 7
  icg: [
    {
      id: 'tac',
      title: 'Three-address code',
      blocks: [
        'Three-address code (TAC) is a linearised IR in which each instruction has at most one operator: `x = y op z`, `x = op y`, `x = y`, `goto L`, `if x relop y goto L`, plus labels. Compiler-generated **temporaries** hold intermediate values. TAC is close to machine code but independent of any machine, which is why optimisations are done on it.',
        { example: 'x = a + b * c    ⇒    t1 = b * c\n                        x  = a + t1', label: 'Translation of an expression' },
      ],
      reference: 'Dragon Book §6.2.1',
    },
    {
      id: 'quads',
      title: 'Quadruples, triples and indirect triples',
      blocks: [
        {
          table: {
            head: ['Form', 'Fields', 'Results referred to by', 'Reordering'],
            rows: [
              ['Quadruples', 'op, arg1, arg2, result', 'temporary names', 'easy – instructions are independent records'],
              ['Triples', 'op, arg1, arg2', 'position (i) of the triple', 'hard – moving a triple changes every reference to it'],
              ['Indirect triples', 'triples + a list of pointers', 'position in the triple table', 'easy – reorder the pointer list only'],
            ],
          },
        },
        'In this tool a temporary is replaced by a triple position only if it is assigned exactly once; temporaries assigned on two paths (boolean values computed by jumps) keep their names. Labels disappear in triples: jump targets become triple numbers.',
      ],
      reference: 'Dragon Book §6.2.2–6.2.4',
    },
    {
      id: 'jumping',
      title: 'Boolean expressions and jumping code',
      blocks: [
        'Inside conditions, boolean expressions are translated into **jumps** rather than values: `B.true` / `B.false` are the labels to go to. This implements **short-circuit evaluation** – in `a != 0 && 10 / a > 1` the division is never executed when a is 0.',
        { formula: 'B → B1 || B2 :  B1.true = B.true;  B1.false = newlabel();  B2 inherits B.true, B.false\nB → B1 && B2 :  B1.true = newlabel(); B1.false = B.false;  B2 inherits B.true, B.false\nB → ! B1     :  swap true and false\nB → E1 rel E2:  if E1 rel E2 goto B.true;  goto B.false' },
        'With a **fall-through** convention, one of the two jumps is omitted: MiniC emits `if a >= 5 goto Lelse` (the negated test) so the then-branch simply follows.',
      ],
      reference: 'Dragon Book §6.6',
    },
    {
      id: 'backpatching',
      title: 'Backpatching',
      blocks: [
        'Jumping code needs targets that are not known yet when the jump is emitted. **Backpatching** emits jumps with empty targets, keeps lists of such instructions, and fills them in later – all in a single pass.',
        { formula: 'makelist(i)        new list containing instruction i\nmerge(p1, p2)      concatenation of two lists\nbackpatch(p, i)    set the target of every instruction on p to i\nM → ε  { M.instr = nextinstr }      (marks where B2 starts)' },
        { formula: 'B → B1 || M B2  { backpatch(B1.falselist, M.instr);\n                  B.truelist = merge(B1.truelist, B2.truelist); B.falselist = B2.falselist }\nB → B1 && M B2  { backpatch(B1.truelist, M.instr);\n                  B.truelist = B2.truelist; B.falselist = merge(B1.falselist, B2.falselist) }\nB → E1 rel E2   { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1);\n                  emit(if E1 rel E2 goto _); emit(goto _) }' },
        { example: 'a < b || c < d && e < f\n100: if a < b goto _       101: goto 102\n102: if c < d goto 104     103: goto _\n104: if e < f goto _       105: goto _\ntruelist = {100, 104}   falselist = {103, 105}', label: 'Dragon Book Fig. 6.44' },
        'The remaining lists are patched by the enclosing statement, e.g. `if (B) S`: truelist → start of S, falselist → after S.',
      ],
      reference: 'Dragon Book §6.7',
    },
    {
      id: 'switch',
      title: 'Translating switch statements',
      blocks: [
        'The Dragon Book layout emits the case bodies first and all tests at the end, so the tests can be generated once every case value is known – and replaced by a **jump table** (dense values) or a binary search (sparse values) without changing the bodies.',
        { example: '    t = E ; goto test\nL1: S1 ; goto next\n…\nLd: Sdefault ; goto next\ntest: if t == V1 goto L1\n      …\n      goto Ld          (or goto next when there is no default)\nnext:', label: 'Layout' },
      ],
      reference: 'Dragon Book §6.8',
    },
  ],

  // ======================================================================= 8
  optimization: [
    {
      id: 'blocks',
      title: 'Basic blocks and the control-flow graph',
      blocks: [
        'A **basic block** is a maximal sequence of instructions that is entered only at the first instruction and left only at the last – inside it, execution is straight-line. Blocks are the unit of local optimisation and the nodes of the **control-flow graph** (CFG).',
        {
          steps: [
            'Leaders: the first instruction; every target of a jump (labels); every instruction immediately after a jump.',
            'Each block runs from a leader up to, but not including, the next leader.',
            'Edges: B → C if B ends with a jump to C, or if C follows B in program order and B does not end with an unconditional jump.',
          ],
        },
        'A **back edge** (to a block earlier in the order, usually a dominator) indicates a loop.',
      ],
      complexity: 'Linear in the number of instructions.',
      reference: 'Dragon Book §8.4 (Algorithm 8.5)',
    },
    {
      id: 'dag',
      title: 'DAG of a basic block and local CSE',
      blocks: [
        'Representing a block as a directed acyclic graph exposes shared computations. **Leaves** are initial values of names (`a0`) and constants; **interior nodes** are operators labelled with the names that currently hold their value.',
        {
          steps: [
            'For `x = y op z`: find the nodes for y and z (creating leaves if needed).',
            'If a node with the same operator and the same children exists, reuse it – a **common subexpression**. (For commutative operators the children may be in either order.)',
            'Otherwise create the node. Move the label x to it (removing x from the node that held its old value).',
          ],
        },
        'The DAG also reveals dead code (nodes whose labels are all dead at block exit) and algebraic identities. Instructions with side effects (input, print) and assignments that kill a value must stay ordered, so they are never merged.',
      ],
      reference: 'Dragon Book §8.5',
    },
    {
      id: 'dataflow',
      title: 'Data-flow analysis',
      blocks: [
        'Data-flow analysis computes facts that hold at every program point on **all** executions, by solving equations over the CFG iteratively until a fixed point.',
        {
          table: {
            head: ['Problem', 'Direction', 'Meet', 'Transfer', 'Used for'],
            rows: [
              ['Reaching definitions', 'forward', '∪', 'OUT = GEN ∪ (IN − KILL)', 'constant propagation, use-def chains'],
              ['Live variables', 'backward', '∪', 'IN = USE ∪ (OUT − DEF)', 'dead-code elimination, register allocation'],
              ['Available expressions', 'forward', '∩', 'OUT = e_GEN ∪ (IN − e_KILL)', 'global common-subexpression elimination'],
            ],
          },
        },
        { formula: 'Reaching definitions:  IN[B] = ∪ OUT[P] over predecessors P\nLive variables:        OUT[B] = ∪ IN[S] over successors S\nIterate until no set changes.' },
        'The sets only grow (the transfer functions are monotone over a finite lattice), so iteration terminates. Visiting blocks in **reverse post-order** (forward problems) or post-order (backward) usually converges in a few passes.',
      ],
      complexity: 'With a good visiting order, at most d + 2 passes over the n blocks (d = loop-nesting depth of a reducible CFG).',
      reference: 'Dragon Book §9.2–9.3',
    },
    {
      id: 'passes',
      title: 'The optimiser’s transformations and their safety conditions',
      blocks: [
        {
          table: {
            head: ['Transformation', 'Rewrites', 'Safe only when'],
            rows: [
              ['Constant folding', '`t = 4 + 6` → `t = 10`', 'the operation cannot trap (no folding of `x / 0`) and uses the target’s arithmetic'],
              ['Constant propagation', '`x = 10; y = x * 2` → `y = 10 * 2`', 'x has the same constant on every path reaching the use'],
              ['Copy propagation', '`y = x; z = y + 1` → `z = x + 1`', 'neither x nor y is reassigned in between'],
              ['Common-subexpression elimination', 'second `a + b` → copy of the first', 'a and b are unchanged since the first computation'],
              ['Dead-code elimination', 'remove `x = …`', 'x is not live afterwards and the instruction has no side effect and cannot trap'],
              ['Branch folding / unreachable code', '`if 3 > 5 goto L` → removed', 'the condition is constant; all remaining jumps still have targets'],
            ],
          },
        },
        'Global constant propagation uses the lattice **⊤ (no value yet) → constant c → ⊥ (not a constant)**; at a join, two different constants meet to ⊥. A loop variable such as `i = i + 1` therefore becomes ⊥ even though it starts at a constant.',
        { note: 'Optimisations must preserve observable behaviour. Here that means output and run-time errors; every Studio compilation also runs the original and optimised code on the given input and compares them.' },
      ],
      reference: 'Dragon Book §8.5, §9.1, §9.4',
    },
  ],

  // ======================================================================= 9
  codegen: [
    {
      id: 'next-use',
      title: 'Next-use information',
      blocks: [
        'To decide which registers can be reused, the code generator needs to know whether a value will be used again. Within a block this is computed by a **backward** scan:',
        {
          steps: [
            'Initially every name is dead, except names live on exit from the block (from global liveness).',
            'For instruction i: `x = y op z`, scanning from the last instruction upward:',
            '  1. attach to i the current liveness / next-use information of x, y and z;',
            '  2. set x to “dead, no next use” (its old value is overwritten here);',
            '  3. set y and z to “live, next use = i”.',
          ],
        },
        'Step 2 must come before step 3 so that `x = x + 1` correctly marks x live.',
      ],
      complexity: 'Linear in the block length.',
      reference: 'Dragon Book §8.4.2 (Algorithm 8.7)',
    },
    {
      id: 'getreg',
      title: 'The simple code generator (register & address descriptors)',
      blocks: [
        'A **register descriptor** records which names each register currently holds; an **address descriptor** records where the current value of each name can be found (memory, registers, or both). For `x = y op z`:',
        {
          steps: [
            'getReg chooses registers Ry, Rz: one already holding the value; else an empty register; else one whose values are all safe to lose (dead, or also in memory or another register); else **spill** – store the register’s live values, preferring the one whose next use is furthest away.',
            'Emit loads for operands that are not in their registers yet.',
            'Choose Rx (an operand register may be reused if its value is no longer needed) and emit `OP Rx, Ry, Rz`.',
            'Update the descriptors: Rx holds only x; x is no longer valid in memory.',
            'At the end of the block, store every live name whose current value is only in a register.',
          ],
        },
        'The Studio uses exactly this block-local algorithm. Because everything live is stored at block boundaries, any block can be entered from anywhere.',
      ],
      reference: 'Dragon Book §8.6',
    },
    {
      id: 'coloring',
      title: 'Global register allocation by graph colouring',
      blocks: [
        'Build an **interference graph**: one node per name, and an edge between two names that are live at the same time (one is defined while the other is live). Assigning k registers is then **colouring** the graph with k colours so adjacent nodes differ.',
        {
          steps: [
            'Simplify: repeatedly remove a node with fewer than k neighbours and push it on a stack – it can always be coloured later.',
            'If every remaining node has ≥ k neighbours, choose a spill candidate (here: highest degree), remove it optimistically and continue.',
            'Select: pop nodes, giving each the lowest colour not used by its already-coloured neighbours. A node with no free colour is spilled to memory (and, in a full allocator, the code is rewritten and allocation repeated).',
          ],
        },
        'A copy `x = y` adds no edge between x and y, so they may share a register (enabling coalescing).',
        { note: 'Optimal k-colouring is NP-complete, so allocators use these heuristics (Chaitin 1982; Briggs’ optimistic colouring 1994). The Lab shows the analysis; the Studio does not use it to emit code.' },
      ],
      reference: 'Dragon Book §8.8.4',
    },
    {
      id: 'frames',
      title: 'Activation records',
      blocks: [
        'Each procedure call gets an **activation record** (stack frame) on the run-time stack, typically holding: actual parameters, returned value, control link (the caller’s frame pointer), access link (for nested scopes), saved machine status (return address, saved registers), local variables and temporaries.',
        'Locals are addressed with **fixed offsets** from the frame pointer, e.g. `-8(FP)`, because their layout is known at compile time; the frame is pushed by the calling sequence and popped on return.',
        { note: 'MiniC has no procedures and the virtual CPU addresses memory by name, so the Lab shows the layout the program’s variables would have under a stack-based convention.' },
      ],
      reference: 'Dragon Book §7.2',
    },
  ],

  // ======================================================================= 10
  advanced: [
    {
      id: 'dominators',
      title: 'Dominators and dominance frontiers',
      blocks: [
        'Block D **dominates** B if every path from the entry to B passes through D. The **immediate dominator** idom(B) is the closest strict dominator; the idom relation forms the **dominator tree**.',
        'The **dominance frontier** DF(D) is the set of blocks B such that D dominates a predecessor of B but does not strictly dominate B – the places where D’s influence ends and other paths join in.',
        { formula: 'Cooper–Harvey–Kennedy (iterate in reverse post-order until stable):\n  idom(b) = intersect of idom-processed predecessors, walking up the tree\nDominance frontier (for every join block b with ≥ 2 predecessors):\n  for p in preds(b): runner = p; while runner ≠ idom(b): DF(runner) += b; runner = idom(runner)' },
      ],
      reference: 'Cooper, Harvey, Kennedy, “A Simple, Fast Dominance Algorithm” (2001); Dragon Book §9.6.1',
    },
    {
      id: 'ssa',
      title: 'Static single assignment form',
      blocks: [
        'In **SSA form** every name is assigned exactly once. Each use therefore has a single reaching definition, which makes constant propagation, dead-code elimination and many other analyses simpler and faster. Where different definitions of a variable meet, a **φ-function** `x3 = φ(x1, x2)` chooses the value according to the predecessor control came from.',
        {
          steps: [
            'φ placement (Cytron et al.): for a variable defined in blocks Defs(v), place a φ for v in every block of the **iterated dominance frontier** DF⁺(Defs(v)).',
            'Pruned SSA: only place the φ where v is live on entry, avoiding useless φs.',
            'Renaming: walk the dominator tree with a stack of current versions per variable; each definition pushes a new name, each use takes the top of the stack, and each successor’s φ receives the current version for that edge.',
          ],
        },
        { example: 'while (b != 0) { r = a % b; a = b; b = r; }\nB2: a_2 = φ(a_1, a_3)   b_2 = φ(b_1, b_3)\n    if b_2 == 0 goto L2', label: 'GCD loop header' },
        { note: 'Real machines have no φ instruction: before code generation SSA is converted back by inserting copies on the incoming edges.' },
      ],
      complexity: 'φ placement is nearly linear in practice; the SSA program is at most quadratically larger, usually linear.',
      reference: 'Cytron et al., TOPLAS 1991; Appel, Modern Compiler Implementation, ch. 19',
    },
    {
      id: 'scheduling',
      title: 'Instruction scheduling',
      blocks: [
        'Pipelined and superscalar processors stall when an instruction needs a result that is not ready. Scheduling reorders instructions within a block, respecting dependences, to fill those stalls.',
        {
          table: {
            head: ['Dependence', 'Pattern', 'Constraint'],
            rows: [
              ['True (RAW)', 'j reads what i writes', 'j starts ≥ latency(i) cycles after i'],
              ['Anti (WAR)', 'j writes what i reads', 'j may not complete before i reads'],
              ['Output (WAW)', 'j writes what i writes', 'keep the order'],
              ['Control / I/O', 'side effects, the final jump', 'keep the order; jump last'],
            ],
          },
        },
        {
          steps: [
            'Build the dependence DAG with latencies on the edges.',
            'Priority of a node = length of the longest (latency-weighted) path from it to the end of the block – the critical path.',
            'Each cycle, issue up to w ready instructions (all predecessors finished), highest priority first.',
          ],
        },
        { note: 'Optimal scheduling is NP-hard; list scheduling is the standard heuristic. Anti and output dependences are artefacts of reusing names and disappear in SSA or after register renaming.' },
      ],
      reference: 'Dragon Book §10.2–10.3',
    },
    {
      id: 'vectorization',
      title: 'Dependence analysis for vectorisation (SIMD)',
      blocks: [
        'A SIMD instruction applies one operation to w lanes at once. Vectorising a loop executes each statement for w consecutive iterations before the next statement. That is legal only if no dependence would observe a different order.',
        'For subscripts of the form `i + c`, a write `A[i + w]` and an access `A[i + r]` touch the same element in iterations j and k when k − j = w − r: the **dependence distance** d = w − r.',
        {
          table: {
            head: ['Case', 'Example', 'Vectorisable with w lanes?'],
            rows: [
              ['no dependence', '`A[i] = B[i] + C[i]`', 'yes'],
              ['d = 0', '`A[i] = A[i] * 2`', 'yes'],
              ['flow, forward (writer before reader)', '`A[i] = …; C[i] = A[i-1]`', 'yes'],
              ['flow, backward / same statement, d > 0', '`A[i] = A[i-1] + 1`', 'only if w ≤ d'],
              ['anti, reader first', '`A[i] = A[i+1]`', 'yes'],
              ['scalar recurrence', '`s = s + A[i]`', 'needs a reduction transformation'],
            ],
          },
        },
        'A legal loop is **strip-mined**: an outer loop steps by w and runs vector operations on slices `A[i : i+w]`; a scalar remainder loop handles the last iterations.',
        { note: 'Real compilers use more general tests (GCD test, Banerjee, polyhedral analysis) for subscripts like `2*i + 1` or multiple loop indices; this lab handles `i ± constant` only.' },
      ],
      reference: 'Allen & Kennedy, Optimizing Compilers for Modern Architectures (2001), ch. 2–5; Dragon Book §11.3',
    },
  ],
};
