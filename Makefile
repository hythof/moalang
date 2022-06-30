test:
	@printf '\033\143'
	@(cd src && time node moa.js selfcheck)

install:
	echo "#!node\n\n" | cat - src/moa.js > bin/moa
	chmod 0755 bin/moa

watch:
	@-make test
	@-fswatch -0 -o src/moa.js | xargs -I {} -n1 -0 make test
