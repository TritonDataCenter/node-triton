#
# Copyright 2019 Joyent, Inc.
# Copyright 2024 MNX Cloud, Inc.
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
TAP_EXEC = ./node_modules/.bin/tap
TEST_JOBS ?= 10
TEST_TIMEOUT_S ?= 1200
TEST_GLOB ?= *

include ./tools/mk/Makefile.defs

#
# Targets
#
.PHONY: all
all:
	npm install

.PHONY: test
test: test-unit test-integration

.PHONY: ensure-node-v6-or-greater-for-test-suite
ensure-node-v6-or-greater-for-test-suite:
	@NODE_VER=$(shell node --version) && \
		./node_modules/.bin/semver -r '>=6.x' $$NODE_VER >/dev/null || \
		(echo "error: test suite requires node v6 or greater: you have $$NODE_VER"; exit 1)

.PHONY: test-unit
test-unit: ensure-node-v6-or-greater-for-test-suite
	NODE_NDEBUG= $(TAP_EXEC) --timeout $(TEST_TIMEOUT_S) -j $(TEST_JOBS) \
		-o ./test-unit.tap test/unit/$(TEST_GLOB).test.js

.PHONY: test-integration
test-integration: ensure-node-v6-or-greater-for-test-suite
	NODE_NDEBUG= $(TAP_EXEC) --timeout $(TEST_TIMEOUT_S) -j $(TEST_JOBS) \
		-o ./test-integration.tap test/integration/$(TEST_GLOB).test.js

.PHONY: clean
clean::
	rm -f triton-*.tgz

check:: versioncheck

# Ensure CHANGES.md and package.json have the same version.
.PHONY: versioncheck
versioncheck:
	@echo version is: $(shell cat package.json | json version)
	[[ `cat package.json | json version` == `grep '^## ' CHANGES.md | head -2 | tail -1 | awk '{print $$2}'` ]]

.PHONY: cutarelease
cutarelease: versioncheck
	[[ -z `git status --short` ]]  # If this fails, the working dir is dirty.
	@which json 2>/dev/null 1>/dev/null && \
	    ver=$(shell json -f package.json version) && \
	    name=$(shell json -f package.json name) && \
	    publishedVer=$(shell npm view -j $(shell json -f package.json name)@$(shell json -f package.json version) 2>/dev/null | json version) && \
	    if [[ -n "$$publishedVer" ]]; then \
		echo "error: $$name@$$ver is already published to npm"; \
		exit 1; \
	    fi && \
	    echo "** Are you sure you want to tag and publish $$name@$$ver to npm?" && \
	    echo "** Enter to continue, Ctrl+C to abort." && \
	    read
	ver=$(shell cat package.json | json version) && \
	    date=$(shell date -u "+%Y-%m-%d") && \
	    git tag -a "$$ver" -m "version $$ver ($$date)" && \
	    git push origin "$$ver" && \
	    npm publish

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
