#
# Copyright (c) 2015, Joyent, Inc. All rights reserved.
#
# Makefile for node-triton
#

#
# Vars, Tools, Files, Flags
#
JS_FILES	:= bin/triton \
	$(shell find lib -name '*.js' | grep -v '/tmp/')
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
test:
	./node_modules/.bin/tape test/unit/*.test.js

.PHONY: test-integration
test-integration:
	./node_modules/.bin/tape test/integration/*.test.js

.PHONY: git-hooks
git-hooks:
	[[ -e .git/hooks/pre-commit ]] || ln -s ./tools/pre-commit.sh .git/hooks/pre-commit

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
