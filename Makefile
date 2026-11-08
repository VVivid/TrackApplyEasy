SHELL := /bin/sh
GO ?= go
HELM ?= helm
export GOCACHE := $(CURDIR)/.cache/go-build
export NEXT_TELEMETRY_DISABLED := 1
.PHONY: deps assets check test race build chart-test browser-test public-check container-test

deps:
	npm ci --prefix web --no-fund --no-audit
	$(GO) mod download
assets:
	npm --prefix web run build
check:
	@test -z "$$(gofmt -l cmd internal)" || { echo 'Run gofmt on cmd and internal.'; exit 1; }
	$(GO) vet ./...
	npm --prefix web run typecheck
	npm --prefix web run format:check
	python3 scripts/check-public-source.py
test:
	$(GO) test ./...
	python3 -m unittest discover -s scripts -p 'test_*.py'
	python3 -m unittest discover -s deploy/gitops -p 'test_*.py'
race:
	$(GO) test -race ./...
build: assets
	mkdir -p bin
	CGO_ENABLED=0 $(GO) build -trimpath -o bin/trackapplyeasy ./cmd/trackapplyeasy
chart-test:
	HELM=$(HELM) sh scripts/check-chart.sh
browser-test: assets
	PLAYWRIGHT_BROWSERS_PATH=$(CURDIR)/.cache/playwright npm --prefix web test
public-check:
	python3 scripts/check-public-source.py

container-test:
	python3 scripts/check-container.py --image $${TEST_IMAGE:-trackapplyeasy:local}
