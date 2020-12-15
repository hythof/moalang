function _operator(op, lhs, rhs) {
  lhs = lhs.valueOf()
  rhs = rhs.valueOf()
  switch (op) {
    case '+' : return lhs + rhs
    case '-' : return lhs - rhs
    case '*' : return lhs * rhs
    case '/' : return _div(lhs, rhs)
    case '++' : return lhs.concat(rhs)
    case '==' : return lhs === rhs
    case '!=' : return lhs !== rhs
    case '<=' : return lhs <= rhs
    case '>=' : return lhs >= rhs
    case '&&' : return lhs && rhs
    case '||' : return lhs || rhs
    case '<' : return lhs < rhs
    case '>' : return lhs > rhs
    default:
      assert(false, {op,lhs,rhs})
  }
}
