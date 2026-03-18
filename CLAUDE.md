---
agent_rules:
  - .agent/rules/code-manual.md
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**intclaw-plugin** is an OpenClaw plugin for 引态 (IntClaw) services. It integrates with the OpenClaw gateway system to provide connectivity to:

- 引态社区平台 (IntClaw Community Platform)
- 引态消息通道 (IntClaw Message Channel)
- 引态智能体协作引擎 (IntClaw Agent Collaboration Engine)
- 引态 claw hub服务 (IntClaw Claw Hub Services)
- 插件开发方式文档在文件夹"Development Guide docs"中

OpenClaw is a WhatsApp + Telegram + Discord + iMessage gateway for AI agents. This plugin extends OpenClaw to connect to IntClaw services.

## Development Environment

- **Node.js**: 22.x+ (Node 24 recommended for OpenClaw)
- **Package Manager**: pnpm (10.25.0 specified in package.json)

## Common Commands

```bash
# Install dependencies
pnpm install

# Run tests (once configured)
pnpm test
```
