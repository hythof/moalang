#!node
'use strict'

/* Syntax
top: line ([;\n] line)*
line: exp+ (":" block)?
exp:
| op1? atom (op2 exp)?
| id ("," id+ )* "=>" exp
block: ("\n  " line)+ | line (";" line)*
atom: bottom (prop | call | copy)*
prop: "." (id | [0-9]+)                   # property access
call: "(" exp* ")"                        # call function
index: "[" exp "]"                        # index access or generic
copy: "{" id* (id "=" atom)* "}"          # copy with new value
bottom:
| "(" top ")"                             # priority
| "[" exp* "]"                            # list
| "{" id* (id "=" atom)* "}"              # struct
| "-"? [0-9]+ ("." [0-9]+)? ("e" [0-9]+)? # -1.2
| "-"? "0x" [0-9a-fA-F_]+                 # 0xff -> 255
| '"' [^"]* '"'                           # "string"
| '"""' [^"]* '"""'                       # """a="b"""" -> "a=\"b\""
| id
op1: [!-~] | "..."
op2: [+-/*%<>|&^=!]+
id: [A-Za-z_][A-Za-z0-9_]*
*/

/* Keyword
reserved  : __.* bytes regexp time duration stream num decimal array import export i8 i16 i32 i64 u8 u16 u32 u64 f16 f32 f64
*/

/* API
//literal   : _ ...
//declare   : let var def class enum dec
dec _                 : {}
dec (== != < <= > >=) : a a bool
dec log a             : ... a a
dec assert a          : a a _!
dec iif a             : ...[bool a] a
dec if a              : bool a _
dec else a            : a _
dec match a b         : a ...[a b] b
dec throw a b         : a b
dec catch a b         : a (error[b] a) a // b as enum type covers possible exceptions, which is generated by the compiler
dec return a          : a a
dec for               : ... _
dec each              : ... _
dec while             : bool _
dec continue          : _
dec break             : _

enum bool:
  true
  false
  !  : bool
  || : bool bool
  && : bool bool

class int:
  (- ~)          : int
  (+ - * / % **) : int int
  (& | ^ << >>)  : int int
  abs            : int
  neg            : int
  float          : float
  char           : option[string]

class float:
  (- ~)          : float
  (+ - * / % **) : float float
  abs            : int
  neg            : int
  floor          : int
  ceil           : int
  round          : int
  isinf          : bool
  isnan          : bool

class string:
  _       : ... string
  size    : int
  concat  : string string
  take    : int string
  drop    : int string
  slice   : int int string
  split   : string list[string]
  index   : string option[int]
  rindex  : string option[int]
  replace : string string string
  starts  : string bool
  ends    : string bool
  has     : string bool
  trim    : string
  reverse : string
  repeat  : int string
  format  : ... string
  int     : option[int]
  float   : option[float]

class fn ...a:
  _

class error a:
  message string
  stack   string
  data    a

enum option a:
  some a
  none
  bool   : bool
  then b : (a b) option[b]
  or     : a a
  value  : a

class tuple ...a:
  _     : ...a tuple[...a]
  []    : int a.nth
  []=   : int a.nth a.nth

class list a:
  _        : ...a list[a]
  []       : int a!
  size     : int
  take     : int list[a]
  drop     : int list[a]
  slice    : int int list[a]
  repeat   : int list[a]
  concat   : list[a] list[a]
  map b    : (a b) list[b]
  fmap b   : (a list[b]) list[b]
  keep     : (a bool) list[a]
  all      : (a bool) bool
  any      : (a bool) bool
  fold b   : (b a b) b b
  scan b   : (b a b) b list[b]
  find     : (a bool) option[a]
  index    : (a bool) option[int]
  rindex   : (a bool) option[int]
  zip b    : list[b] list[tuple[a b]]
  sort     : (a a bool) list[a]
  reverse  : list[a]
  join     : string string
  has      : a bool
  min      : a
  max      : a
  minmax   : tuple[a a]
  unique   : set[a]
  []=      : int a a!  // modify in-place
  push     : a a       // modify and expand
  pop      : a!        // modify and shurink

class set a:
  _         : ...a set[a]
  (- | & ^) : set[a] set[a]
  size      : int
  has       : a bool
  list      : list[a]
  add       : a bool  // modify in-place
  rid       : a bool  // modify in-place

class dict k v:
  _      : ...[k v] dict[k v]
  []     : k option[v]
  size   : int
  has    : k bool
  keys   : list[k]
  values : list[v]
  items  : list[tuple[k v]]
  concat : dict[k v] dict[k v]
  []=    : k v v       // modify and expand
  gset   : k v v       // modify and expand
  rid    : k option[v] // modify and shrink
*/

