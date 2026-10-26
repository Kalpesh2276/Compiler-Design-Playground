// Regression corpus. Expected outputs were computed by hand (shown in comments) and are
// independent of the compiler. `runs` lists [inputs, expected] pairs; an expected value
// of { error: kind } means the program must stop with that run-time error.

export const CORPUS = [
  {
    name: 'arithmetic precedence and C division',
    source: 'print(2 + 3 * 4); print((2 + 3) * 4); print(20 / 3); print(20 % 3); print(-7 / 2);',
    runs: [[[], ['14', '20', '6', '2', '-3']]],
  },
  {
    name: 'multiple assignments',
    source: 'int a = 5; int b = a * 2; a = b - a; print(a); print(b);',
    runs: [[[], ['5', '10']]],
  },
  {
    name: 'nested parentheses',
    source: 'int x = 3; int y = ((x + 1) * (x - 1)) / (x - 1); print(y);', // (4*2)/2
    runs: [[[], ['4']]],
  },
  {
    name: 'conditional on input parity',
    source: 'int n = input(); if (n % 2 == 0) print(0); else print(1);',
    runs: [[[7], ['1']], [[4], ['0']]],
  },
  {
    name: 'sum 1..10',
    source: 'int i = 1; int s = 0; while (i <= 10) { s = s + i; i = i + 1; } print(s);',
    runs: [[[], ['55']]],
  },
  {
    name: 'gcd (Euclid)',
    source: 'int a = input(); int b = input(); while (b != 0) { int t = a % b; a = b; b = t; } print(a);',
    runs: [[[48, 18], ['6']], [[17, 5], ['1']]],
  },
  {
    name: 'fibonacci',
    source: 'int n = input(); int a = 0; int b = 1; int i = 0; while (i < n) { int t = a + b; a = b; b = t; i = i + 1; } print(a);',
    runs: [[[10], ['55']], [[1], ['1']], [[0], ['0']]],
  },
  {
    name: 'boolean operators',
    source: 'bool p = true; bool q = !p; print(p && q); print(p || q); print(p == q); print(!q);',
    runs: [[[], ['false', 'true', 'false', 'true']]],
  },
  {
    name: 'short-circuit guards a division by zero',
    source: 'int z = 0; bool ok = z != 0 && 10 / z > 0; print(ok); print(z == 0 || 10 / z > 0);',
    runs: [[[], ['false', 'true']]],
  },
  {
    name: 'constant folding candidate',
    // a = 9, b = 18, c = 28, e = 27 * 27
    source: 'int a = 4 + 5; int b = a * 2; int c = b + 10; int d = c * 0; int e = (a + b) * (a + b); print(c); print(e);',
    runs: [[[], ['28', '729']]],
  },
  {
    name: 'common subexpression with inputs',
    source: 'int x = input(); int y = input(); int p = (x + y) * (x + y); int q = x + y; print(p - q);', // 49 - 7
    runs: [[[3, 4], ['42']]],
  },
  {
    name: 'shadowing in a block',
    source: 'int x = 1; { int x = 2; print(x); x = x + 5; print(x); } print(x);',
    runs: [[[], ['2', '7', '1']]],
  },
  {
    name: 'nested loops',
    source: 'int i = 1; while (i <= 3) { int j = 1; while (j <= i) { print(i * 10 + j); j = j + 1; } i = i + 1; }',
    runs: [[[], ['11', '21', '22', '31', '32', '33']]],
  },
  {
    name: 'run-time division by zero',
    source: 'int a = input(); print(100 / a);',
    runs: [[[5], ['20']], [[0], { error: 'DivisionByZero' }]],
  },
  {
    name: 'primality test',
    source: 'int n = input(); int d = 2; bool prime = n > 1; while (d * d <= n && prime) { if (n % d == 0) prime = false; d = d + 1; } print(prime);',
    runs: [[[97], ['true']], [[91], ['false']], [[1], ['false']], [[2], ['true']]],
  },
  {
    name: 'dead code',
    source: 'int unused = 42 * 2; int used = 7; print(used);',
    runs: [[[], ['7']]],
  },
  {
    name: 'constant branches',
    source: 'if (3 > 5) print(1); else print(2); while (false) print(9);',
    runs: [[[], ['2']]],
  },
  {
    name: '32-bit overflow',
    source: 'int big = 2147483647; big = big + 1; print(big); print(big - 1);',
    runs: [[[], ['-2147483648', '2147483647']]],
  },
  {
    name: 'collatz steps',
    source: 'int n = input(); int steps = 0; while (n != 1) { if (n % 2 == 0) n = n / 2; else n = 3 * n + 1; steps = steps + 1; } print(steps);',
    runs: [[[6], ['8']], [[27], ['111']]],
  },
  {
    name: 'register pressure',
    // (3*7) - (-4*5) + (20/2) = 21 + 20 + 10
    source: 'int a = input(); int b = input(); int c = input(); int d = input(); int e = input(); print((a + b) * (c + d) - (a - e) * (b + c) + (d * e) / (a + 1));',
    runs: [[[1, 2, 3, 4, 5], ['51']]],
  },
  {
    name: 'loop with invariant expression',
    source: 'int k = 3; int i = 0; int s = 0; while (i < 4) { s = s + k * 2; i = i + 1; } print(s);',
    runs: [[[], ['24']]],
  },
  {
    name: 'boolean flag toggling',
    source: 'int i = 0; bool flag = false; while (i < 5) { flag = !flag; if (flag && i > 1) print(i); i = i + 1; }',
    runs: [[[], ['2', '4']]],
  },
  {
    name: 'loop at program entry reading input',
    source: 'while (input() > 0) { print(1); }',
    runs: [[[3, 2, 0], ['1', '1']], [[], { error: 'InputExhausted' }]],
  },
  {
    name: 'bool materialised and compared',
    source: 'int a = input(); bool big = a > 10 || a < -10; bool small = !big; print(big == small); print(big);',
    runs: [[[50], ['false', 'true']], [[3], ['false', 'false']]],
  },
];
