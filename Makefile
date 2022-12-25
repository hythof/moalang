watch:
	-make test
	fswatch -0 *.js | xargs -I {} -n1 -0 make test

test:
	clear
	node src/parse.js
	node src/convert.js
	node src/compile.js
