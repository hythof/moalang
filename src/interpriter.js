/*
 * Eval internal expression
 */
class List extends Array { }
class Tuple extends Array { }

const fs = require('fs')
const { parse } = require('./parser.js')
const dump = o => { console.dir(o, {depth: null}); return o }
const fail = m => { throw new Error(m) }
const str = o => typeof o === 'string' ? o : escape(o)
const escape = o =>
  o instanceof Error ? `${o.constructor.name}(${o.message})` :
  o instanceof Tuple ? o.map(escape).join(',') :
  typeof o === 'function' ? o.toString() :
  Array.isArray(o) ? `[${o.map(escape).join(' ')}]` :
  JSON.stringify(o)
const put = x => process.stdout.write(x);
const puts = (...a) => { console.log(...a); return a[0]; }
const tuple = (...a) => new Tuple().concat(...a)
const attempt = (f, g) => { try { return f() } catch (e) { return g(e) } }
const make = a => Object.fromEntries(Array(a.length/2).fill().map((_,i) => [a[i*2], a[i*2+1]]))
const zip = (a, b) => a.map((x, i) => [x, b[i]])

const evaluate = (x, env) => {
  const run = x => evaluate(x, env)
  const runWith = (x, ...a) => evaluate(x, {...env, ...make(a)})
  const lookup = key => key in env ? env[key] : fail(`Not found '${key}' in [${Object.keys(env)}]`)
  const lambda = (env, args, body) => (...argv) => runWith(body, ...zip(args, argv).flat())
  const method = (target, id) =>
    Array.isArray(target) && id === 'size' ? target.length :
    Array.isArray(target) && id === 'keep' ? f => target.filter(f) :
    Array.isArray(target) && id === 'slice' ? (...a) => target.slice(...a) :
    // string methods below
    id === 'size' ? target.length :
    id === 'rsplit' ? s => target.split(new RegExp(s)) :
    id === 'match' ? s => target.match(new RegExp(s)) :
    id === 'starts' ? s => target.startsWith(s) :
    id in target ? target[id] :
    id.match(/^[0-9]/) ? run(target)[id] :
    fail(`'${id}' is unknown method of '${typeof target}'`)
  const op2 = (op, lhs, rhs) => {
    const toComparelable = x => "'" + JSON.stringify(_toComparelable(x)) + "'"
    const _toComparelable = x => Array.isArray(x) ? x.map(_toComparelable) :
      typeof x === 'object' ? Object.keys(x).sort().map(key => _toComparelable(x[key])) :
      typeof x === 'number' ? (Array(16).join('0') + x).slice(-16) :
      x
    return '== != > >= < <='.split(' ').includes(op) ? eval(`${toComparelable(run(lhs))} ${op} ${toComparelable(run(rhs))}`) :
      op === '++' ? run(lhs).concat(run(rhs)) :
      op.match(/^[+\-*/%|&]+=$/) ? env[lhs] = op2(op.slice(0, -1), run(lhs), run(rhs)) :
      eval(`${run(lhs)} ${op} ${run(rhs)}`)
  }
  const struct = xs => (...a) =>
    xs.length === 2 ? {[xs[0]]: a[0]} :
    Object.fromEntries(xs.slice(1).map(([id, _], i) => [id, a[i]]))
  const unpack = xs => xs[0] === '__pack' ? xs.slice(1) : [xs]
  const union = (id, xs) => unpack(xs).map(x => Array.isArray(x) ? [x[0], __val => ({__tag: x[0], __val})] : [x, {__tag: x}])
  const match = (target, conds) => {
    const rescue = conds.find(a => a[1][0] === '.' && a[1][2] === 'error')
    target = rescue ? attempt(() => run(target), e => ({__tag: 'error', __val: {message: e.message}})) : run(target)
    const _match = ([[_, cond, body], ...left]) =>
      cond[0] === '.' ?  (target.__tag === cond[2] ? runWith(body, cond[1], target.__val) : _match(left)) :
      cond.match(/[A-Za-z_]/) ? runWith(body, cond, target) :
      target === run(cond) && run(body)
    return _match(conds) || fail(`${conds} are not match with ${str(target)}`)
  }
  const iif = a => a.length === 1 ? run(a[0]) : run(a[0]) ? run(a[1]) : iif(a.slice(2))
  const eq = (a, b) => ((a, b) => a === b ? undefined : fail(`eq ${a} ${b}`))(escape(a), escape(b))
  const define = ([head, body]) => Array.isArray(head) ?
    (env[head[0]] = lambda(env, head.slice(1), body))  :
    (env[head] = run(body))
  const block = ([head, ...tail], body) =>
    head === 'struct' ? env[tail[0]] = struct(body) :
    head === 'union' ? env[tail[0]] = Object.fromEntries(union(tail[0], body).map(([id, node]) => [id, env[id] = node])) :
    head === 'match' ? match(tail[0], unpack(body)) :
    head === 'test' ? runWith(body, tail[0], {eq}) :
    head === 'i' && tail.join('') === 'if' ? iif(unpack(body).flatMap(a => a.slice(1))) :
    fail(`'${head}' is unkown block with ${str(tail)} and ${str(body)}`)
  const apply = ([head, ...tail]) =>
    head === undefined ? undefined :
    Array.isArray(head) ? apply([run(head), ...tail]) :
    typeof head === 'function' ? head(...tail.map(run)) :
    head === 'list' ? new List().concat(tail.map(run)) :
    head === 'tuple' ? tuple(...tail.map(run)) :
    head === 'struct' ? Object.fromEntries(Array(tail.length/2).fill().map((_,i) => [tail[i*2], run(tail[i*2+1])])) :
    head === 'dict' ? Object.fromEntries(Array(tail.length/2).fill().map((_,i) => [run(tail[i*2]), run(tail[i*2+1])])) :
    head === 'error' ? fail(str(run(tail[0]))) :
    head === 'string' ? str(run(tail[0])) :
    head === 'int' ? parseInt(run(tail[0])) :
    head === 'iif' ? iif(tail) :
    head === '=' ? define(tail) :
    head === '__index' ? run(tail[0])[run(tail[1])] :
    head === '__call' && tail[0] === 'struct' ? ({}) :
    head === '__call' && tail[0] === 'dict' ? ({}) :
    head === '__call' && tail[0] === 'list' ? [] :
    head === '__call' ? lookup(tail[0])(run) :
    head === '__pack' ? tail.map(run).slice(-1)[0] :
    head === '.' ? method(run(tail[0]), tail[1]) :
    head === ':' ? block(tail[0], tail[1]) :
    head === ',' ? tuple(...tail.map(run)) :
    head === '!' ? !run(tail[0]) :
    head === '=>' ? lambda(env, Array.isArray(tail[0]) ? tail[0].filter(x => x !== ',') : [tail[0]], tail[1]) :
    head.match(/^[+\-*\/%<>|&=!]/) ? op2(head, tail[0], tail[1]) :
    head.startsWith('"') ? head :
    tail.length > 0 ? lookup(head)(...tail.map(run)) :
    lookup(head)
  return x instanceof List ? x :
    x instanceof Tuple ? x :
    Array.isArray(x) ? apply(x) :
    typeof x !== 'string' ? x :
    x === '_' ? true : // for pattern match and iif
    x === 'true' ? true :
    x === 'false' ? false :
    x[0] === '"' ? x.slice(1, -1) :
    x.match(/^-?[0-9]/) ? parseFloat(x) :
    lookup(x)
}