class TypeError extends Error {}
const log = (...a) => { console.log(...a); return a[0] }
const fail = (m, ...a) => { const e = new Error(m); a && (e.detail = JSON.stringify(a)); throw e }
const failUnify = (m, ...a) => { const e = new TypeError(m); a && (e.detail = JSON.stringify(a)); throw e }
const op1 = '- ^ ~'.split(' ')
const op2 = '. * ** / % + - << >> & ^ | == != < <= > >= && || = += -= *= /= %= &= |= ^= <<= >>='.split(' ')
const runtimeJs = ''

function main(command, args) {
  const { readFileSync } = require('fs')
  if (command === 'to' && args[0] === 'js') {
    const source = args.slice(1).join(' ') || readFileSync('/dev/stdin', 'utf-8')
    return { out: runtimeJs + analyze(source).toJs() }
  } else {
    return { out: `Usage:
      moa                       # launch interactive shell
      moa env [+/-] [<version>] # list versions; use, install or remove a version
      moa ide [<port>]          # launch web IDE
      moa to [<language>]       # compile to a programming language` }
  }
}

function tokenize(source) {
  const regexp = /(-?[0-9]+[0-9_]*(?:\.[0-9_]+)(?:e[0-9]+)?|[0-9A-Za-z_]+|[!~+\-*/%<>:!=^|&]+|[()\[\]{}]|""".*?"""|"[^]*?(?<!\\)"|(?:#[^\n]*|[ \n])+)/
  let offset = 0
  return source.trim().split(regexp).map(code => ({code, offset: offset += code.length})).filter(t => !/^[ \t]*$/.test(t.code))
}

function parse(tokens) {
  let pos = 0
  const br = /[;\n]/
  const stmt = {code: '__stmt', pos: 0}
  const stopReg = /[\n;\])}]/
  function parseTop() {
    return [stmt, sepby(parseLine, t => /[;\n]/.test(t.code))]
  }
  function parseLine(_) {
    pos && pos-- // push back consumed token
    const blockable = ': = =>'.split(' ')
    return until(t => !stopReg.test(t.code), t => blockable.includes(t.code) ? parseBlock(t) : parseExp(t))
  }
  function parseExp(token) {
    // TODO: a,b => c
    let lhs = op1.includes(token.code) ? [token, parseAtom(consume())] : parseAtom(token)
    let lp = Infinity
    until(({code}) => op2.includes(code), token => {
      const rp = op2.findIndex(op => op === token.code)
      lhs = lp > rp ? [token, lhs, parseAtom(consume())] : [lhs[0], lhs[1], [token, lhs[2], parseAtom(consume())]]
      lp = rp
    })
    return lhs
  }
  function parseBlock(token) {
    consume() // drop token because parseLine() will push back the token
    const indent = prev().code.match(/ *$/)[0].length
    if (indent) {
      consume() // drop again
      return [token, sepby(parseLine, t => indent === t.code.match(/ *$/)[0].length)]
    } else {
      return [token, sepby(parseLine, t => t.code === ';')]
    }
  }
  function parseAtom(token) {
    function parseSuffix(x) {
      const t = look()
      const p = prev()
      const isClose = t && t.offset === p.offset + p.code.length
      return t && t.code === '.'       ? parseSuffix([consume(), x, consume()]) :
        t && t.code === '(' && isClose ? parseSuffix([consume(), x].concat(until(t => t.code === ')' ? (++pos, false) : true, parseExp))) :
        t && t.code === '{' && isClose ? parseSuffix([consume(), x].concat(until(t => t.code === '}' ? (++pos, false) : true, parseExp))) :
        x
    }
    return parseSuffix(parseBottom(token))
  }
  function parseBottom(token) {
    for (const [l, r] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      if (token.code === l) {
        return [token].concat(until(({code}) => code !== r, parseExp, ({code}) => code === r && pos++))
      }
    }
    return token.code.startsWith('"""') ? {...token, code: JSON.stringify(token.code.slice(3, -3))} : token
  }
  function consume() {
    return tokens[pos++]
  }
  function prev() {
    return pos > 0 ? tokens[pos-1] : {code: '', offset: 0}
  }
  function look() {
    return tokens[pos]
  }
  function sepby(f, g) {
    return [f()].concat(until(t => g(t) && ++pos, f))
  }
  function until(f, g, h) {
    const a = []
    while (pos < tokens.length && f(look())) {
      a.push(g(consume()))
    }
    pos < tokens.length && h && h(look())
    return a
  }
  return parseTop()
}

