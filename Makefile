watch:
	-make t
	-fswatch -0 -o -l 2 Makefile src test | xargs -I {} -n1 -0 make t

t:
	clear
	cat test/* | node src/moa.js
# arguments from shell
	echo 'assert list("a" "b") io.argv' | node src/moa.js a b 2>&1 > /dev/null
# multiline string
	echo 'assert "a\\nb" "a\nb"'    | node src/moa.js 2>&1 > /dev/null
# assert with block
	echo 'assert 1:\n  def f: 1\n  f()' | node src/moa.js 2>&1 > /dev/null
# exit code
	! echo 'assert 1 2'             | node src/moa.js 2>&1 > /dev/null
	! echo 'throw "a"'              | node src/moa.js 2>&1 > /dev/null
# log & comment
	echo '#a\n1\n #b \nlog 1#c\n#d' | node src/moa.js 2>&1 | grep -qx 1
# syntax error
	echo 'abc'                 | node src/moa.js 2>&1 | grep -q 'can not find value `abc` in this scope'
	echo 'abc += 1'            | node src/moa.js 2>&1 | grep -q 'can not find value `abc` in this scope'
	echo 'let abc 1; abc += 1' | node src/moa.js 2>&1 | grep -q 'can not assign twice to immutable variable `abc`'
	@echo ok

r:
	node src/moa.js

w:
	wc src/moa.js
	wc test/*.moa
