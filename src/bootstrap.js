'use strict'
const die = (msg, obj) => { console.dir(obj, {depth: null}); return new Error(msg) }
const print = (...args) => console.log(...args)
const dump = s => JSON.stringify(s)
const effOp2 = '+= -= *= /= %= <-'.split(' ')
const op2 = effOp2.concat('&& || == != >= <= => > < ++ + - * / % . ,'.split(' '))
const syms = ': | = [ ] ( )'.split(' ')
const range = (s,e,step) => {
  const a = []
  for (let i=s; i<e; i+=step) {
    a.push(i)
  }
  return a
}
const seqBy = (a,f) => {
  if (!a.length) { return [] }
  const l = a.length
  const ret = []
  let sep = [a[0]]
  let prev = f(a[0])
  for (let i = 1; i<l; ++i) {
    const v = a[i]
    const key = f(v)
    if (key === prev) {
      sep.push(v)
    } else {
      ret.push(sep)
      sep = [v]
      prev = key
    }
  }
  if (sep.length) { ret.push(sep) }
  return ret
}
const runtime = (function() {
  function __equals(a, b) {
    const t1 = typeof a
    const t2 = typeof b
    if (t1 === 'object' && t2 === 'function' && a.__tag) { return a.__tag === b.name }
    if (t1 !== t2) { return false }
    if (t1 === 'object') { return JSON.stringify(a) === JSON.stringify(b) }
    return a == b
  }
  function __eff(o) {
    while (typeof o === 'function') {
      o = o()
    }
    return o
  }
  function __then(o, ...fs) {
    for (const f of fs) {
      o = typeof o === 'function' && o.length === 0 ? o() : o
      if (o && o.__err) {
        return o
      } else {
        o = f(o)
      }
    }
    return o
  }
  function __catch(o, ...fs) {
    for (const f of fs) {
      o = typeof o === 'function' && o.length === 0 ? o() : o
      if (o && o.__err) {
        o = f(o)
      } else {
        return o
      }
    }
    return o
  }
}).toString().split('\n').slice(1,-1).join('\n') + '\n'
function tokenize(src) {
  const len = src.length
  let pos = 0
  let indent = 0
  let lineno = 1
  const newToken = (tag, code) => ({tag, code, lineno, indent, pos})
  const reg = (tag, m) => m && newToken(tag, m[0])
  const any = (tag, m) => m && newToken(tag, m)
  const rule = s =>
    reg('id', s.match(/^[A-Za-z_][A-Za-z_0-9]*/)) ||
    reg('num', s.match(/^[0-9]+/)) ||
    reg('str', s.match(/^"[^"]*"/)) ||
    reg('str', s.match(/^`[^`]*`/)) ||
    any('op2', op2.find(a => s.startsWith(a))) ||
    any('sym', syms.find(a => s.startsWith(a))) ||
    reg('spaces', s.match(/^[ \t\r\n]+/))
  const tokens = []
  while (pos < len) {
    const token = rule(src.slice(pos))
    if (!token) { throw die('Failed to tokenize: ', {at: src.slice(pos), pos}) }
    pos += token.code.length
    tokens.push(token)
    if (token.code.includes('\n')) {
      const lines = token.code.split('\n')
      indent = lines[lines.length - 1].length
      lineno += lines.length - 1
    }
  }
  return tokens.filter(x => x.tag !== 'spaces')
}
function parse(tokens) {
  const len = tokens.length
  let pos = 0

  const look = () => tokens[pos] || {}
  function consume(f) {
    if (pos >= len) { throw die('Out of index', {len,pos,tokens}) }
    const token = tokens[pos]
    if (f && !f(token)) { throw die('Unexpected token', {f: f.toString(), token, tokens}) }
    pos++
    return token
  }
  function until(f, g) {
    g = g || parse_exp
    const exps = []
    while (pos < len && f(tokens[pos])) {
      exps.push(g())
    }
    return exps
  }
  function parse_define() {
    const fname = consume(t => t.tag === 'id')
    const args = until(t => t.tag === 'id')
    const sym = consume(t => t.code === '=' || t.code === ':' || t.code === '|')
    sym.fname = fname
    sym.args = args
    if (sym.code === '=') {
      sym.exps = parse_body(sym)
    } else if (sym.code === ':') {
      const fields = until(t => t.indent > sym.indent)
      if (fields.length %2 !== 0) { throw die('invalid struct', fields) }
      sym.struct = fields
    } else if (sym.code === '|') {
      const fields = until(t => t.indent > sym.indent)
      const tags = seqBy(fields, t => t.lineno)
      if (fields.length %2 !== 0) { throw die('invalid adt', {tags, fields}) }
      sym.adt = tags
    } else {
      throw die('Unexpected symbol', sym)
    }
    return sym
  }
  function is_define() {
    let p = pos
    while (p < len && tokens[p].tag === 'id') {
      p++
    }
    return p > pos && p < len && tokens[p].code === '='
  }
  function parse_body(base) {
    if (look().lineno === base.lineno) {
      return [parse_exp()]
    } else if (look().lineno > base.lineno) {
      return until(t => t.indent > base.indent, () => is_define() ? parse_define() : parse_exp())
    } else {
      throw die('Unexpected function body', base)
    }
  }
  function parse_exp() {
    let l = parse_unit()
    while (op2.includes(look().code)) {
      let op = parse_unit()
      op.lhs = l
      op.rhs = parse_exp()
      l = op
    }
    return l
  }
  function parse_unit() {
    const token = consume()
    const next = look()
    switch (token.tag) {
      case 'id':
        if (next.code === '(' && next.pos === token.pos + token.code.length) {
          consume(t => t.code === '(')
          token.argv = until(t => t.code !== ')')
          consume(t => t.code === ')')
        }
        return token
      case 'num':
      case 'str':
      case 'op2': return token
      case 'sym':
          switch (token.code) {
            case '[':
              token.list = until(u => u.code !== ']')
              consume(t => t.code === ']')
              return token
            case '(':
              token.body = parse_exp()
              consume(t => t.code === ')')
              return token
            default: return token
          }
      default: throw die('Unexpected token', token)
    }
  }
  const defines = []
  while (pos < len) {
    defines.push(parse_define())
  }
  return defines
}
function generate(nodes) {
  const reservedIds= ['catch', 'then']
  function genId(id, argv) {
    if (id === 'if') {
      const a = argv.map(gen)
      const cases = range(1, a.length, 2).map(i => `${a[i-1]} ? ${a[i]} : `).join('')
      return '(' + cases + a[a.length-1] + ')'
    } if (id === 'error') {
      return `({message: (${gen(argv[0])}).toString(), __err: true})`
    } if (reservedIds.includes(id)) {
      return `__${id}(${ argv.map(gen).join(', ') })`
    } else if (id === 'match') {
      const a = argv.map(gen)
      const cond = i => a[i-1] === '_' ? 'true' : `__equals(__m, ${a[i-1]})`
      const cases = range(2, a.length, 2).map(i => `${cond(i)} ? ${a[i]} : `).join('')
      const otherwise = '(() => { throw new Error("Failed to match")})()'
      const js = cases + otherwise
      return `(__m => ${js})(${a[0]})`
    } else {
      return id + (argv ? '(' + argv.map(gen).join(', ') + ')' : '')
    }
  }
  function genFunc(fname, args, exps) {
    if (exps.length === 0) {
      throw die('Empty exps', fname)
    }
    const arg = args.map(t => t.code).join(',')
    const isEff = exps.some(x => effOp2.includes(x.code)) || (exps.length >= 2 && exps.slice(0, -1).some(e => e.tag === 'id'))
    if (isEff) {
      const prefix = `const ${fname} = (${arg}) => `
      if (exps.length === 1) {
        return prefix + gen(exps[0])
      } else {
        const steps = ['let __ret'].concat(exps.map(genStep))
        const body = '{\n  ' + steps.join('\n  ') + '\n  return __ret\n}'
        return prefix + body
      }
    } else {
      const prefix = `const ${fname} = ` + (arg || exps.length > 1 ? `(${arg}) => ` : '')
      if (exps.length === 1) {
        return prefix + gen(exps[0])
      } else {
        const lines = exps.map(gen)
        const body = '{\n  ' + lines.slice(0, -1).join('\n') + '\n  return ' + lines[lines.length - 1] + '\n}'
        return prefix + `${body}`
      }
    }
  }
  function genStep(node) {
    const suffix =  '; if (__ret && __ret.__err) { return __ret }'
    if (node.code === '=') {
      return gen(node)
    } if (node.code === '<-') {
      const id = node.rhs.code
      const exp = id === 'var' ? gen(node.rhs.argv[0]) : gen(node.rhs)
      return `let ${node.lhs.code} = __ret = __eff(${exp})` + suffix
    } else {
      return `__ret = __eff(${gen(node)})` + suffix
    }
  }
  function genStruct(fname, _args, struct) {
    const fields = range(1, struct.length, 2).map(i => struct[i - 1].code).join(',')
    return `const ${fname} = (${fields}) => ({${fields}})`
  }
  function genAdt(fname, _args, adt) {
    const g = (tag, fields) => `const ${tag} = (${fields}) => ({${fields}, __tag: '${tag}'})`
    const f = a => g(a[0].code, range(1, a.length, 2).map(i => a[i].code).join(', '))
    return adt.map(f).join('\n')
  }
  function genComma(node) {
    const vals = []
    while (node.code === ',') {
      if (node.lhs.tag !== 'id') { throw die('token should be id', node) }
      vals.push(node.lhs.code)
      node = node.rhs
    }
    if (node.code !== '=>') { throw die('unexpected token', node) }
    vals.push(node.lhs.code)
    const args = vals.join(',')
    return `(${args}) => ${gen(node.rhs)}`
  }
  function gen(node) {
    if (!node) { throw die('node is not defined', node) }
    switch (node.tag) {
      case 'id': return genId(node.code, node.argv)
      case 'num':
      case 'str': return node.code
      case 'op2':
        switch (node.code) {
          case ',': return genComma(node)
          case '++': return `${gen(node.lhs)}.concat(${gen(node.rhs)})`
          default: return `${gen(node.lhs)} ${node.code} ${gen(node.rhs)}`
        }
      case 'sym':
        if(node.code==='=' && !node.fname) { print(node); console.dir(nodes,{depth:null}) }
        switch (node.code) {
          case '=': return genFunc(node.fname.code, node.args, node.exps)
          case ':': return genStruct(node.fname.code, node.args, node.struct)
          case '|': return genAdt(node.fname.code, node.args, node.adt)
          case '[': return '[' + node.list.map(gen).join(', ') + ']'
          case '(': return '(' + gen(node.body) + ')'
          default: throw Error('Gen sym error ' + dump(node))
        }
      default: throw Error('Gen error ' + dump(node))
    }
  }
  return nodes.map(gen).join('\n')
}
function run(src) {
  const tokens = tokenize(src)
  const nodes = parse(tokens)
  const js = generate(nodes)
  let actual = null
  let error = null
  try {
    actual = Function(runtime + '\n' + js + '\nreturn typeof main === "function" ? main() : main')()
  } catch (e) {
    error = e
  }
  return {tokens, nodes, js, actual, error}
}
function testAll() {
  testBootStrap()
  testMoa()
}
function testBootStrap() {
  const err = (...args) => runTest((e,a) => a && a.__err && e === a.message, ...args)
  const eq = (...args) => runTest((e,a) => dump(e) === dump(a), ...args)
  const runTest = (cmp, expect, exp, ...funcs) => {
    funcs.reverse()
    funcs.push('main = ' + exp)
    const src = funcs.join('\n')
    const result = run(src)
    const actual = result.actual
    if (cmp(expect, actual)) {
      process.stdout.write('.')
    } else {
      print('Failed')
      print('js    : ', result.js)
      print('src   : ', src)
      print('expect: ', expect)
      print('actual: ', actual)
      print('tokens: ', result.tokens)
      print('nodes : ', result.nodes)
      print('error : ', result.error)
      process.exit(100)
    }
  }

  // value
  eq(1, '1')
  eq('hi', '"hi"')
  eq('"hi"', '`"hi"`')
  eq([], '[]')
  eq([1], '[1]')
  eq([1, 2], '[1 2]')
  eq(['a', 'b'], '["a" "b"]')
  eq(true, 'true')
  eq(false, 'false')

  // exp
  eq(3, '1 + 2')
  eq(7, '1 + 2 * 3')
  eq(9, '(1 + 2) * 3')
  eq(2, '4 / 2')
  eq('ab', '"a" ++ "b"')
  eq([1, 2], '[1] ++ [2]')
  eq(false, 'true && false')
  eq(true, 'false || true')
  eq(false, '1 == 2')
  eq(true, '1 != 2')
  eq(true, '2 >= 2')
  eq(false, '2 > 2')
  eq(true, '2 <= 2')
  eq(false, '2 < 2')
  eq(true, '1 == 1 && 1 == 1')
  eq(false, '1 == 1 && 1 == 2')

  // function
  eq(1, 'a', 'a=1')
  eq(3, 'add(1 2)', 'add a b = a + b')
  eq(1, 'f1(1)', 'f1 = a => a')
  eq(3, 'f2(1 2)', 'f2 = a,b => a + b')
  eq(6, 'f3(1 2 3)', 'f3 = a,b,c => a + b + c')

  // control flow
  eq(1, 'if(true 1 lazy)')
  eq(2, 'if(false lazy 2)')
  eq(3, 'if(false lazy true 3 lazy)')
  eq(3, 'if(false lazy false lazy 3)')
  eq(2, 'match(1 1 2 lazy lazy)')
  eq(4, 'match(3 1 2 3 4)')
  eq(2, 'match(3 _ 2 3 4)')

  // struct
  eq({a: 'hi', b: 1}, 'struct("hi" 1)', 'struct:\n   a string\n  b int')
  eq('hi', 'struct("hi" 1).a', 'struct:\n   a string\n  b int')
  eq(1, 'struct("hi" 1).b', 'struct:\n   a string\n  b int')

  // adt
  eq(1, 'match(v aint v.vint abool v.vbool)', 'v = aint(1)', 'adt|\n  aint vint int\n  abool vbool bool')
  eq(true, 'match(v aint v.vint abool v.vbool)', 'v = abool(true)', 'adt|\n  aint vint int\n  abool vbool bool')

  // effect
  eq(3, '\n  a = 1\n  a + 2')
  eq(1, '\n  a <- f\n  a', 'f = 1')
  eq(4, '\n  a <- var(1)\n  a += 1\n  a *= 2\n  a')
  eq(1, '\n  a <- var(6)\n  a /= 2\n  a %= 2\n  a')
  eq(3, '\n  a <- var(1)\n  f = a+=1\n  f\n  f\n  a')
  eq(7, '\n  a <- var(1)\n  f =\n    a += 1\n    a += 2\n  f\n  f\n  a')

  // error handling
  err('failed', 'error("failed")')
  eq('failed!', 'catch(error("failed") e => e.message + "!")')
  err('failed', 'then(error("failed") v => v + 1)')
  eq(3, 'then(1 v => v + 2)')
  eq(6, 'then(1 v => v + 2 v => v + 3)')
  err('3', 'then(1 v => error(v + 2) v => v + 3)')
  eq('1', 'catch(error(1) e => e e => e.message)')
  eq(2, 'catch(error(1) _ => 2 e => e.message)')

  // effect with error handling
  err('failed', '\n  v <- f\n  v', 'f = error("failed")')
  eq(2, '\n  v <- catch(f _ => 2)\n  v', 'f = error("failed")')
  eq(2, '\n  v = f\n  catch(v _ => 2)', 'f = error("failed")')
  eq(2, '\n  v <- catch(f _ => 2)\n  v', 'f =\n  error("failed")\n  1')
  eq(2, '\n  v = f\n  catch(v _ => 2)', 'f =\n  error("failed")\n  1')
  err('failed', '\n  v <- f\n  0', 'f = g', 'g =\n  error("failed")\n  1')

  // effect combination
  eq(5, '\n  v <- var(1)\n  inc = v += 1\n  twice f =\n    f\n    f\n  twice(inc)\n  twice(inc)\n  v')

  print('ok')
}
function testMoa() {
  const moa = `compile src = src`.trim()
  const compiler = runtime + run(moa).js
  function eq(expect, exp, ...funcs) {
    funcs.reverse()
    funcs.push('main = ' + exp)
    const src = funcs.join('\n')
    const js = Function(compiler + `\nreturn compile(${dump(src)})`)()
    const actual = Function(runtime + js + `\nreturn typeof main === "function" ? main() : main`)()
    if (dump(expect) === dump(actual)) {
      process.stdout.write('.')
    } else {
      print('Failed')
      print('expect:', expect)
      print('actual:', actual)
      print('js    :', js)
    }
  }

  // value
  eq(1, '1')
  eq('hi', '"hi"')
  eq('"hi"', '`"hi"`')
  eq([], '[]')
  eq([1], '[1]')
  //eq([1, 2], '[1 2]')
  //eq(['a', 'b'], '["a" "b"]')
  eq(true, 'true')
  eq(false, 'false')

  print('ok')
}
testAll()