function infer(root) {
  return root
}

function toJs(root) {
  function toArg(node) {
    return node.code
  }
  function toReturn(node) {
    const codes = toCode(node).split(';\n')
    return codes.slice(0, -1).map(code => code + ';\n') + 'return ' + codes.at(-1)
  }
  function toBind(kind, [op, id, body], init) {
    const bind = `${ kind } ${ id.code } ${ op.code } ${ toCode(body) }`
    return init ? bind + `\n;{{${ toCode(init) }}};\n${ id.code }` : bind
  }
  function toClass(name, _args, body) {
    const fields = body[1].map(x => x[0].code)
    return body[0].code === '=' ? `function ${ name.code }(...a) { return ${ body[1][0].code }(...a) }` :
      `function ${ name.code }(${ fields }) { return { ${ fields } } }`
  }
  function toEnum(name, _args, body) {
    function tagFunction(tag, args) {
      return `function ${ tag }(${ args }) { return { __tag: '${ tag }', __value: { ${ args } } } }`
    }
    return body[1].map(x =>
      x.length === 1 ? `const ${ x[0].code } = { __tag: '${ x[0].code }' }` :
      Array.isArray(x[1]) ? tagFunction(x[0].code, x[1][1].map(x => x[0].code)) :
      `function ${ x[0].code }(__value) { return { __tag: '${ x[0].code }', __value } }`).join(';\n')
  }
  function toMatch(target, conds) {
    function gen(conds) {
      const cond = conds[0]
      return conds.length === 0 ? '(() => { throw new Error(`miss match tag=${ __enum.__tag }`) })()' :
        `__enum.__tag === '${ cond[0].code }' ? ${ cond.length === 2 ? toCode(cond[1]) : '(' + cond[1].code + ' => { ' + toReturn(cond[2]) + '})(__enum.__value)' } : ` + gen(conds.slice(1))
    }
    return `(__enum => ${ gen(conds) })(${toCode(target)})`
  }
  function toCode(node) {
    if (Array.isArray(node)) {
      const head = node[0].code
      return node.length === 2 && op1.includes(head) ? `(${head}${toCode(node[1])})` :
        node.length === 3 && op2.includes(head) ? `(${toCode(node[1])} ${head} ${toCode(node[2])})` :
        head === 'var'   ? toBind('let', node[1], node[2]) :
        head === 'let'   ? toBind('let', node[1], node[2]) :
        head === 'def'   ? `function ${node[1].code}(${node.slice(2, -1).map(toArg).join(', ')}) {\n${toReturn(node.at(-1))}\n}` :
        head === 'dec'   ? '' :
        head === 'class' ? toClass(node[1], node.slice(2, -1), node.at(-1)) :
        head === 'enum'  ? toEnum(node[1], node.slice(2, -1), node.at(-1)) :
        head === 'match' ? toMatch(node[1], node[2][1]) :
        head === ':'     ? node[1].map(toCode).join(';\n') :
        head === '('     ? toCode(node[1]) + '(' + node.slice(2).map(toCode).join(', ') + ')' :
        head === '__stmt' ? node[1].map(toCode).join(';\n') :
        node.length === 1 ? toCode(node[0]) :
        toCode(node[0]) + '(' + node.slice(1).map(toCode).join(', ') + ')'
    } else {
      return node.code
    }
  }
  return toCode(root)
}
function analyze(source) {
  const tokens = tokenize(source)
  const root = infer(parse(tokens))
  return {
    runtimeJs,
    tokens,
    nodes: root[1],
    toJs: () => toJs(root)
  }
}

module.exports = { main, analyze, TypeError }

if (require.main === module) {
  console.log(main(process.argv[2], process.argv.slice(3)).out || '')
}
