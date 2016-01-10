#
# Copyright (c) 2015, Joyent, Inc.
#
# Makefile for node-triton
#

#
# Vars, Tools, Files, Flags
#
JS_FILES	:= bin/triton \
	$(shell find lib test -name '*.js' | grep -v '/tmp/')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE	 = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS	 = -f tools/jsstyle.conf
CLEAN_FILES += ./node_modules

include ./tools/mk/Makefile.defs

#
# Targets
#
.PHONY: all
all:
	npm install

.PHONY: test
test: test-unit test-integration

.PHONY: test-unit
test-unit:
	NODE_NDEBUG= ./node_modules/.bin/tape test/unit/*.test.js

.PHONY: test-integration
test-integration:
	NODE_NDEBUG= ./node_modules/.bin/tape test/integration/*.test.js

.PHONY: clean
clean::
	rm -f triton-*.tgz

check:: versioncheck

# Ensure CHANGES.md and package.json have the same version.
.PHONY: versioncheck
versioncheck:
	@echo version is: $(shell cat package.json | json version)
	[[ `cat package.json | json version` == `grep '^## ' CHANGES.md | head -1 | awk '{print $$2}'` ]]

.PHONY: cutarelease
cutarelease: versioncheck
	[[ `git status | tail -n1` == "nothing to commit, working directory clean" ]]
	./tools/cutarelease.py -p triton -f package.json

.PHONY: git-hooks
git-hooks:
	ln -sf ../../tools/pre-commit.sh .git/hooks/pre-commit

.PHONY: dumpvar
dumpvar:
	@if [[ -z "$(VAR)" ]]; then \
		echo "error: set 'VAR' to dump a var"; \
		exit 1; \
	fi
	@echo "$(VAR) is '$($(VAR))'"

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
JSL_FLAGS += --nofilelist