module.exports = { evaluate }
if (require.main === module) {
  const eq = (expect, src) => {
    const actual = attempt(() => evaluate(parse(src), {}), e => e)
    if (str(expect) === str(actual)) {
      put('.')
    } else {
      puts()
      puts(`Expect: ${str(expect)}`)
      puts(`Actual: ${str(actual)}`)
      puts(`Source: ${JSON.stringify(src)}`)
      if (actual instanceof Error) {
        puts('Error: ', actual.stack)
      }
      put('Nodes: ')
      dump(parse(src))
      throw Error('Test was failed')
    }
  }
  const test = (expect, src) => eq(expect, src)

  // [x] define
  test(1, 'a = 1\na')
  test(1, 'f a = a\nf(1)')
  test(2, 'f a =\n  b = a + 1\n  b\nf(1)')
  test(2, 'f a =\n  b = a\n  a += 1\nf(1)')

  // [x] struct
  test({}, '{}')
  test({a:1, b:"c"}, '{a=1 b="c"}')
  test('hi', 'struct s:\n  a string\ns("hi").a')
  test(1, 'struct s:\n  a string\n  b int\ns("hi" 1).b')
  test(true, 'struct s:\n  a string\n  b int\ns("hi" 1) == s("hi" 1)')
  test(false, 'struct s:\n  a string\n  b int\ns("hi" 1) == s("hi" 2)')
  test(true, 'struct s:\n  a string\n  b int\ns("hi" 1) <= s("hi" 1)')
  test(false, 'struct s:\n  a string\n  b int\ns("hi" 1) < s("hi" 1)')
  test(true, 'struct s:\n  a string\n  b int\ns("hi" 1) < s("hi" 2)')
  test(true, 'struct s:\n  a string\n  b int\ns("hi" 9) < s("hi" 10)')

  // [x] union / match
  test(1, 'union ab:\n  a\n  b\nmatch a:\n  .a: 1\n  .b: 2')
  test(2, 'union ab:\n  a\n  b\nmatch b:\n  .a: 1\n  .b: 2')
  test('hi', 'union ab:\n  a string\n  b int\nmatch a("hi"):\n  s.a: s\n  n.b: string(n)')
  test('1', 'union ab:\n  a string\n  b int\nmatch b(1):\n  s.a: s\n  n.b: string(n)')

  // [x] error / match
  test(Error('1'), 'error 1')
  test("f", 'f s = error "f"\nmatch f("t"):\n  e.error: e.message\n  s: s')
  test("t", 'f s = s\nmatch f("t"):\n  e.error: e.message\n  s: s')

  // [x] iif
  test(1, 'iif true 1 2')
  test(2, 'iif false 1 2')
  test(2, 'iif false 1 true 2 3')
  test(3, 'iif false 1 false 2 3')
  test(1, 'iif:\n  true: 1\n  _: 2')
  test(2, 'iif:\n  false: 1\n  _: 2')

  // [x] int
  test(1, '1')
  test(-1, '-1')
  test(1, 'int("1")')

  // [x] bool true false
  test(true, 'true')
  test(false, 'false')
  test(false, 'true && false')
  test(true, 'true && true')
  test(true, 'true || false')
  test(false, '1 < 1')
  test(true, '1 <= 1')
  test(false, '1 > 1')
  test(true, '1 >= 1')
  test(true, '1 == 1')
  test(false, '1 != 1')

  // [ ] operators
  test(false, '!true')
  test(true, 'true && !false')
  test(3, '1 + 2')
  test(1, '3 - 2')
  test(6, '2 * 3')
  test(1.5, '3 / 2')
  test(1, '3 % 2')
  test(27, '3 ** 3')
  test(6, '3 << 1')
  test(3, '6 >> 1')

  // [x] string
  test('hi', '"hi"')
  test(2, '"hi".size')
  test(['', '1', '', '2', ''], '"12".rsplit("([0-9])")')
  test('h', '"hi"[0]')
  test('1', 'string(1)')
  test('ab', '"a" ++ "b"')
  test('a', 'string("a")')
  '1 -1 0.1 true [] 0,1'.split(' ').map(s => test(s, `string(${s})`))

  // [x] lambda
  test(1, '(a => a)(1)')
  test(3, '(a,b => a + b)(1 2)')
  test('s', '(a => a)("s")')

  // [x] tuple
  test(tuple(1, 2), '1,2')
  test(tuple(1, 2, 3), '1,2,3')
  test(tuple(1, 2), 'tuple(1 2)')
  test(1, 'tuple(1 2.0).0')
  test(2.0, 'tuple(1 2.0).1')

  // [x] list
  test([], '[]')
  test([1], '[1]')
  test([1,2], '[1 2]')
  test(1, '[1][0]')
  test(0, '[].size')
  test(2, '[1 2].size')
  test([2], '[1 2].keep x => x > 1')

  // [x] dict
  test({}, 'dict()')
  test({s:1}, 'dict("s" 1)')
  test({1:2}, 'dict(1 2)')
  test({s:1}, '[s:1]')
  test({1:2}, '[1:2]')
  test(2, '[1:2][1]')

  // [x] test
  test(undefined, 'test t: t.eq 1 1')
  test(Error('eq 1 2'), 'test t: t.eq 1 2')
  test(Error('eq "a" "b"'), 'test t: t.eq "a" "b"')

  // [x] edge case
  test(undefined, '')
  test(undefined, '\n')

  puts('ok')
}
