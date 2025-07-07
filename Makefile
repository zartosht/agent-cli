# Makefile for agent-cli

.PHONY: help install build build-sandbox build-all test lint format preflight clean start debug release run-npx create-alias

help:
	@echo "Makefile for agent-cli"
	@echo ""
	@echo "Usage:"
	@echo "  make install          - Install npm dependencies"
	@echo "  make build            - Build the entire project"
	@echo "  make build-sandbox    - Build the sandbox container"
	@echo "  make build-all        - Build the project and the sandbox"
	@echo "  make test             - Run the test suite"
	@echo "  make lint             - Lint the code"
	@echo "  make format           - Format the code"
	@echo "  make preflight        - Run formatting, linting, and tests"
	@echo "  make clean            - Remove generated files"
	@echo "  make start            - Start the Gemini CLI"
	@echo "  make debug            - Start the Gemini CLI in debug mode"
	@echo "  make release          - Publish a new release"
	@echo "  make run-npx          - Run the CLI using npx (for testing the published package)"
	@echo "  make create-alias     - Create a 'agent' alias for your shell"

install:
	npm install

build:
	npm run build

build-sandbox:
	npm run build:sandbox

build-all:
	npm run build:all

test:
	npm run test

lint:
	npm run lint

format:
	npm run format

preflight:
	npm run preflight

clean:
	npm run clean

start:
	npm run start

debug:
	npm run debug

release:
	npm run publish:release

run-npx:
	npx https://github.com/zartosht/agent-cli

create-alias:
	scripts/create_alias.sh
