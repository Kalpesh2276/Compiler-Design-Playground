// Example MiniC programs for the Compiler Studio and the Algorithm Lab.
// `inputs` are the values returned by successive input() calls.

export const EXAMPLES = [
  {
    id: 'arithmetic',
    title: 'Arithmetic & precedence',
    inputs: [],
    source: `// Operator precedence, parentheses and C-style division
int a = 7;
int b = 3;
print(a + b * 2);      // 13
print((a + b) * 2);    // 20
print(a / b);          // 2  (truncates)
print(-a % b);         // -1 (sign of dividend)
`,
  },
  {
    id: 'factorial',
    title: 'Factorial (while loop)',
    inputs: [5],
    source: `// Reads n and prints n!
int n = input();
int fact = 1;
while (n > 1) {
  fact = fact * n;
  n = n - 1;
}
print(fact);
`,
  },
  {
    id: 'gcd',
    title: 'GCD (Euclid)',
    inputs: [84, 36],
    source: `int a = input();
int b = input();
while (b != 0) {
  int r = a % b;
  a = b;
  b = r;
}
print(a);
`,
  },
  {
    id: 'optimizable',
    title: 'Optimization showcase',
    inputs: [3, 4],
    source: `// Constant folding, propagation, CSE and dead code
int x = input();
int y = input();
int scale = 4 + 6;          // folded to 10
int unused = scale * 99;    // dead
int sum = (x + y) * (x + y) + scale;   // x + y computed once
int copy = sum;
print(copy);
if (scale > 5) {            // branch folded away
  print(1);
} else {
  print(0);
}
`,
  },
  {
    id: 'primes',
    title: 'Primes below N (nested loops)',
    inputs: [30],
    source: `int limit = input();
int n = 2;
while (n < limit) {
  bool prime = true;
  int d = 2;
  while (d * d <= n && prime) {
    if (n % d == 0) prime = false;
    d = d + 1;
  }
  if (prime) print(n);
  n = n + 1;
}
`,
  },
  {
    id: 'pressure',
    title: 'Register pressure (spills)',
    inputs: [1, 2, 3, 4, 5],
    source: `// Many values are live at once: with 3-4 registers
// the code generator must spill some of them to memory.
int a = input();
int b = input();
int c = input();
int d = input();
int e = input();
print((a + b) * (c + d) - (a - e) * (b + c) + (d * e) / (a + 1));   // 51
`,
  },
  {
    id: 'booleans',
    title: 'Booleans & short-circuit',
    inputs: [0],
    source: `int d = input();
// && short-circuits: 100 / d is never evaluated when d == 0
bool safe = d != 0 && 100 / d > 10;
print(safe);
bool either = d == 0 || 100 / d > 10;
print(either);
print(!either);
`,
  },
  {
    id: 'scopes',
    title: 'Scopes & shadowing',
    inputs: [],
    source: `int x = 1;
{
  int x = 2;      // shadows the outer x (warning)
  x = x * 10;
  print(x);       // 20
}
print(x);         // 1
`,
  },
  {
    id: 'syntax-error',
    title: 'Syntax errors (recovery)',
    inputs: [],
    source: `int a = 5
print(a);
int b = (a + ;
b = a * 2;
`,
  },
  {
    id: 'semantic-error',
    title: 'Semantic errors',
    inputs: [],
    source: `int count = 10;
bool done = count;        // type mismatch: int -> bool
print(total);             // undeclared
int count = 3;            // duplicate declaration
if (count) print(1);      // condition must be bool
`,
  },
  {
    id: 'runtime-error',
    title: 'Run-time error (division by zero)',
    inputs: [0],
    source: `int d = input();
print(100 / d);
`,
  },
];

export const findExample = (id) => EXAMPLES.find((e) => e.id === id);
